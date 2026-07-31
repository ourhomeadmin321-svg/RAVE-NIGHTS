import { bus } from '../core/bus';
import { STEPS_PER_BAR, positionOfStep } from '../core/clock';
import type { Bands, GenreId, MusicSource, Onsets, Section, Transport } from '../core/types';
import { SpectralAnalyser, detectBpm } from './analysis';
import type { AudioEngine } from './engine';

/**
 * `MusicSource` backed by audio the user supplies — a dropped file or the mic.
 *
 * Everything here is inference. There is no score to read, so the transport is
 * recovered by autocorrelating the onset envelope for tempo and phase-locking a
 * beat grid to detected kicks. It reports `confident: false` until the tracker
 * settles, and `barsToNextSection()` always returns -1: we genuinely do not
 * know where the next drop is, and the lighting director is written to fall
 * back to reactive cues rather than pretend otherwise.
 */
export class InputSource implements MusicSource {
  readonly kind = 'input';

  private engine: AudioEngine;
  private analyser: SpectralAnalyser;

  private source: AudioBufferSourceNode | MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private inputGain: GainNode;

  private _genre: GenreId = 'techno';
  private _bpm = 128;
  private bpmConfidence = 0;
  private anchorTime = 0;
  private anchorStep = 0;
  private frameRate = 60;
  private frameTimes: number[] = [];
  private sinceTempoScan = 0;

  private taps: number[] = [];

  private _section: Section = 'intro';
  private energyHistory: number[] = [];
  private subHistory: number[] = [];

  private _label = 'no input';

  constructor(engine: AudioEngine) {
    this.engine = engine;
    this.analyser = new SpectralAnalyser(engine.analyser);
    this.inputGain = engine.ctx.createGain();
    this.inputGain.gain.value = 1;
    this.anchorTime = engine.currentTime;
  }

  get label(): string {
    return this._label;
  }

  get confidence(): number {
    return this.bpmConfidence;
  }

  // ------------------------------------------------------------ sources

  /** Decode and play a user-provided audio file. */
  async loadFile(file: File): Promise<void> {
    const bytes = await file.arrayBuffer();
    const buffer = await this.engine.ctx.decodeAudioData(bytes);
    this.disconnect();
    await this.engine.resume();

    const node = this.engine.ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.connect(this.inputGain);
    this.engine.connectExternal(this.inputGain, true);
    node.start();

    this.source = node;
    this._label = file.name;
    this.resetTracking();
    bus.emit('audio:started', {});
  }

  /**
   * Capture Spotify (or anything else the machine is playing) through a
   * loopback device.
   *
   * There is no API route for this. Spotify's Web Playback SDK renders through
   * a DRM-protected pipeline that cannot be connected to an AnalyserNode, and
   * the Web API endpoints that used to expose beats, bars and sections without
   * touching the audio — /audio-analysis and /audio-features — were deprecated
   * in November 2024 and return 403 for any app without pre-existing extended
   * quota. Capturing the output is the only path that still works, and it is
   * what VJ software does for exactly the same reason.
   *
   * Mechanically this is `getUserMedia` with every "helpful" processing stage
   * switched off. Echo cancellation and noise suppression are tuned for speech
   * and will gut a kick drum; auto gain will fight the track's own dynamics and
   * flatten the build-ups the beat tracker relies on.
   */
  async useSystemAudio(): Promise<void> {
    return this.useMicrophone('system audio');
  }

  /**
   * Capture the microphone. Deliberately *not* routed to the speakers — doing
   * so in a room with the music playing is a feedback loop.
   */
  async useMicrophone(label = 'microphone'): Promise<void> {
    // In a sandboxed iframe or on an insecure origin the whole API is absent
    // rather than merely denied, so this has to be a presence check and not a
    // rejection handler.
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('microphone capture is unavailable in this context');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.disconnect();
    await this.engine.resume();

    const node = this.engine.ctx.createMediaStreamSource(stream);
    node.connect(this.inputGain);
    this.engine.connectExternal(this.inputGain, false);

    this.stream = stream;
    this.source = node;
    this._label = label;
    this.resetTracking();
    bus.emit('audio:started', {});
  }

  disconnect(): void {
    if (this.source) {
      try {
        if ('stop' in this.source) this.source.stop();
      } catch {
        // Already stopped — nothing to do.
      }
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    try {
      this.inputGain.disconnect();
    } catch {
      // Not connected yet.
    }
    this._label = 'no input';
  }

  dispose(): void {
    this.disconnect();
  }

  private resetTracking(): void {
    this.bpmConfidence = 0;
    this.anchorTime = this.engine.currentTime;
    this.anchorStep = 0;
    this.energyHistory = [];
    this.subHistory = [];
    this.sinceTempoScan = 0;
  }

  // ------------------------------------------------------------ user aids

  /** Nudge the grid so the current moment is a downbeat. */
  align(): void {
    this.anchorTime = this.engine.currentTime;
    this.anchorStep = 0;
  }

  /** Tap tempo — four or more taps give a usable estimate. */
  tap(): number | null {
    const now = performance.now() / 1000;
    if (this.taps.length > 0 && now - this.taps[this.taps.length - 1] > 2.5) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 8) this.taps.shift();
    if (this.taps.length < 4) return null;

    const intervals: number[] = [];
    for (let i = 1; i < this.taps.length; i++) intervals.push(this.taps[i] - this.taps[i - 1]);
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    if (median <= 0) return null;

    this._bpm = Math.max(70, Math.min(200, 60 / median));
    this.bpmConfidence = Math.max(this.bpmConfidence, 0.7);
    this.align();
    return this._bpm;
  }

  setGenre(g: GenreId): void {
    if (g === this._genre) return;
    this._genre = g;
    bus.emit('genre:change', { genre: g });
  }

  setBpm(bpm: number): void {
    this._bpm = Math.max(70, Math.min(200, bpm));
    this.bpmConfidence = Math.max(this.bpmConfidence, 0.6);
  }

  // ------------------------------------------------------- MusicSource

  transport(): Transport {
    const step = this.anchorStep + (this.engine.currentTime - this.anchorTime) / this.secondsPerStep;
    return positionOfStep(step, this._bpm, this.bpmConfidence > 0.35);
  }

  section(): Section {
    return this._section;
  }

  /** Unknown by construction — we cannot see the future of someone else's track. */
  barsToNextSection(): number {
    return -1;
  }

  sectionProgress(): number {
    return 0.5;
  }

  nextSection(): Section {
    return this._section;
  }

  bands(): Bands {
    return this.analyser.bands();
  }

  onsets(): Onsets {
    return this.analyser.onsets();
  }

  energy(): number {
    return this.analyser.energy();
  }

  genre(): GenreId {
    return this._genre;
  }

  update(dt: number): void {
    this.analyser.update(dt);
    this.trackFrameRate(dt);
    this.trackTempo(dt);
    this.trackPhase();
    this.inferSection(dt);
  }

  // ------------------------------------------------------------ tracking

  private get secondsPerStep(): number {
    return 60 / this._bpm / 4;
  }

  /**
   * The onset envelope is sampled once per rendered frame, so its sample rate
   * is the frame rate — which is not exactly 60 and drifts. Measuring it
   * directly keeps the tempo estimate honest on a 144Hz display or a throttled
   * tab.
   */
  private trackFrameRate(dt: number): void {
    if (dt <= 0 || dt > 0.5) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    const mean = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    if (mean > 0) this.frameRate = 1 / mean;
  }

  private trackTempo(dt: number): void {
    this.sinceTempoScan += dt;
    if (this.sinceTempoScan < 1.0) return;
    this.sinceTempoScan = 0;

    const env = this.analyser.envelope();
    if (env.length < 180) return;

    const est = detectBpm(env, this.frameRate, 70, 200);
    if (est.bpm <= 0) return;

    // Only accept a new tempo when the tracker is reasonably sure, and ease
    // toward it so a single bad scan cannot yank the whole grid.
    if (est.confidence > 0.25) {
      const blend = est.confidence > 0.6 ? 0.5 : 0.2;
      const prevSpS = this.secondsPerStep;
      this.anchorStep += (this.engine.currentTime - this.anchorTime) / prevSpS;
      this.anchorTime = this.engine.currentTime;
      this._bpm = this._bpm * (1 - blend) + est.bpm * blend;
      this.bpmConfidence = this.bpmConfidence * 0.6 + est.confidence * 0.4;
    } else {
      this.bpmConfidence *= 0.9;
    }
  }

  /**
   * Phase-lock the grid to detected kicks: when a kick lands near a beat line,
   * pull the anchor a fraction of the way toward it. Small corrections only —
   * a hard snap on every kick would make the grid jitter on syncopated tracks.
   */
  private trackPhase(): void {
    if (!this.analyser.onsets().kick || this.bpmConfidence < 0.2) return;

    const spb = this.secondsPerStep * 4; // seconds per beat
    const now = this.engine.currentTime;
    const beatsSinceAnchor = (now - this.anchorTime) / spb + this.anchorStep / 4;
    const err = beatsSinceAnchor - Math.round(beatsSinceAnchor); // -0.5..0.5 beats
    if (Math.abs(err) > 0.3) return; // too far off a beat to be the one

    this.anchorTime += err * spb * 0.25;
  }

  private inferSection(dt: number): void {
    const e = this.analyser.energy();
    const b = this.analyser.bands();
    push(this.energyHistory, e, 240);
    push(this.subHistory, b.sub, 240);
    if (this.energyHistory.length < 60) return;

    const recent = avg(this.energyHistory.slice(-30));
    const older = avg(this.energyHistory.slice(-120, -30));
    const sub = avg(this.subHistory.slice(-30));
    const rising = recent - older;

    let next: Section;
    if (sub > 0.35 && recent > 0.5) {
      next = 'drop';
    } else if (sub < 0.18 && recent < 0.35) {
      next = 'breakdown';
    } else if (rising > 0.05 && b.high > 0.35) {
      next = 'build';
    } else if (recent < 0.2) {
      next = 'intro';
    } else {
      next = this._section;
    }

    // Hysteresis: sections must persist for a moment before we commit, or the
    // lights will flicker between looks on every transient.
    if (next !== this._section) {
      this.pendingSection = next === this.pendingSection ? next : next;
      this.pendingFor += dt;
      if (this.pendingFor > 0.8) {
        this._section = next;
        this.pendingFor = 0;
        bus.emit('arrangement:section', { section: next, bar: this.transport().bar });
      }
    } else {
      this.pendingFor = 0;
    }
  }

  private pendingSection: Section = 'intro';
  private pendingFor = 0;
}

function push(arr: number[], v: number, max: number): void {
  arr.push(v);
  if (arr.length > max) arr.shift();
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export { STEPS_PER_BAR };
