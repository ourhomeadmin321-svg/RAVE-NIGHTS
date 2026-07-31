import { bus } from '../core/bus';
import { clamp01, lerp, type Vec3 } from '../core/math';
import { Rng } from '../core/rng';
import type { MusicSource, RGB, Section } from '../core/types';
import { GENRES, type LightingPersonality } from '../audio/genres';
import {
  COLORS,
  INTENSITIES,
  LASER_CUES,
  MOVEMENTS,
  type ColorCue,
  type CueContext,
  type IntensityCue,
  type LaserCue,
  type MovementCue,
  paletteAt,
} from './cues';
import type { Rig } from './rig';

/** Live overrides from the console. When `enabled`, the director steps back. */
export interface ManualState {
  enabled: boolean;
  groups: { beams: number; washes: number; bars: number; wall: number; lasers: number };
  /** null follows the genre palette. */
  color: RGB | null;
  /** null lets the director keep choosing. */
  movement: string | null;
  laser: string | null;
  intensity: string | null;
  strobeRate: number;
  haze: number;
  /** Momentary bash buttons — held, not toggled. */
  strobeBash: boolean;
  blinderBash: boolean;
}

export function defaultManualState(): ManualState {
  return {
    enabled: false,
    groups: { beams: 1, washes: 1, bars: 1, wall: 1, lasers: 1 },
    color: null,
    movement: null,
    laser: null,
    intensity: null,
    strobeRate: 10,
    haze: 1,
    strobeBash: false,
    blinderBash: false,
  };
}

/** Cue pools per section — the operator's instincts, written down. */
const POOLS: Record<Section, { movement: string[]; color: string[]; intensity: string[]; laser: string[] }> = {
  intro: {
    movement: ['wall', 'fan', 'sweep', 'cone'],
    color: ['deep', 'unison', 'spread'],
    intensity: ['wave', 'pulse', 'full'],
    laser: ['off', 'off', 'liquid sky'],
  },
  build: {
    movement: ['sweep', 'ballyhoo', 'figure8', 'fan'],
    color: ['unison', 'flip', 'white'],
    intensity: ['pulse', 'chase', 'wave'],
    laser: ['off', 'fan', 'scan'],
  },
  drop: {
    movement: ['tunnel', 'ballyhoo', 'cross', 'stagger', 'fan', 'figure8'],
    color: ['spread', 'chase', 'split', 'unison'],
    intensity: ['pulse', 'alternate', 'snap', 'full'],
    laser: ['tunnel', 'fan', 'cone', 'scan', 'grid'],
  },
  breakdown: {
    movement: ['cone', 'wall', 'fan'],
    color: ['deep', 'unison'],
    intensity: ['wave', 'full'],
    laser: ['liquid sky', 'off', 'cone'],
  },
  outro: {
    movement: ['fan', 'sweep', 'wall'],
    color: ['deep', 'unison'],
    intensity: ['pulse', 'wave'],
    laser: ['off', 'liquid sky'],
  },
};

/**
 * The lighting operator.
 *
 * On every bar it decides whether to change one of its four playbacks, and it
 * changes them at *different* cadences — position slowly, intensity often —
 * because a desk operator does not rewrite the whole look at once.
 *
 * The part that matters most is `armed`. When the music source can see a drop
 * coming (the synth engine always can), the director snaps the room to black on
 * the last beat of the build and detonates on the downbeat. That pre-drop
 * blackout is the single most recognisable move in club lighting, and it is
 * only possible with foreknowledge — which is why `MusicSource` exposes
 * `barsToNextSection()` at all.
 */
export class Director {
  private rng: Rng;

  private movement: MovementCue = MOVEMENTS[0];
  private color: ColorCue = COLORS[0];
  private intensity: IntensityCue = INTENSITIES[0];
  private laser: LaserCue = LASER_CUES[0];

  private lastBar = -1;
  private lastSection: Section = 'intro';

  /** Set when a drop is one bar away. */
  private armed = false;
  /** Counts down the post-drop impact window, in seconds. */
  private impact = 0;
  /** Seconds remaining of the pre-drop blackout. */
  private blackoutFor = 0;

  private crowdCenter: Vec3 = [0, 1.6, 6];

  constructor(seed = 'rave-nights') {
    this.rng = new Rng(seed);
    bus.on('arrangement:armed', ({ section }) => {
      if (section === 'drop') this.armed = true;
    });
  }

  setSeed(seed: string): void {
    this.rng = new Rng(seed);
  }

  setCrowdCenter(p: Vec3): void {
    this.crowdCenter = p;
  }

  /** 0..1 while a drop is landing. Drives the post-processing punch. */
  get impactLevel(): number {
    return clamp01(this.impact / 0.45);
  }

  /** Current cue names, for the console readout. */
  status(): { movement: string; color: string; intensity: string; laser: string; armed: boolean } {
    return {
      movement: this.movement.name,
      color: this.color.name,
      intensity: this.intensity.name,
      laser: this.laser.name,
      armed: this.armed,
    };
  }

  /**
   * `time` is the AudioContext clock, not a frame accumulator. Strobe rates and
   * movement speeds are wall-clock quantities, and deriving them from musical
   * position would make every one of them jump whenever the tempo changed.
   */
  update(dt: number, time: number, source: MusicSource, rig: Rig, manual: ManualState): void {
    const t = source.transport();
    const personality = GENRES[source.genre()].lighting;
    const section = source.section();
    const energy = source.energy();
    const bands = source.bands();
    const barsToNext = source.barsToNextSection();

    const ctx: CueContext = {
      time,
      dt,
      beatPhase: t.beat % 1,
      barPhase: (t.beat % 4) / 4,
      phrasePos: t.phrasePos,
      bar: t.bar,
      beat: Math.floor(t.beat),
      section,
      energy,
      bands,
      onsets: source.onsets(),
      palette: personality.palette,
      personality,
      crowdCenter: this.crowdCenter,
    };

    if (t.bar !== this.lastBar) {
      this.onBar(ctx, section, barsToNext);
      this.lastBar = t.bar;
    }

    // The pre-drop blackout, then the hit.
    if (this.armed && section === 'build' && barsToNext === 1 && ctx.barPhase > 0.75) {
      this.blackoutFor = 0.25;
    }
    if (section === 'drop' && this.lastSection !== 'drop') {
      this.fireDrop(rig, personality, energy);
      this.armed = false;
    }
    this.lastSection = section;

    this.blackoutFor = Math.max(0, this.blackoutFor - dt);
    this.impact = Math.max(0, this.impact - dt);

    if (manual.enabled) this.applyManual(ctx, rig, manual);
    else this.applyAuto(ctx, rig, personality, section, energy, barsToNext);

    this.applyBars(ctx, rig, manual);
    this.applyWall(ctx, rig, section, energy, manual);
    this.applyHaze(rig, personality, manual, section);

    rig.update(dt, time);
  }

  // ------------------------------------------------------------ auto

  private onBar(ctx: CueContext, section: Section, barsToNext: number): void {
    const pool = POOLS[section];

    // Different cadences per layer: position changes slowly, intensity often.
    const dropish = section === 'drop';
    if (ctx.bar % (dropish ? 4 : 8) === 0) this.pick('movement', pool.movement);
    if (ctx.bar % 4 === 0) this.pick('color', pool.color);
    if (ctx.bar % (dropish ? 2 : 8) === 0) this.pick('intensity', pool.intensity);
    if (ctx.bar % (dropish ? 4 : 8) === 0) this.pick('laser', pool.laser);

    // One bar out from a drop, escalate rather than wander.
    if (section === 'build' && barsToNext === 1) {
      this.intensity = INTENSITIES.find((i) => i.name === 'strobe') ?? this.intensity;
    }
  }

  private pick(layer: 'movement' | 'color' | 'intensity' | 'laser', names: string[]): void {
    const name = this.rng.pick(names);
    switch (layer) {
      case 'movement': {
        const m = MOVEMENTS.find((x) => x.name === name);
        if (m) this.movement = m;
        break;
      }
      case 'color': {
        const c = COLORS.find((x) => x.name === name);
        if (c) this.color = c;
        break;
      }
      case 'intensity': {
        const i = INTENSITIES.find((x) => x.name === name);
        if (i) this.intensity = i;
        break;
      }
      case 'laser': {
        const l = LASER_CUES.find((x) => x.name === name);
        if (l) this.laser = l;
        break;
      }
    }
    bus.emit('director:cue', { name: `${layer}:${name}` });
  }

  /** The moment the drop lands. */
  private fireDrop(rig: Rig, personality: LightingPersonality, energy: number): void {
    this.impact = 0.45;
    rig.burstHaze(0.7);
    for (const f of rig.group('blinder')) {
      f.targetDimmer = 1;
      f.strobeHz = 0;
    }
    for (const f of rig.group('strobe')) {
      f.targetDimmer = 1;
      f.strobeHz = 12 + energy * 8 * personality.strobeAggression;
      f.strobeDuty = 0.25;
    }
  }

  private applyAuto(
    ctx: CueContext,
    rig: Rig,
    personality: LightingPersonality,
    section: Section,
    energy: number,
    barsToNext: number,
  ): void {
    const beams = rig.group('beam');
    const washes = rig.group('wash');
    const blackedOut = this.blackoutFor > 0;

    // Base level rises with energy and section, and a build ramps into the drop.
    let level = 0.35 + energy * 0.65;
    if (section === 'breakdown') level *= 0.6;
    if (section === 'intro') level *= 0.7;
    if (section === 'build' && barsToNext >= 0) {
      const climb = 1 - clamp01(barsToNext / 8);
      level = lerp(level * 0.7, 1, climb);
    }
    if (this.impact > 0) level = 1;
    if (blackedOut) level = 0;

    const movement = this.movement.minFixtures <= beams.length ? this.movement : MOVEMENTS[0];
    movement.apply(ctx, beams);
    this.color.apply(ctx, beams);
    this.intensity.apply(ctx, beams, level);

    // Washes follow the same colour but move lazily and stay wide — that
    // division of labour (beams draw shapes, washes fill space) is the whole
    // reason a rig has both.
    for (const w of washes) {
      w.targetPan = Math.sin(ctx.time * 0.25 + w.index) * 0.4;
      w.targetTilt = 1.1 + Math.sin(ctx.time * 0.2 + w.index * 0.7) * 0.25;
      w.targetCone = 0.28 + 0.08 * Math.sin(ctx.time * 0.3);
    }
    this.color.apply(ctx, washes);
    for (const w of washes) {
      const pulse = section === 'drop' ? 0.45 + 0.55 * (1 - clamp01(ctx.beatPhase * 2)) : 0.75;
      w.targetDimmer = blackedOut ? 0 : level * pulse * 0.85;
      w.strobeHz = 0;
    }

    // Beam tightness is a genre trait: techno pencils, house wide.
    for (const b of beams) b.targetCone = lerp(0.09, 0.022, personality.beamTightness);

    // Strobes and blinders are event-driven, not part of the running look.
    for (const s of rig.group('strobe')) {
      if (this.impact > 0) continue;
      const wantStrobe = section === 'drop' && energy > 0.75 && ctx.bar % 8 === 7;
      s.targetDimmer = wantStrobe && !blackedOut ? 0.9 : 0;
      s.strobeHz = wantStrobe ? 8 + energy * 8 * personality.strobeAggression : 0;
    }
    for (const b of rig.group('blinder')) {
      if (this.impact > 0) continue;
      const hit = section === 'build' && barsToNext === 1 && ctx.barPhase > 0.9;
      b.targetDimmer = hit ? 1 : 0;
      b.strobeHz = 0;
    }

    const laserLevel = blackedOut ? 0 : clamp01(level * (0.4 + personality.laserDensity * 0.9));
    this.laser.apply(ctx, rig.lasers, laserLevel);
    const laserColor = personality.monochrome ? ([0.6, 1, 0.9] as RGB) : paletteAt(ctx.palette, ctx.bar);
    for (const l of rig.lasers) l.targetColor = laserColor;
  }

  // ------------------------------------------------------------ manual

  private applyManual(ctx: CueContext, rig: Rig, m: ManualState): void {
    const beams = rig.group('beam');
    const washes = rig.group('wash');

    const movement = (m.movement && MOVEMENTS.find((x) => x.name === m.movement)) || this.movement;
    const intensity = (m.intensity && INTENSITIES.find((x) => x.name === m.intensity)) || INTENSITIES[0];
    const laser = (m.laser && LASER_CUES.find((x) => x.name === m.laser)) || this.laser;

    movement.apply(ctx, beams);
    intensity.apply(ctx, beams, m.groups.beams);

    for (const w of washes) {
      w.targetPan = Math.sin(ctx.time * 0.25 + w.index) * 0.4;
      w.targetTilt = 1.1 + Math.sin(ctx.time * 0.2 + w.index * 0.7) * 0.25;
      w.targetDimmer = m.groups.washes;
      w.strobeHz = 0;
    }

    if (m.color) {
      for (const f of [...beams, ...washes]) f.targetColor = m.color;
    } else {
      this.color.apply(ctx, beams);
      this.color.apply(ctx, washes);
    }

    // Momentary bashes: held down means on, released means instantly off.
    for (const s of rig.group('strobe')) {
      s.targetDimmer = m.strobeBash ? 1 : 0;
      s.strobeHz = m.strobeBash ? m.strobeRate : 0;
      s.strobeDuty = 0.3;
    }
    for (const b of rig.group('blinder')) {
      b.targetDimmer = m.blinderBash ? 1 : 0;
      b.strobeHz = 0;
    }

    laser.apply(ctx, rig.lasers, m.groups.lasers);
    if (m.color) for (const l of rig.lasers) l.targetColor = m.color;
  }

  // ------------------------------------------------------------ fixed elements

  /** Pixel-mapped LED bars: a bass-driven bar graph that chases along the strip. */
  private applyBars(ctx: CueContext, rig: Rig, m: ManualState): void {
    const level = m.enabled ? m.groups.bars : 1;
    const beat = ctx.bar * 4 + ctx.beat;
    for (const bar of rig.bars) {
      const n = bar.pixels.length;
      for (let i = 0; i < n; i++) {
        const u = n > 1 ? i / (n - 1) : 0;
        const chase = 0.5 + 0.5 * Math.sin((u * 6 - ctx.time * 3 + bar.id) * Math.PI);
        const band = u < 0.4 ? ctx.bands.low : u < 0.75 ? ctx.bands.mid : ctx.bands.high;
        const c = m.color ?? paletteAt(ctx.palette, Math.floor(beat / 2) + i);
        const amt = clamp01(band * 1.3) * chase * level;
        bar.pixels[i][0] = c[0] * amt;
        bar.pixels[i][1] = c[1] * amt;
        bar.pixels[i][2] = c[2] * amt;
      }
      bar.intensity = level;
    }
  }

  private applyWall(ctx: CueContext, rig: Rig, section: Section, energy: number, m: ManualState): void {
    const wall = rig.wall;
    if (!wall) return;
    wall.spectrum[0] = ctx.bands.sub;
    wall.spectrum[1] = ctx.bands.low;
    wall.spectrum[2] = ctx.bands.mid;
    wall.spectrum[3] = ctx.bands.high;

    if (m.enabled) {
      wall.intensity = m.groups.wall;
      if (m.color) wall.color = m.color;
      return;
    }

    wall.mode =
      this.impact > 0
        ? 'strobe'
        : section === 'drop'
          ? energy > 0.8
            ? 'tunnel'
            : 'spectrum'
          : section === 'build'
            ? 'pulse'
            : section === 'breakdown'
              ? 'noise'
              : 'logo';
    wall.intensity = this.blackoutFor > 0 ? 0 : 0.5 + energy * 0.5;
    wall.color = paletteAt(ctx.palette, ctx.bar / 2);
  }

  private applyHaze(rig: Rig, personality: LightingPersonality, m: ManualState, section: Section): void {
    if (m.enabled) {
      rig.haze = m.haze;
      return;
    }
    // Breakdowns get thicker air so the few beams left read as solid shafts.
    const sectionBias = section === 'breakdown' ? 1.25 : 1;
    rig.haze = clamp01(personality.hazeBias * sectionBias * 0.75) * 1.6;
  }
}
