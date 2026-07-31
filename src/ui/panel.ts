import { GENRES } from '../audio/genres';
import { GENRE_IDS, type GenreId, type RGB, type Section } from '../core/types';
import { CAMERA_MODES, type CameraMode } from '../gfx/camera';
import { QUALITIES, type Quality } from '../gfx/renderer';
import { INTENSITIES, LASER_CUES, MOVEMENTS } from '../lighting/cues';
import type { ManualState } from '../lighting/director';
import { SCENES } from '../scenes';
import {
  bashButton,
  chips,
  el,
  row,
  slider,
  toggleChip,
  type ChipGroup,
  type SliderControl,
} from './dom';

export type SourceMode = 'synth' | 'file' | 'spotify' | 'mic';

interface ToggleControl {
  root: HTMLButtonElement;
  set(v: boolean): void;
}

/** Everything the panels need from the app. Implemented by `App`. */
export interface PanelApi {
  isPlaying(): boolean;
  togglePlay(): void;

  sourceMode(): SourceMode;
  setSourceMode(mode: SourceMode): void;
  loadFile(file: File): void;
  inputLabel(): string;
  tap(): void;
  align(): void;

  genre(): GenreId;
  setGenre(g: GenreId): void;
  bpm(): number;
  bpmAuto(): boolean;
  setBpm(v: number | null): void;
  energy(): number;
  setEnergy(v: number): void;
  setFilter(v: number): void;
  setFilterHeld(held: boolean): void;
  forceSection(s: Section): void;
  seed(): string;
  setSeed(s: string): void;

  manual(): ManualState;
  setManualEnabled(v: boolean): void;

  sceneId(): string;
  setScene(id: string): void;
  cameraMode(): CameraMode;
  setCameraMode(m: CameraMode): void;
  quality(): Quality;
  setQuality(q: Quality): void;
  adaptiveQuality(): boolean;
  setAdaptiveQuality(v: boolean): void;
  reduceFlashing(): boolean;
  setReduceFlashing(v: boolean): void;
  tripLevel(): number;
  tripBias(): number;
  setTripBias(v: number): void;

  palette(): RGB[];

  cinematic(): boolean;
  setCinematic(v: boolean): void;
  bokeh(): number;
  setBokeh(v: number): void;
  shutter(): number;
  setShutter(v: number): void;
  setLetterbox(v: number): void;

  toast(message: string): void;
}

export interface ReadoutInfo {
  genre: string;
  bpm: number;
  bar: number;
  beat: number;
  section: string;
  barsToNext: number;
  cue: string;
  armed: boolean;
  frameMs: number;
  quality: string;
  shot: string;
  confident: boolean;
  /** 0..1 — how far gone the visuals are. */
  trip: number;
}

const rgbCss = (c: RGB): string =>
  `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;

/**
 * The control surface: a DJ deck on the left, a lighting console on the right.
 *
 * Both stay on screen at once. The point of the app is that you can seize any
 * part of it mid-set — hiding the console behind a mode switch would make
 * grabbing the strobe a two-step operation, and a bash button you have to
 * navigate to is a bash button you will never press in time.
 */
export class Panel {
  readonly root: HTMLDivElement;
  private api: PanelApi;

  private readoutEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;

  private genreChips: ChipGroup<GenreId>;
  private sourceChips: ChipGroup<SourceMode>;
  private sceneChips: ChipGroup<string>;
  private cameraChips: ChipGroup<CameraMode>;
  private qualityChips: ChipGroup<Quality>;
  private bpmSlider: SliderControl;
  private energySlider: SliderControl;
  private manualToggle: ToggleControl;
  private flashToggle: ToggleControl;
  private swatchButtons: HTMLButtonElement[] = [];
  private inputLabelEl: HTMLDivElement;
  private playButton: HTMLButtonElement;
  private releaseBashes: Array<() => void> = [];

  private hidden = false;

  constructor(mount: HTMLElement, api: PanelApi) {
    this.api = api;
    this.root = el('div');
    this.root.style.display = 'contents';

    this.readoutEl = el('div', 'readout');
    this.toastEl = el('div', 'toast');

    const panels = el('div', 'panels');
    const deck = el('div', 'panel');
    const console_ = el('div', 'panel');
    panels.append(deck, console_);

    // ---------------------------------------------------------- deck
    deck.appendChild(el('h2', undefined, 'DECK'));

    const transport = el('div', 'group');
    this.playButton = el('button', 'chip wide', 'PLAY');
    this.playButton.type = 'button';
    this.playButton.addEventListener('click', () => {
      api.togglePlay();
      this.syncPlayButton();
    });
    transport.appendChild(this.playButton);

    const dropBtn = el('button', 'chip wide danger', 'DROP');
    dropBtn.type = 'button';
    dropBtn.addEventListener('click', () => {
      api.forceSection('drop');
      api.toast('drop armed — lands on the next bar');
    });
    const breakBtn = el('button', 'chip wide', 'BREAKDOWN');
    breakBtn.type = 'button';
    breakBtn.addEventListener('click', () => {
      api.forceSection('breakdown');
      api.toast('breakdown armed');
    });
    transport.append(dropBtn, breakBtn);
    deck.appendChild(transport);

    const srcRow = row('AUDIO SOURCE');
    this.sourceChips = chips<SourceMode>(
      ['synth', 'file', 'spotify', 'mic'],
      api.sourceMode(),
      (m) => {
        api.setSourceMode(m);
        this.refresh();
      },
      (m) => (m === 'synth' ? 'SYNTH ENGINE' : m === 'spotify' ? 'SPOTIFY' : m.toUpperCase()),
    );
    srcRow.root.appendChild(this.sourceChips.root);
    deck.appendChild(srcRow.root);

    // File drop target, plus TAP/ALIGN for the analysis modes.
    const drop = el('div', 'filedrop', 'drop an audio file here, or click to browse');
    this.fileDrop = drop;
    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) api.loadFile(f);
    });
    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer?.files?.[0];
      if (f) api.loadFile(f);
    });

    this.inputLabelEl = el('div', 'note', '');
    const beatTools = el('div', 'group');
    for (const [label, fn, hint] of [
      ['TAP', () => api.tap(), 'tap four beats to set the tempo'],
      ['ALIGN', () => api.align(), 'press on the "1" to fix the downbeat'],
    ] as const) {
      const b = el('button', 'chip wide', label);
      b.type = 'button';
      b.title = hint;
      b.addEventListener('click', fn);
      beatTools.appendChild(b);
    }

    const loopbackHelp = el('div', 'note');
    loopbackHelp.innerHTML =
      'Spotify\u2019s own audio is DRM-protected and its beat-analysis API was retired in 2024, ' +
      'so the only way in is to capture what your machine is playing:<br>' +
      '<b>1.</b> install a loopback device \u2014 BlackHole (macOS), VB-Cable (Windows), ' +
      'or PulseAudio\u2019s monitor source (Linux)<br>' +
      '<b>2.</b> set it as your system output, then pick it when the browser asks for a microphone<br>' +
      '<b>3.</b> press play in Spotify \u2014 the rig locks on within a few bars<br>' +
      'No loopback device? Selecting your actual microphone still works if the music is loud enough.';
    this.loopbackHelp = loopbackHelp;

    const inputSection = el('div', 'row');
    inputSection.append(drop, fileInput, loopbackHelp, this.inputLabelEl, beatTools);
    deck.appendChild(inputSection);
    this.inputSection = inputSection;

    const genreRow = row('GENRE');
    this.genreChips = chips<GenreId>(
      GENRE_IDS,
      api.genre(),
      (g) => {
        api.setGenre(g);
        this.refresh();
        api.toast(`${GENRES[g].name} — ${GENRES[g].blurb}`);
      },
      (g) => GENRES[g].name.toUpperCase(),
    );
    genreRow.root.appendChild(this.genreChips.root);
    deck.appendChild(genreRow.root);

    this.bpmSlider = slider('TEMPO', 70, 200, 1, api.bpm(), (v) => api.setBpm(v), (v) => `${Math.round(v)} BPM`);
    deck.appendChild(this.bpmSlider.root);

    const autoBpm = el('button', 'chip wide', 'FOLLOW GENRE TEMPO');
    autoBpm.type = 'button';
    autoBpm.addEventListener('click', () => {
      api.setBpm(null);
      this.refresh();
    });
    deck.appendChild(autoBpm);

    this.energySlider = slider('ENERGY', 0, 1, 0.01, api.energy(), (v) => api.setEnergy(v), (v) =>
      `${Math.round(v * 100)}%`,
    );
    deck.appendChild(this.energySlider.root);

    const filter = slider(
      'FILTER',
      0,
      1,
      0.005,
      0.5,
      (v) => api.setFilter(v),
      (v) => (v < 0.49 ? 'LOW-PASS' : v > 0.51 ? 'HIGH-PASS' : 'OPEN'),
      (held) => api.setFilterHeld(held),
    );
    deck.appendChild(filter.root);

    const seedRow = row('SEED');
    const seedInput = el('input');
    seedInput.type = 'text';
    seedInput.value = api.seed();
    seedInput.spellcheck = false;
    seedInput.addEventListener('change', () => {
      api.setSeed(seedInput.value.trim() || 'rave-nights');
      api.toast('seed set — the same seed replays the same set');
    });
    seedRow.root.appendChild(seedInput);
    deck.appendChild(seedRow.root);

    // ---------------------------------------------------------- console
    console_.appendChild(el('h2', undefined, 'LIGHTING CONSOLE'));

    this.manualToggle = toggleChip('MANUAL OVERRIDE', api.manual().enabled, (v) => {
      api.setManualEnabled(v);
      this.refresh();
      api.toast(v ? 'you have the desk' : 'auto operator has the desk');
    }, true);
    console_.appendChild(this.manualToggle.root);

    const tripRow = row('TRIP');
    const tripMeter = el('div', 'meter');
    const tripFill = el('div', 'meter-fill');
    tripMeter.appendChild(tripFill);
    this.tripFill = tripFill;
    tripRow.root.appendChild(tripMeter);
    const tripBias = slider(
      'TRIP BIAS',
      -1,
      1,
      0.01,
      0,
      (v) => api.setTripBias(v),
      (v) => (Math.abs(v) < 0.005 ? 'FOLLOW MUSIC' : v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
    );
    tripRow.root.appendChild(tripBias.root);
    this.tripBiasSlider = tripBias;
    console_.appendChild(tripRow.root);

    const bashes = el('div', 'group');
    bashes.style.marginTop = '8px';
    const strobe = bashButton('STROBE', (held) => {
      api.manual().strobeBash = held;
    });
    const blinder = bashButton('BLINDER', (held) => {
      api.manual().blinderBash = held;
    });
    this.releaseBashes.push(strobe.release, blinder.release);
    bashes.append(strobe.root, blinder.root);
    console_.appendChild(bashes);
    this.strobeBash = strobe.root;
    this.blinderBash = blinder.root;

    const groups: Array<[keyof ManualState['groups'], string]> = [
      ['beams', 'BEAMS'],
      ['washes', 'WASHES'],
      ['lasers', 'LASERS'],
      ['bars', 'LED BARS'],
      ['wall', 'LED WALL'],
    ];
    for (const [key, label] of groups) {
      const s = slider(label, 0, 1, 0.01, 1, (v) => {
        api.manual().groups[key] = v;
      }, (v) => `${Math.round(v * 100)}%`);
      console_.appendChild(s.root);
    }

    const colorRow = row('COLOUR');
    const swatches = el('div', 'swatches');
    this.swatchesEl = swatches;
    colorRow.root.appendChild(swatches);
    console_.appendChild(colorRow.root);

    const movementRow = row('MOVEMENT');
    movementRow.root.appendChild(
      chips(
        ['auto', ...MOVEMENTS.map((m) => m.name)],
        'auto',
        (v) => {
          api.manual().movement = v === 'auto' ? null : v;
        },
      ).root,
    );
    console_.appendChild(movementRow.root);

    const intensityRow = row('DIMMER EFFECT');
    intensityRow.root.appendChild(
      chips(
        ['auto', ...INTENSITIES.map((i) => i.name)],
        'auto',
        (v) => {
          api.manual().intensity = v === 'auto' ? null : v;
        },
      ).root,
    );
    console_.appendChild(intensityRow.root);

    const laserRow = row('LASER EFFECT');
    laserRow.root.appendChild(
      chips(
        ['auto', ...LASER_CUES.map((l) => l.name)],
        'auto',
        (v) => {
          api.manual().laser = v === 'auto' ? null : v;
        },
      ).root,
    );
    console_.appendChild(laserRow.root);

    const strobeRate = slider('STROBE RATE', 1, 20, 0.5, 10, (v) => {
      api.manual().strobeRate = v;
    }, (v) => `${v.toFixed(1)} Hz`);
    console_.appendChild(strobeRate.root);

    const haze = slider('HAZE', 0, 2, 0.01, 1, (v) => {
      api.manual().haze = v;
    }, (v) => v.toFixed(2));
    console_.appendChild(haze.root);

    const filmToggle = toggleChip('FILM LOOK', api.cinematic(), (v) => {
      api.setCinematic(v);
      api.toast(v ? 'lens, matte and grain on' : 'clean render');
    });
    console_.appendChild(filmToggle.root);
    this.filmToggle = filmToggle;

    const bokeh = slider('DEPTH OF FIELD', 0, 30, 0.5, api.bokeh(), (v) => api.setBokeh(v), (v) =>
      v < 0.5 ? 'DEEP FOCUS' : `${v.toFixed(0)}px`,
    );
    console_.appendChild(bokeh.root);
    this.bokehSlider = bokeh;

    const shutter = slider('MOTION BLUR', 0, 1.5, 0.01, api.shutter(), (v) => api.setShutter(v), (v) =>
      v < 0.01 ? 'OFF' : v.toFixed(2),
    );
    console_.appendChild(shutter.root);
    this.shutterSlider = shutter;

    const matte = chips(
      ['off', '2.39', '1.85', '1.33'],
      '2.39',
      (v) => api.setLetterbox(v === 'off' ? 0 : Number(v)),
      (v) => (v === 'off' ? 'FULL FRAME' : `${v}:1`),
    );
    const matteRow = row('MATTE');
    matteRow.root.appendChild(matte.root);
    console_.appendChild(matteRow.root);

    const sceneRow = row('ROOM');
    this.sceneChips = chips(
      SCENES.map((s) => s.id),
      api.sceneId(),
      (id) => {
        api.setScene(id);
        this.refresh();
        const s = SCENES.find((x) => x.id === id);
        if (s) api.toast(`${s.name} — ${s.blurb}`);
      },
      (id) => (SCENES.find((s) => s.id === id)?.name ?? id).toUpperCase(),
    );
    sceneRow.root.appendChild(this.sceneChips.root);
    console_.appendChild(sceneRow.root);

    const camRow = row('CAMERA');
    this.cameraChips = chips<CameraMode>(CAMERA_MODES, api.cameraMode(), (m) => api.setCameraMode(m));
    camRow.root.appendChild(this.cameraChips.root);
    console_.appendChild(camRow.root);

    const qRow = row('QUALITY');
    this.qualityChips = chips<Quality>(QUALITIES, api.quality(), (q) => {
      api.setAdaptiveQuality(false);
      api.setQuality(q);
      this.refresh();
    });
    qRow.root.appendChild(this.qualityChips.root);
    const adaptive = toggleChip('ADAPTIVE', api.adaptiveQuality(), (v) => api.setAdaptiveQuality(v));
    qRow.root.appendChild(adaptive.root);
    this.adaptiveToggle = adaptive;
    console_.appendChild(qRow.root);

    this.flashToggle = toggleChip('REDUCE FLASHING', api.reduceFlashing(), (v) => {
      api.setReduceFlashing(v);
      api.toast(v ? 'flashing reduced' : 'full intensity restored');
    }, true);
    console_.appendChild(this.flashToggle.root);

    console_.appendChild(
      el(
        'div',
        'note',
        'SPACE strobe · B blinder · 1-6 laser cues · D drop · X breakdown · ' +
          'Q/W/E rooms · C camera cut · H haze burst · ↑/↓ energy · ←/→ trip · ' +
          'F fullscreen · TAB hide UI',
      ),
    );

    mount.append(this.readoutEl, panels);
    document.body.appendChild(this.toastEl);

    this.buildSwatches();
    this.refresh();
  }

  private inputSection: HTMLElement;
  private swatchesEl: HTMLElement;
  private strobeBash: HTMLButtonElement;
  private blinderBash: HTMLButtonElement;
  private adaptiveToggle: ToggleControl;
  private filmToggle: ToggleControl;
  private bokehSlider: SliderControl;
  private shutterSlider: SliderControl;
  private tripFill: HTMLElement;
  private tripBiasSlider: SliderControl;
  private loopbackHelp: HTMLElement;
  private fileDrop: HTMLElement;

  /** Palette swatches follow the current genre, plus AUTO and white. */
  private buildSwatches(): void {
    this.swatchesEl.textContent = '';
    this.swatchButtons = [];

    const mk = (color: RGB | null, title: string, css: string): void => {
      const b = el('button', 'swatch');
      b.type = 'button';
      b.title = title;
      b.style.background = css;
      b.addEventListener('click', () => {
        this.api.manual().color = color;
        for (const other of this.swatchButtons) other.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
      });
      this.swatchButtons.push(b);
      this.swatchesEl.appendChild(b);
    };

    mk(null, 'follow the auto operator', 'linear-gradient(135deg,#4de2ff,#ff3d8b)');
    for (const c of this.api.palette()) mk(c, 'palette colour', rgbCss(c));
    mk([1, 1, 1], 'white', '#fff');

    const active = this.api.manual().color;
    this.swatchButtons[0].setAttribute('aria-pressed', String(active === null));
  }

  /** Re-sync every control with app state. Cheap; safe to call on any change. */
  refresh(): void {
    const api = this.api;
    this.genreChips.set(api.genre());
    this.sourceChips.set(api.sourceMode());
    this.sceneChips.set(api.sceneId());
    this.cameraChips.set(api.cameraMode());
    this.qualityChips.set(api.quality());
    this.bpmSlider.set(Math.round(api.bpm()));
    this.energySlider.set(api.energy());
    this.manualToggle.set(api.manual().enabled);
    this.flashToggle.set(api.reduceFlashing());
    this.adaptiveToggle.set(api.adaptiveQuality());
    this.tripBiasSlider.set(api.tripBias());
    this.filmToggle.set(api.cinematic());
    this.bokehSlider.set(api.bokeh());
    this.shutterSlider.set(api.shutter());
    this.syncPlayButton();
    this.buildSwatches();

    const mode = api.sourceMode();
    const isSynth = mode === 'synth';
    this.inputSection.style.display = isSynth ? 'none' : '';
    this.inputLabelEl.textContent = isSynth ? '' : `input: ${api.inputLabel()}`;
    this.loopbackHelp.style.display = mode === 'spotify' ? '' : 'none';
    this.fileDrop.style.display = mode === 'file' ? '' : 'none';
  }

  private syncPlayButton(): void {
    const playing = this.api.isPlaying();
    this.playButton.textContent = playing ? 'STOP' : 'PLAY';
    this.playButton.setAttribute('aria-pressed', String(playing));
  }

  /** Reflect keyboard-driven bashes in the buttons. */
  setBashVisual(strobe: boolean, blinder: boolean): void {
    this.strobeBash.classList.toggle('active', strobe);
    this.blinderBash.classList.toggle('active', blinder);
  }

  /** Release any held bash button — used when the window loses focus. */
  releaseAllBashes(): void {
    for (const r of this.releaseBashes) r();
  }

  toggleVisibility(): void {
    this.hidden = !this.hidden;
    this.readoutEl.parentElement?.classList.toggle('hidden', this.hidden);
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }

  updateReadout(info: ReadoutInfo): void {
    const next =
      info.barsToNext >= 0 ? `${info.barsToNext} bar${info.barsToNext === 1 ? '' : 's'} to next` : 'inferred';
    this.readoutEl.innerHTML = '';

    const add = (cls: string, html: string): void => {
      const n = el('div', cls);
      n.innerHTML = html;
      this.readoutEl.appendChild(n);
    };

    add('big', info.genre.toUpperCase());
    add('item', `<b>${Math.round(info.bpm)}</b> BPM`);
    add('item', `BAR <b>${info.bar + 1}</b>.${info.beat + 1}`);
    add(
      info.armed ? 'item armed' : 'item',
      `${info.section.toUpperCase()} · ${info.armed ? 'DROP ARMED' : next}`,
    );
    add('item', `CUE <b>${info.cue}</b>`);
    add('item', `TRIP <b>${Math.round(info.trip * 100)}</b>%`);
    add('item', `${info.shot.toUpperCase()} · ${info.quality.toUpperCase()} · <b>${info.frameMs.toFixed(1)}</b>ms`);
    // The meter is the live one; the readout number is for reference.
    this.tripFill.style.width = `${(info.trip * 100).toFixed(1)}%`;
    if (!info.confident) add('item', 'BEAT GRID UNCERTAIN — TAP / ALIGN');
  }
}
