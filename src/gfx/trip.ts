import { approach, clamp01, lerp, smoothstep } from '../core/math';
import type { MusicSource, Section } from '../core/types';

/**
 * How far gone the visuals are.
 *
 * One master level, 0..1, driven by the arrangement — and then five separate
 * effect strengths derived from it, each entering at a *different* depth. That
 * staggering is the whole design. A single knob wired to everything at once
 * reads as one blunt filter; phenomena arriving in sequence reads as a come-up,
 * because you register each new thing as it starts rather than all of it as a
 * wash.
 *
 * Pure and frame-rate independent, so it can be tested without a GPU.
 */
export interface TripLayers {
  /** Master level, 0..1. */
  level: number;
  /** Liquid domain warp — the first thing to arrive and the last to leave. */
  warp: number;
  /** Radial mirroring. */
  kaleido: number;
  /** Number of kaleidoscope segments; changes on section boundaries. */
  segments: number;
  /** Frame feedback, which is what produces infinite recursion. */
  feedback: number;
  /** Raymarched fractal behind the room, and how far the walls have eroded. */
  fractal: number;
  /** RGB tearing and scanline shear. Spikes on transients. */
  glitch: number;
}

/** Where each section sits before energy is taken into account. */
function baseFor(section: Section): number {
  switch (section) {
    case 'intro':
      return 0.06;
    case 'build':
      return 0.3;
    case 'drop':
      return 0.82;
    case 'breakdown':
      // Comes back down, but not to sober — this has to sit below `build` or
      // the drop stops being the peak. It still *feels* like the trippiest
      // moment because `warp` saturates by 0.55, so a breakdown is almost pure
      // liquid drift with none of the mirroring or tearing on top of it.
      return 0.22;
    case 'outro':
      return 0.16;
  }
}

export class Trip {
  private _level = 0;
  private glitchImpulse = 0;
  private segmentChoice = 6;
  private lastSection: Section = 'intro';

  /** Manual offset, -1..1. 0 leaves the music in charge. */
  bias = 0;
  /** When set, overrides the music entirely. */
  override: number | null = null;

  get level(): number {
    return this._level;
  }

  update(dt: number, source: MusicSource): TripLayers {
    const section = source.section();
    const energy = source.energy();
    const barsToNext = source.barsToNextSection();

    let target = baseFor(section) + energy * 0.22;

    // A build should climb into the drop rather than sit flat, so ramp toward
    // the drop's level over the last 8 bars when the source can see it coming.
    if (section === 'build' && barsToNext >= 0) {
      target = lerp(target, baseFor('drop'), 1 - clamp01(barsToNext / 8));
    }
    if (this.override !== null) target = this.override;
    else target = clamp01(target + this.bias);

    // Rush in, ease out. Coming up is faster than coming down.
    const rate = target > this._level ? 2.6 : 0.9;
    this._level = approach(this._level, clamp01(target), rate, dt);

    // Segment count changes only on section boundaries — mid-phrase changes
    // read as a glitch rather than as a deliberate move.
    if (section !== this.lastSection) {
      const options = [4, 6, 8, 12];
      this.segmentChoice = options[Math.floor(Math.random() * options.length)];
      this.lastSection = section;
    }

    const onsets = source.onsets();
    if (onsets.kick) this.glitchImpulse = Math.min(1, this.glitchImpulse + 0.5);
    if (onsets.snare) this.glitchImpulse = Math.min(1, this.glitchImpulse + 0.75);
    this.glitchImpulse = Math.max(0, this.glitchImpulse - dt * 4.5);

    return this.layers();
  }

  /** Derive the per-effect strengths. Exported shape is what the shaders read. */
  layers(): TripLayers {
    const l = this._level;
    return {
      level: l,
      // Present almost immediately and saturating early — the liquid is the
      // bed everything else sits on.
      warp: smoothstep(0.04, 0.55, l),
      // Mirroring is a strong, obvious move, so it holds off until the back half.
      // Never a full replacement — keeping some of the unmirrored frame is what
      // stops the room from dissolving into abstract symmetry entirely.
      kaleido: smoothstep(0.42, 0.88, l) * 0.85,
      segments: this.segmentChoice,
      // Capped well below 1. Each frame multiplies the last, so this is a
      // geometric series: 0.78 sums to ~4.5x and washes the room out to white
      // within a second. 0.5 sums to 2x, which reads as trails rather than fog.
      feedback: smoothstep(0.22, 0.8, l) * 0.5,
      // The walls only start eroding once things are properly gone.
      fractal: smoothstep(0.5, 0.95, l),
      // Baseline tearing from about halfway, plus per-transient spikes that
      // scale with how far gone we already are.
      glitch: clamp01(smoothstep(0.55, 1, l) * 0.55 + this.glitchImpulse * l * 0.9),
    };
  }

  reset(): void {
    this._level = 0;
    this.glitchImpulse = 0;
  }
}
