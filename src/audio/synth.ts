import { bus } from '../core/bus';
import { Clock, STEPS_PER_BAR, barOfStep } from '../core/clock';
import { Rng } from '../core/rng';
import type { Bands, GenreId, MusicSource, Onsets, Section, Transport } from '../core/types';
import { Arrangement, type ArrangementState } from './arrangement';
import { SpectralAnalyser } from './analysis';
import type { AudioEngine } from './engine';
import { GENRES, cycleFor, mtof, scaleNote, stepVelocity, type GenreDef } from './genres';
import * as V from './voices';

/** Standard Web Audio lookahead scheduling constants. */
const TICK_MS = 25;
const SCHEDULE_AHEAD = 0.1; // seconds

interface VisualEvent {
  time: number;
  kind: keyof Onsets;
}

/** Which layers are audible in a given section, and how loud. */
interface SectionMix {
  kick: number;
  snare: number;
  hat: number;
  perc: number;
  bass: number;
  lead: number;
  pad: number;
}

/**
 * The procedural set.
 *
 * This is the authoritative `MusicSource`: it *generates* the music, so it
 * knows the exact bar the next drop lands on and can hand the lighting director
 * real foreknowledge rather than a guess. That is the whole reason the synth
 * mode looks better than the analysis mode — the LD can arm a cue and land it
 * on the beat, which is what a human operator does.
 *
 * Notes are scheduled ahead of the playhead with the standard lookahead
 * pattern, but anything the *visuals* need is queued with its audio timestamp
 * and released only when the playhead actually reaches it. Without that split,
 * lights would fire up to 100ms early.
 */
export class SynthSource implements MusicSource {
  readonly kind = 'synth';

  private engine: AudioEngine;
  private clock: Clock;
  private arrangement: Arrangement;
  private analyser: SpectralAnalyser;
  private rng: Rng;

  private timer: number | null = null;
  private nextStep = 0;
  private _playing = false;

  private _genre: GenreId = 'trance';
  private _energy = 0.7;
  private userBpm: number | null = null;
  private _seed: string;

  private pendingVisuals: VisualEvent[] = [];
  private frameOnsets: Onsets = { kick: false, snare: false, hat: false };

  /** Arrangement snapshots keyed by bar, so visuals can read the *heard* section. */
  private history = new Map<number, ArrangementState>();
  private lastState: ArrangementState;

  /** Tracks the previous bass note so the acid voice can glide into the next. */
  private lastBassMidi = 0;

  constructor(engine: AudioEngine, seed = 'rave-nights') {
    this.engine = engine;
    this._seed = seed;
    this.rng = new Rng(seed);
    this.clock = new Clock(GENRES[this._genre].bpm.default, engine.currentTime);
    this.arrangement = new Arrangement(cycleFor(GENRES[this._genre]));
    this.analyser = new SpectralAnalyser(engine.analyser);
    this.lastState = this.arrangement.state();
    this.history.set(0, this.lastState);
  }

  // ------------------------------------------------------------ transport

  get playing(): boolean {
    return this._playing;
  }

  async start(): Promise<void> {
    if (this._playing) return;
    await this.engine.resume();
    this.clock.reset(this.engine.currentTime + 0.08);
    this.arrangement.reset(0);
    // Start in the drop rather than at the top of the cycle. Trance's opening
    // is intro 16 + build 32 bars, which at 138 BPM puts the first drop 83
    // seconds after you press play — long enough that the app looks broken to
    // anyone who just opened it. `force` lands on the next bar line, so bar 0
    // is a brief intro and the room opens up at bar 1; the normal cycle carries
    // on from there. Musically this is just walking into a club mid-set, which
    // is how anyone actually arrives at one.
    this.arrangement.force('drop');
    this.history.clear();
    this.nextStep = 0;
    this.pendingVisuals = [];
    this._playing = true;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
    bus.emit('audio:started', {});
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this._playing = false;
    this.pendingVisuals = [];
  }

  dispose(): void {
    this.stop();
  }

  // ------------------------------------------------------------ controls

  get currentGenre(): GenreId {
    return this._genre;
  }

  setGenre(g: GenreId): void {
    if (g === this._genre) return;
    this._genre = g;
    const def = GENRES[g];
    this.arrangement.setCycle(cycleFor(def));
    if (this.userBpm === null) {
      this.clock.setBpm(def.bpm.default, this.engine.currentTime);
    }
    bus.emit('genre:change', { genre: g });
  }

  get bpm(): number {
    return this.clock.bpm;
  }

  /** Pass null to follow the genre's default tempo. */
  setBpm(bpm: number | null): void {
    this.userBpm = bpm;
    const def = GENRES[this._genre];
    this.clock.setBpm(bpm ?? def.bpm.default, this.engine.currentTime);
  }

  setEnergy(e: number): void {
    this._energy = Math.max(0, Math.min(1, e));
  }

  get energyParam(): number {
    return this._energy;
  }

  get seed(): string {
    return this._seed;
  }

  setSeed(seed: string): void {
    this._seed = seed;
    this.rng = new Rng(seed);
  }

  /** Queue a section jump; it lands on the next bar line. */
  forceSection(section: Section): void {
    this.arrangement.force(section);
  }

  // ------------------------------------------------------- MusicSource

  transport(): Transport {
    return this.clock.positionAt(this.engine.currentTime, true);
  }

  section(): Section {
    return this.heardState().section;
  }

  barsToNextSection(): number {
    return this.heardState().barsToNext;
  }

  /** Progress through the current section, 0..1. Drives build-up visuals. */
  sectionProgress(): number {
    return this.heardState().progress;
  }

  nextSection(): Section {
    return this.heardState().nextSection;
  }

  bands(): Bands {
    return this.analyser.bands();
  }

  onsets(): Onsets {
    return this.frameOnsets;
  }

  energy(): number {
    // Blend the user's energy knob with what is actually coming out, so the
    // lights respond to both intent and reality.
    const measured = this.analyser.energy();
    const sectionBoost = this.section() === 'drop' ? 0.25 : this.section() === 'breakdown' ? -0.2 : 0;
    return Math.max(0, Math.min(1, measured * 0.55 + this._energy * 0.45 + sectionBoost));
  }

  genre(): GenreId {
    return this._genre;
  }

  update(dt: number): void {
    this.analyser.update(dt);

    const now = this.engine.currentTime;
    const flags: Onsets = { kick: false, snare: false, hat: false };
    while (this.pendingVisuals.length > 0 && this.pendingVisuals[0].time <= now) {
      const ev = this.pendingVisuals.shift()!;
      flags[ev.kind] = true;
    }
    this.frameOnsets = flags;
  }

  // ------------------------------------------------------------ internals

  private heardState(): ArrangementState {
    const bar = barOfStep(Math.floor(this.clock.stepAt(this.engine.currentTime)));
    return this.history.get(bar) ?? this.lastState;
  }

  private tick(): void {
    if (!this._playing) return;
    const horizon = this.engine.currentTime + SCHEDULE_AHEAD;
    // Bound the loop so a suspended tab that resumes cannot schedule thousands
    // of steps in one tick.
    let guard = 0;
    while (this.clock.timeOfStep(this.nextStep) < horizon && guard++ < 256) {
      this.scheduleStep(this.nextStep, this.clock.timeOfStep(this.nextStep));
      this.nextStep++;
    }
    if (guard >= 256) {
      // We fell far behind (tab was backgrounded). Re-anchor to now.
      this.nextStep = Math.ceil(this.clock.stepAt(this.engine.currentTime));
    }
  }

  private scheduleStep(step: number, time: number): void {
    const def = GENRES[this._genre];
    const bar = barOfStep(step);
    const stepInBar = step % STEPS_PER_BAR;

    if (stepInBar === 0) this.onBar(bar, time, def);

    const state = this.history.get(bar) ?? this.lastState;
    const mix = sectionMix(state, this._energy);
    const swungTime = this.applySwing(step, time, def.swing);

    this.scheduleDrums(def, state, mix, stepInBar, swungTime);
    this.scheduleBass(def, mix, stepInBar, bar, swungTime);
    this.scheduleMelody(def, mix, stepInBar, bar, time);
  }

  private onBar(bar: number, time: number, def: GenreDef): void {
    const prev = this.lastState;
    const state = this.arrangement.update(bar);
    this.history.set(bar, state);
    // Keep the map from growing without bound; we only ever look ~1 bar back.
    for (const key of this.history.keys()) {
      if (key < bar - 8) this.history.delete(key);
    }
    this.lastState = state;

    const entered = state.section !== prev.section || state.startBar === bar;
    if (entered) {
      bus.emit('arrangement:section', { section: state.section, bar });
      if (state.section === 'drop') {
        V.impact(this.engine.ctx, this.engine.fxBus, time, 0.7 + this._energy * 0.4);
      }
    }

    // Announce an incoming section a bar early so the lighting director can
    // arm its cue and fire it exactly on the downbeat.
    if (state.barsToNext === 1) {
      bus.emit('arrangement:armed', { section: state.nextSection, barsAway: 1 });
    }

    // Build-up gestures, scaled to the length of the build.
    if (state.section === 'build') {
      if (state.barsIn === 0) {
        const secondsPerBar = this.clock.secondsPerStep * STEPS_PER_BAR;
        V.riser(this.engine.ctx, this.engine.fxBus, time, secondsPerBar * Math.min(8, state.barsToNext), 0.8);
      }
      if (state.barsToNext === 1) {
        V.sweep(this.engine.ctx, this.engine.fxBus, time, this.clock.secondsPerStep * STEPS_PER_BAR, 0.9);
        V.downlifter(this.engine.ctx, this.engine.fxBus, time, this.clock.secondsPerStep * STEPS_PER_BAR, 0.7);
      }
    }

    // The DJ filter follows the arrangement unless the user has grabbed it.
    if (!this.filterHeldByUser) {
      const target = filterForSection(state);
      this.engine.setFilter(target);
    }
    const busMix = sectionMix(state, this._energy);
    this.engine.setBusGains(
      Math.max(busMix.kick, busMix.hat),
      busMix.bass,
      Math.max(busMix.lead, busMix.pad),
      def.lighting.strobeAggression * 0.3 + 0.7,
    );
  }

  /** Set true while the user drags the filter knob so the arrangement stops fighting them. */
  filterHeldByUser = false;

  private applySwing(step: number, time: number, swing: number): number {
    if (swing <= 0) return time;
    // Delay the off-8ths only — the classic shuffle.
    return step % 2 === 1 ? time + this.clock.secondsPerStep * swing : time;
  }

  private scheduleDrums(
    def: GenreDef,
    state: ArrangementState,
    mix: SectionMix,
    stepInBar: number,
    time: number,
  ): void {
    const ctx = this.engine.ctx;
    const out = this.engine.drumBus;
    const inDrop = state.section === 'drop';
    const grid = def.drums;
    const drop = def.dropDrums;

    const lane = (name: keyof typeof grid): string =>
      (inDrop && drop && drop[name]) || grid[name];

    // Kick drops out for the final bar of a build — the oldest trick there is,
    // and still the one that makes a drop hit.
    const kickMuted = state.section === 'build' && state.barsToNext <= 1;

    const kv = stepVelocity(lane('kick'), stepInBar) * mix.kick * (kickMuted ? 0 : 1);
    if (kv > 0) {
      V.kick(ctx, out, time, { vel: kv * (0.85 + this._energy * 0.25), decay: def.halfTime ? 0.55 : 0.42 });
      this.pendingVisuals.push({ time, kind: 'kick' });
    }

    let sv = stepVelocity(lane('snare'), stepInBar) * mix.snare;
    // Accelerating snare roll through the back end of a build.
    if (state.section === 'build') {
      const roll = 1 - Math.min(1, state.barsToNext / 4);
      if (roll > 0.5 && stepInBar % 4 === 0) sv = Math.max(sv, 0.55 * roll);
      if (roll > 0.75 && stepInBar % 2 === 0) sv = Math.max(sv, 0.6 * roll);
      if (roll > 0.95) sv = Math.max(sv, 0.65);
    }
    if (sv > 0) {
      V.snare(ctx, out, time, { vel: sv });
      this.pendingVisuals.push({ time, kind: 'snare' });
    }

    const hv = stepVelocity(lane('hat'), stepInBar) * mix.hat;
    if (hv > 0) {
      V.hat(ctx, out, time, { vel: hv * 0.9 });
      this.pendingVisuals.push({ time, kind: 'hat' });
    }

    const ov = stepVelocity(lane('openHat'), stepInBar) * mix.hat;
    if (ov > 0) V.hat(ctx, out, time, { vel: ov * 0.7, open: true });

    const pv = stepVelocity(lane('perc'), stepInBar) * mix.perc;
    if (pv > 0) V.perc(ctx, out, time, { vel: pv });
  }

  private scheduleBass(
    def: GenreDef,
    mix: SectionMix,
    stepInBar: number,
    bar: number,
    time: number,
  ): void {
    if (mix.bass <= 0.01) return;
    const vel = stepVelocity(def.bassPattern, stepInBar);
    if (vel <= 0) return;

    const ctx = this.engine.ctx;
    const out = this.engine.bassBus;
    const degree = def.progression[Math.floor(bar / 4) % def.progression.length];
    // A little melodic movement inside the bar, chosen deterministically from
    // the seed so a given set is reproducible.
    const wander = this.rng.chance(0.18) ? this.rng.pick([0, 0, 2, -2, 4]) : 0;
    const midi = scaleNote(def.scale, def.root, degree + wander);
    const freq = mtof(midi);
    const dur = this.clock.secondsPerStep * (def.halfTime ? 3.5 : 1.6);
    const v = vel * mix.bass;
    const cutoff = 600 + this._energy * 2600;
    const glide = Math.abs(midi - this.lastBassMidi) > 2 ? this.clock.secondsPerStep * 0.5 : 0;
    this.lastBassMidi = midi;

    switch (def.bassVoice) {
      case 'sub':
        V.subBass(ctx, out, time, { freq, dur, vel: v });
        break;
      case 'acid':
        V.acidBass(ctx, out, time, { freq, dur, vel: v, cutoff, resonance: 10 + this._energy * 10, glide });
        break;
      case 'reese':
        V.reeseBass(ctx, out, time, { freq: freq * 0.5, dur: dur * 2, vel: v, cutoff: 500 + this._energy * 900 });
        break;
      case 'wobble': {
        // The LFO must land on a musical subdivision or it stops being dubstep.
        const rate = this.rng.pick([1, 2, 2, 4]);
        const lfoHz = (this.clock.bpm / 60 / 2) * rate;
        V.wobbleBass(ctx, out, time, { freq, dur, vel: v, lfoHz });
        break;
      }
      case 'pluck':
        V.pluckBass(ctx, out, time, { freq, dur, vel: v, cutoff });
        break;
    }
  }

  private scheduleMelody(
    def: GenreDef,
    mix: SectionMix,
    stepInBar: number,
    bar: number,
    time: number,
  ): void {
    const ctx = this.engine.ctx;
    const out = this.engine.leadBus;
    const degree = def.progression[Math.floor(bar / 4) % def.progression.length];
    const triad = [0, 2, 4].map((i) => mtof(scaleNote(def.scale, def.root + 24, degree + i)));

    if (mix.pad > 0.01 && stepInBar === 0 && bar % 2 === 0) {
      const dur = this.clock.secondsPerStep * STEPS_PER_BAR * 2;
      V.pad(ctx, out, time, { freqs: triad.map((f) => f * 0.5), dur, vel: mix.pad });
    }

    if (mix.lead <= 0.01 || def.leadVoice === 'none') return;
    const vel = stepVelocity(def.leadPattern, stepInBar);
    if (vel <= 0) return;

    const dur = this.clock.secondsPerStep * 6;
    const v = vel * mix.lead;
    const cutoff = 2200 + this._energy * 5000;
    switch (def.leadVoice) {
      case 'supersaw':
        V.supersaw(ctx, out, time, { freqs: triad, dur, vel: v, cutoff });
        break;
      case 'stab':
        V.stab(ctx, out, time, { freqs: triad, dur: dur * 0.5, vel: v, cutoff });
        break;
      case 'pluck':
        V.pluckLead(ctx, out, time, { freqs: [triad[0]], dur: dur * 0.4, vel: v, cutoff });
        break;
    }
  }
}

/**
 * Layer levels per section. This is the arrangement doing its real work — a
 * drop is not "louder", it is *more layers arriving at once*, and a breakdown
 * is the kick leaving.
 */
export function sectionMix(state: ArrangementState, energy: number): SectionMix {
  const e = 0.6 + energy * 0.4;
  switch (state.section) {
    case 'intro':
      return {
        kick: state.barsIn >= 4 ? 1 : 0,
        snare: state.barsIn >= 8 ? 0.6 : 0,
        hat: 0.8,
        perc: state.barsIn >= 8 ? 0.5 : 0,
        bass: state.barsIn >= 8 ? 0.4 * e : 0,
        lead: 0,
        pad: 0.5,
      };
    case 'build':
      return {
        kick: 1,
        snare: 0.9,
        hat: 1,
        perc: 0.8,
        bass: 0.75 * e,
        lead: 0.35 * e * state.progress,
        pad: 0.7,
      };
    case 'drop':
      return { kick: 1, snare: 1, hat: 1, perc: 1, bass: 1 * e, lead: 1 * e, pad: 0.35 };
    case 'breakdown':
      return { kick: 0, snare: 0, hat: 0.35, perc: 0.2, bass: 0.15, lead: 0.8, pad: 1 };
    case 'outro':
      return {
        kick: state.progress < 0.7 ? 1 : 0.5,
        snare: 0.4,
        hat: 0.7,
        perc: 0.3,
        bass: 0.3 * e,
        lead: 0,
        pad: 0.6,
      };
  }
}

/** Where the master filter should sit for a given section, 0..1 (0.5 = open). */
export function filterForSection(state: ArrangementState): number {
  switch (state.section) {
    case 'intro':
      return 0.34 + state.progress * 0.16;
    case 'build':
      // Opening the filter through the build is most of the tension.
      return 0.3 + state.progress * 0.2;
    case 'drop':
      return 0.5;
    case 'breakdown':
      return 0.42;
    case 'outro':
      return 0.5 - state.progress * 0.12;
  }
}
