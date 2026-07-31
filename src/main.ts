import './ui/styles.css';

import { AudioEngine } from './audio/engine';
import { GENRES } from './audio/genres';
import { InputSource } from './audio/input';
import { SynthSource } from './audio/synth';
import { clamp01 } from './core/math';
import type { GenreId, MusicSource, RGB, Section } from './core/types';
import type { CameraMode } from './gfx/camera';
import { Renderer, type Quality } from './gfx/renderer';
import { Director, defaultManualState, type ManualState } from './lighting/director';
import { REDUCED_MAX_STROBE_HZ, Rig, SAFE_DEFAULTS } from './lighting/rig';
import { SCENES, sceneById, type SceneDef } from './scenes';
import { showGate } from './ui/gate';
import { bindKeys, type KeyApi } from './ui/keys';
import { Panel, type SourceMode } from './ui/panel';

/**
 * Application root.
 *
 * Owns the two music sources, the rig, the lighting director and the renderer,
 * and runs the frame loop that connects them. It implements `KeyApi`, so the
 * panel and the keyboard drive exactly the same set of operations — there is no
 * second code path for "the same thing but from a key press".
 */
class App implements KeyApi {
  private engine: AudioEngine;
  private synth: SynthSource;
  private input: InputSource;
  private mode: SourceMode = 'synth';

  private rig = new Rig();
  private director: Director;
  readonly renderer: Renderer;
  private scene: SceneDef;
  private manualState: ManualState = defaultManualState();

  private panel: Panel;
  private unbindKeys: () => void;
  private unbindCamera: () => void;

  private reduce = false;
  private lastFrame = 0;
  private running = true;
  private seedValue = 'rave-nights';

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, reduceFlashing: boolean) {
    this.engine = new AudioEngine();
    this.synth = new SynthSource(this.engine, this.seedValue);
    this.input = new InputSource(this.engine);
    this.director = new Director(this.seedValue);
    this.renderer = new Renderer(canvas);
    this.scene = SCENES[0];

    this.setReduceFlashing(reduceFlashing);
    this.applyScene(this.scene);

    this.panel = new Panel(uiRoot, this);
    this.unbindKeys = bindKeys(this, this.panel, SCENES.map((s) => s.id));
    this.unbindCamera = this.renderer.camera.attach(canvas);

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.renderer.resize();

    void this.synth.start().then(() => this.panel.refresh());
    this.lastFrame = performance.now() / 1000;
    requestAnimationFrame(this.frame);
  }

  private get source(): MusicSource {
    return this.mode === 'synth' ? this.synth : this.input;
  }

  // ------------------------------------------------------------ scene

  private applyScene(scene: SceneDef): void {
    this.scene = scene;
    // A fresh rig per scene: fixture ids, indices and group ordering are all
    // scene-specific, so patching on top of the old one would leave ghosts.
    this.rig = new Rig();
    this.rig.safety = { ...SAFE_DEFAULTS, reduceFlashing: this.reduce };
    this.rig.haze = scene.hazeBase;
    scene.patch(this.rig);
    this.renderer.loadScene(scene, this.rig);
    this.director.setCrowdCenter(scene.crowdCenter);
  }

  // ------------------------------------------------------------ loop

  private frame = (nowMs: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);

    const now = nowMs / 1000;
    // Clamp dt: a backgrounded tab can hand back a multi-second delta, which
    // would make every easing snap and the strobe phase jump.
    const dt = Math.min(0.1, Math.max(1 / 480, now - this.lastFrame));
    this.lastFrame = now;

    const source = this.source;
    source.update(dt);

    // Audio clock, not frame time — this is what keeps lights on the beat.
    const audioTime = this.engine.currentTime;
    this.director.update(dt, audioTime, source, this.rig, this.manualState);

    const t = source.transport();
    const onsets = source.onsets();
    const energy = source.energy();

    this.renderer.camera.update(dt, {
      bar: t.bar,
      time: audioTime,
      kick: onsets.kick,
      energy,
    });

    this.renderer.resize();
    this.renderer.render(this.rig, this.scene, {
      time: audioTime,
      dt,
      beatPhase: t.beat % 1,
      bands: source.bands(),
      energy,
      impact: this.director.impactLevel,
      reduceFlashing: this.reduce,
    });

    const status = this.director.status();
    this.panel.updateReadout({
      genre: GENRES[source.genre()].name,
      bpm: t.bpm,
      bar: t.bar,
      beat: Math.floor(t.beat),
      section: source.section(),
      barsToNext: source.barsToNextSection(),
      cue: `${status.movement}/${status.color}/${status.intensity}`,
      armed: status.armed,
      frameMs: this.renderer.frameMs(),
      quality: this.renderer.quality,
      shot: this.renderer.camera.shotName(),
      confident: t.confident,
    });
  };

  private onResize = (): void => this.renderer.resize();

  private onVisibility = (): void => {
    // Suspend the transport when hidden: the scheduler would otherwise pile up
    // events against a throttled timer and blast them all on return.
    if (document.hidden && this.mode === 'synth' && this.synth.playing) {
      this.synth.stop();
      this.wasPlayingBeforeHide = true;
    } else if (!document.hidden && this.wasPlayingBeforeHide) {
      this.wasPlayingBeforeHide = false;
      void this.synth.start();
    }
  };

  private wasPlayingBeforeHide = false;

  dispose(): void {
    this.running = false;
    this.unbindKeys();
    this.unbindCamera();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.synth.dispose();
    this.input.dispose();
    this.engine.dispose();
  }

  // ------------------------------------------------------- PanelApi: deck

  isPlaying(): boolean {
    return this.mode === 'synth' ? this.synth.playing : this.input.label !== 'no input';
  }

  togglePlay(): void {
    if (this.mode !== 'synth') {
      this.toast('input mode follows the file or microphone');
      return;
    }
    if (this.synth.playing) this.synth.stop();
    else void this.synth.start();
  }

  sourceMode(): SourceMode {
    return this.mode;
  }

  setSourceMode(mode: SourceMode): void {
    if (mode === this.mode) return;
    this.mode = mode;

    if (mode === 'synth') {
      this.input.disconnect();
      void this.synth.start();
      return;
    }

    this.synth.stop();
    if (mode === 'mic') {
      this.input.useMicrophone().then(
        () => this.toast('listening — the rig will lock to the beat in a few bars'),
        (err: unknown) => {
          this.toast('microphone unavailable here — back to the synth engine');
          console.warn(err);
          this.mode = 'synth';
          void this.synth.start();
          this.panel.refresh();
        },
      );
    } else {
      this.toast('drop an audio file onto the deck');
    }
  }

  loadFile(file: File): void {
    this.mode = 'file';
    this.synth.stop();
    this.input.loadFile(file).then(
      () => {
        this.toast(`playing ${file.name} — TAP or ALIGN if the grid drifts`);
        this.panel.refresh();
      },
      (err: unknown) => {
        this.toast(`could not decode ${file.name}`);
        console.error(err);
        this.mode = 'synth';
        void this.synth.start();
        this.panel.refresh();
      },
    );
  }

  inputLabel(): string {
    return this.input.label;
  }

  tap(): void {
    const bpm = this.input.tap();
    this.toast(bpm ? `tempo set to ${Math.round(bpm)} BPM` : 'keep tapping — four beats needed');
  }

  align(): void {
    this.input.align();
    this.toast('downbeat aligned');
  }

  genre(): GenreId {
    return this.source.genre();
  }

  setGenre(g: GenreId): void {
    this.synth.setGenre(g);
    this.input.setGenre(g);
  }

  bpm(): number {
    return this.source.transport().bpm;
  }

  bpmAuto(): boolean {
    return this.mode === 'synth';
  }

  setBpm(v: number | null): void {
    if (this.mode === 'synth') this.synth.setBpm(v);
    else if (v !== null) this.input.setBpm(v);
  }

  energy(): number {
    return this.synth.energyParam;
  }

  setEnergy(v: number): void {
    this.synth.setEnergy(v);
  }

  nudgeEnergy(delta: number): void {
    this.setEnergy(clamp01(this.synth.energyParam + delta));
    this.toast(`energy ${Math.round(this.synth.energyParam * 100)}%`);
  }

  setFilter(v: number): void {
    this.engine.setFilter(v);
  }

  setFilterHeld(held: boolean): void {
    this.synth.filterHeldByUser = held;
  }

  forceSection(s: Section): void {
    if (this.mode === 'synth') this.synth.forceSection(s);
    else this.toast('section jumps need the synth engine');
  }

  seed(): string {
    return this.seedValue;
  }

  setSeed(s: string): void {
    this.seedValue = s;
    this.synth.setSeed(s);
    this.director.setSeed(s);
  }

  // ---------------------------------------------------- PanelApi: console

  manual(): ManualState {
    return this.manualState;
  }

  setManualEnabled(v: boolean): void {
    this.manualState.enabled = v;
  }

  sceneId(): string {
    return this.scene.id;
  }

  setScene(id: string): void {
    const scene = sceneById(id);
    if (scene.id === this.scene.id) return;
    this.applyScene(scene);
  }

  cameraMode(): CameraMode {
    return this.renderer.camera.mode;
  }

  setCameraMode(m: CameraMode): void {
    this.renderer.camera.mode = m;
  }

  cameraCut(): void {
    this.renderer.camera.cut();
  }

  hazeBurst(): void {
    this.rig.burstHaze(0.9);
  }

  quality(): Quality {
    return this.renderer.quality;
  }

  setQuality(q: Quality): void {
    this.renderer.setQuality(q);
  }

  adaptiveQuality(): boolean {
    return this.renderer.adaptive;
  }

  setAdaptiveQuality(v: boolean): void {
    this.renderer.adaptive = v;
  }

  reduceFlashing(): boolean {
    return this.reduce;
  }

  setReduceFlashing(v: boolean): void {
    this.reduce = v;
    this.rig.safety.reduceFlashing = v;
    this.rig.safety.maxStrobeHz = v ? REDUCED_MAX_STROBE_HZ : SAFE_DEFAULTS.maxStrobeHz;
  }

  palette(): RGB[] {
    return GENRES[this.source.genre()].lighting.palette;
  }

  toast(message: string): void {
    this.panel?.toast(message);
  }
}

// ---------------------------------------------------------------- bootstrap

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui');

if (!canvas || !uiRoot) {
  throw new Error('missing #stage or #ui in the document');
}

showGate((reduceFlashing) => {
  const app = new App(canvas, uiRoot, reduceFlashing);
  // Expose for debugging and for the screenshot script.
  (window as unknown as { raveNights: App }).raveNights = app;
});
