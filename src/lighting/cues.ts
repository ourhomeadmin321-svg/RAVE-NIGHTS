import { clamp01, lerp, normalize, sub, type Vec3 } from '../core/math';
import type { Bands, Onsets, RGB, Section } from '../core/types';
import type { LightingPersonality } from '../audio/genres';
import type { Fixture, Laser, LaserEffect } from './rig';

/**
 * The cue library.
 *
 * Rather than enumerating hundreds of complete "looks", this is split the way a
 * real lighting desk is: position, colour and intensity are independent
 * playbacks that the operator stacks. Ten movements × eight colours × eight
 * intensity effects gives the director hundreds of combinations from a few
 * dozen lines of code, and — more importantly — it can change one layer at a
 * time, which is what makes a show feel like it is being *operated* rather than
 * flipping between presets.
 */

export interface CueContext {
  time: number;
  dt: number;
  /** 0..1 within the current beat. */
  beatPhase: number;
  /** 0..1 within the current bar. */
  barPhase: number;
  /** 0..1 within the current 16-bar phrase. */
  phrasePos: number;
  bar: number;
  beat: number;
  section: Section;
  energy: number;
  bands: Bands;
  onsets: Onsets;
  palette: RGB[];
  personality: LightingPersonality;
  /** Where the crowd is, for audience-facing looks. */
  crowdCenter: Vec3;
}

// ---------------------------------------------------------------- helpers

/** Normalised position of a fixture within its group, -1..1. */
function spanOf(f: Fixture, count: number): number {
  return count > 1 ? (f.index / (count - 1)) * 2 - 1 : 0;
}

/** Point a fixture at a world position. */
export function aimAt(f: Fixture, point: Vec3): void {
  const d = normalize(sub(point, f.pos));
  f.targetTilt = Math.acos(Math.max(-1, Math.min(1, -d[1])));
  f.targetPan = Math.atan2(d[0], d[2]);
}

/**
 * Wrap an index into a palette, negatives included.
 *
 * The transport can report a negative bar for the first fraction of a second
 * after start (the clock is anchored slightly ahead of the playhead), and a raw
 * `%` on a negative operand indexes off the front of the array.
 */
export function paletteAt(palette: RGB[], i: number): RGB {
  const n = palette.length;
  return palette[((Math.floor(i) % n) + n) % n];
}

function paletteColor(ctx: CueContext, i: number): RGB {
  if (ctx.personality.monochrome) {
    // Techno stays near-white; picking "colours" here would break the look.
    const c = paletteAt(ctx.palette, i);
    const l = c[0] * 0.3 + c[1] * 0.6 + c[2] * 0.1;
    return [lerp(c[0], l, 0.7), lerp(c[1], l, 0.7), lerp(c[2], l, 0.7)];
  }
  return paletteAt(ctx.palette, i);
}

// ---------------------------------------------------------------- movement

export interface MovementCue {
  name: string;
  /** How much of the beam group this look needs to read properly. */
  minFixtures: number;
  apply(ctx: CueContext, fixtures: Fixture[]): void;
}

const TILT_AERIAL = 1.35; // near-horizontal: beams cut across the room

export const MOVEMENTS: MovementCue[] = [
  {
    name: 'fan',
    minFixtures: 2,
    apply(ctx, fx) {
      const breathe = 0.55 + 0.45 * Math.sin(ctx.time * 0.4);
      const spread = 0.75 * breathe;
      for (const f of fx) {
        f.targetPan = spanOf(f, fx.length) * spread;
        f.targetTilt = TILT_AERIAL + 0.12 * Math.sin(ctx.time * 0.6);
      }
    },
  },
  {
    name: 'sweep',
    minFixtures: 1,
    apply(ctx, fx) {
      const rate = 0.6 + ctx.personality.movementSpeed * 1.4;
      for (const f of fx) {
        f.targetPan = Math.sin(ctx.time * rate) * 0.9;
        f.targetTilt = TILT_AERIAL + 0.2 * Math.cos(ctx.time * rate * 0.5);
      }
    },
  },
  {
    name: 'cross',
    minFixtures: 4,
    apply(ctx, fx) {
      const swing = Math.sin(ctx.time * (0.5 + ctx.personality.movementSpeed)) * 0.7;
      for (const f of fx) {
        const side = f.index % 2 === 0 ? 1 : -1;
        f.targetPan = side * (0.35 + swing * 0.5);
        f.targetTilt = TILT_AERIAL - side * 0.12;
      }
    },
  },
  {
    name: 'tunnel',
    minFixtures: 4,
    apply(ctx, fx) {
      // Beams distributed around a rotating circle — the classic vortex.
      const spin = ctx.time * (0.4 + ctx.personality.movementSpeed * 0.8);
      for (const f of fx) {
        const a = (f.index / fx.length) * Math.PI * 2 + spin;
        f.targetPan = Math.sin(a) * 0.6;
        f.targetTilt = TILT_AERIAL + Math.cos(a) * 0.45;
      }
    },
  },
  {
    name: 'cone',
    minFixtures: 3,
    apply(ctx, fx) {
      // Every beam converges on one point above the crowd.
      const p: Vec3 = [
        ctx.crowdCenter[0] + Math.sin(ctx.time * 0.35) * 3,
        ctx.crowdCenter[1] + 5.5,
        ctx.crowdCenter[2] + Math.cos(ctx.time * 0.3) * 3,
      ];
      for (const f of fx) aimAt(f, p);
    },
  },
  {
    name: 'ballyhoo',
    minFixtures: 2,
    apply(ctx, fx) {
      // Loose circles with per-fixture phase — busy, unsynchronised, festival.
      const rate = 1.2 + ctx.personality.movementSpeed * 2.2;
      for (const f of fx) {
        const ph = f.index * 1.7;
        f.targetPan = Math.sin(ctx.time * rate + ph) * 0.65;
        f.targetTilt = TILT_AERIAL + Math.cos(ctx.time * rate * 0.77 + ph) * 0.35;
      }
    },
  },
  {
    name: 'figure8',
    minFixtures: 2,
    apply(ctx, fx) {
      const rate = 0.8 + ctx.personality.movementSpeed * 1.2;
      for (const f of fx) {
        const ph = (f.index / Math.max(1, fx.length)) * Math.PI * 2;
        f.targetPan = Math.sin(ctx.time * rate + ph) * 0.7;
        f.targetTilt = TILT_AERIAL + Math.sin(2 * (ctx.time * rate + ph)) * 0.3;
      }
    },
  },
  {
    name: 'wall',
    minFixtures: 3,
    apply(_ctx, fx) {
      // Dead-parallel vertical shafts. Stillness reads as huge.
      for (const f of fx) {
        f.targetPan = 0;
        f.targetTilt = 2.6;
      }
    },
  },
  {
    name: 'audience',
    minFixtures: 1,
    apply(ctx, fx) {
      for (const f of fx) aimAt(f, ctx.crowdCenter);
    },
  },
  {
    name: 'stagger',
    minFixtures: 4,
    apply(ctx, fx) {
      // Steps to a new position on each beat instead of gliding — punchy.
      const stepIdx = Math.floor(ctx.bar * 4 + ctx.beat);
      for (const f of fx) {
        const k = (f.index + stepIdx) % 4;
        f.targetPan = (k - 1.5) * 0.42;
        f.targetTilt = TILT_AERIAL + (f.index % 2 === 0 ? 0.15 : -0.15);
      }
    },
  },
];

// ---------------------------------------------------------------- colour

export interface ColorCue {
  name: string;
  apply(ctx: CueContext, fixtures: Fixture[]): void;
}

export const COLORS: ColorCue[] = [
  {
    name: 'unison',
    apply(ctx, fx) {
      const c = paletteColor(ctx, Math.floor(ctx.bar / 2));
      for (const f of fx) f.targetColor = c;
    },
  },
  {
    name: 'split',
    apply(ctx, fx) {
      const a = paletteColor(ctx, ctx.bar);
      const b = paletteColor(ctx, ctx.bar + 1);
      for (const f of fx) f.targetColor = f.index % 2 === 0 ? a : b;
    },
  },
  {
    name: 'spread',
    apply(ctx, fx) {
      for (const f of fx) f.targetColor = paletteColor(ctx, f.index);
    },
  },
  {
    name: 'chase',
    apply(ctx, fx) {
      const offset = Math.floor(ctx.bar * 4 + ctx.beat);
      for (const f of fx) f.targetColor = paletteColor(ctx, f.index + offset);
    },
  },
  {
    name: 'white',
    apply(_ctx, fx) {
      for (const f of fx) f.targetColor = [1, 1, 1];
    },
  },
  {
    name: 'flip',
    apply(ctx, fx) {
      const a = paletteColor(ctx, 0);
      const b = paletteColor(ctx, 1);
      const on = Math.floor(ctx.bar * 4 + ctx.beat) % 2 === 0;
      for (const f of fx) f.targetColor = on ? a : b;
    },
  },
  {
    name: 'warm',
    apply(_ctx, fx) {
      for (const f of fx) f.targetColor = [1, 0.62, 0.28];
    },
  },
  {
    name: 'deep',
    apply(ctx, fx) {
      const c = paletteColor(ctx, Math.floor(ctx.bar / 4));
      for (const f of fx) f.targetColor = [c[0] * 0.35, c[1] * 0.35, c[2] * 0.9];
    },
  },
];

// ---------------------------------------------------------------- intensity

export interface IntensityCue {
  name: string;
  apply(ctx: CueContext, fixtures: Fixture[], level: number): void;
}

export const INTENSITIES: IntensityCue[] = [
  {
    name: 'full',
    apply(_ctx, fx, level) {
      for (const f of fx) {
        f.targetDimmer = level;
        f.strobeHz = 0;
      }
    },
  },
  {
    name: 'pulse',
    apply(ctx, fx, level) {
      // Everything bumps on the kick and decays — the most-used look in the world.
      const bump = 1 - clamp01(ctx.beatPhase * 2.6);
      for (const f of fx) {
        f.targetDimmer = level * (0.28 + bump * 0.72);
        f.strobeHz = 0;
      }
    },
  },
  {
    name: 'chase',
    apply(ctx, fx, level) {
      const pos = Math.floor(ctx.bar * 8 + ctx.beat * 2) % Math.max(1, fx.length);
      for (const f of fx) {
        f.targetDimmer = f.index === pos ? level : level * 0.06;
        f.strobeHz = 0;
      }
    },
  },
  {
    name: 'alternate',
    apply(ctx, fx, level) {
      const even = Math.floor(ctx.bar * 4 + ctx.beat) % 2 === 0;
      for (const f of fx) {
        f.targetDimmer = (f.index % 2 === 0) === even ? level : level * 0.08;
        f.strobeHz = 0;
      }
    },
  },
  {
    name: 'wave',
    apply(ctx, fx, level) {
      for (const f of fx) {
        const ph = (f.index / Math.max(1, fx.length)) * Math.PI * 2;
        f.targetDimmer = level * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(ctx.time * 3 + ph)));
        f.strobeHz = 0;
      }
    },
  },
  {
    name: 'strobe',
    apply(ctx, fx, level) {
      const hz = 6 + ctx.energy * 10 * ctx.personality.strobeAggression;
      for (const f of fx) {
        f.targetDimmer = level;
        f.strobeHz = hz;
        f.strobeDuty = 0.3;
      }
    },
  },
  {
    name: 'snap',
    apply(ctx, fx, level) {
      // On for the first eighth of each beat, off after. Very hard, very techno.
      const on = ctx.beatPhase < 0.12;
      for (const f of fx) {
        f.targetDimmer = on ? level : 0;
        f.strobeHz = 0;
      }
    },
  },
  {
    name: 'blackout',
    apply(_ctx, fx) {
      for (const f of fx) {
        f.targetDimmer = 0;
        f.strobeHz = 0;
      }
    },
  },
];

// ---------------------------------------------------------------- lasers

export interface LaserCue {
  name: string;
  effect: LaserEffect;
  apply(ctx: CueContext, lasers: Laser[], level: number): void;
}

export const LASER_CUES: LaserCue[] = [
  { name: 'off', effect: 'off', apply(_c, ls) { for (const l of ls) l.targetIntensity = 0; } },
  {
    name: 'fan',
    effect: 'fan',
    apply(ctx, ls, level) {
      for (const l of ls) {
        l.effect = 'fan';
        l.count = 14;
        l.spread = 0.45 + 0.25 * Math.sin(ctx.time * 0.5);
        l.spinRate = 0.15;
        l.targetPan = Math.sin(ctx.time * 0.3) * 0.4;
        l.targetTilt = 1.5;
        l.targetIntensity = level;
      }
    },
  },
  {
    name: 'tunnel',
    effect: 'tunnel',
    apply(ctx, ls, level) {
      for (const l of ls) {
        l.effect = 'tunnel';
        l.count = 20;
        l.spread = 0.32;
        l.spinRate = 0.8 + ctx.energy * 1.6;
        l.targetTilt = 1.55;
        l.targetPan = 0;
        l.targetIntensity = level;
      }
    },
  },
  {
    name: 'cone',
    effect: 'cone',
    apply(ctx, ls, level) {
      for (const l of ls) {
        l.effect = 'cone';
        l.count = 24;
        l.spread = 0.28 + 0.1 * Math.sin(ctx.time * 0.8);
        l.spinRate = 0.5;
        l.targetTilt = 1.9;
        l.targetIntensity = level;
      }
    },
  },
  {
    name: 'liquid sky',
    effect: 'sheet',
    apply(ctx, ls, level) {
      // A flat sheet hanging over the crowd. Slow and wide by definition.
      for (const l of ls) {
        l.effect = 'sheet';
        l.count = 28;
        l.spread = 0.85;
        l.spinRate = 0.05;
        l.targetTilt = 1.62 + 0.04 * Math.sin(ctx.time * 0.25);
        l.targetPan = 0;
        l.targetIntensity = level;
      }
    },
  },
  {
    name: 'scan',
    effect: 'scan',
    apply(ctx, ls, level) {
      for (const l of ls) {
        l.effect = 'scan';
        l.count = 6;
        l.spread = 0.12;
        l.spinRate = 2.5 + ctx.energy * 4;
        l.targetPan = Math.sin(ctx.time * 2.2) * 0.8;
        l.targetTilt = 1.4 + Math.sin(ctx.time * 1.7) * 0.35;
        l.targetIntensity = level;
      }
    },
  },
  {
    name: 'grid',
    effect: 'grid',
    apply(_ctx, ls, level) {
      for (const l of ls) {
        l.effect = 'grid';
        l.count = 16;
        l.spread = 0.7;
        l.spinRate = 0.1;
        l.targetTilt = 1.5;
        l.targetPan = 0;
        l.targetIntensity = level;
      }
    },
  },
];

export function findMovement(name: string): MovementCue | undefined {
  return MOVEMENTS.find((m) => m.name === name);
}

export function findLaserCue(name: string): LaserCue | undefined {
  return LASER_CUES.find((l) => l.name === name);
}
