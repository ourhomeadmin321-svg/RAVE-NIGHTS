import type { Transport } from './types';

export const STEPS_PER_BEAT = 4; // 16th notes
export const BEATS_PER_BAR = 4;
export const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR; // 16
export const BARS_PER_PHRASE = 16;
export const STEPS_PER_PHRASE = STEPS_PER_BAR * BARS_PER_PHRASE; // 256

/**
 * Musical transport.
 *
 * The clock is anchored to a single (time, step) pair rather than integrating
 * per-frame, so `stepAt` and `timeOfStep` are exact inverses of each other and
 * neither accumulates float drift. A tempo change re-anchors at the current
 * position, which keeps already-elapsed musical time intact instead of
 * retroactively rewriting it.
 *
 * `time` is always an AudioContext timestamp. Visuals read their position from
 * the same clock, which is what keeps lights locked to audio rather than to
 * whatever the frame rate happens to be doing.
 */
export class Clock {
  private _bpm: number;
  private anchorTime: number;
  private anchorStep: number;

  constructor(bpm = 128, startTime = 0) {
    this._bpm = bpm;
    this.anchorTime = startTime;
    this.anchorStep = 0;
  }

  get bpm(): number {
    return this._bpm;
  }

  /** Seconds per 16th note at the current tempo. */
  get secondsPerStep(): number {
    return 60 / this._bpm / STEPS_PER_BEAT;
  }

  /**
   * Change tempo, re-anchoring at `atTime` so the musical position is
   * continuous across the change.
   */
  setBpm(bpm: number, atTime: number): void {
    const clamped = Math.max(60, Math.min(220, bpm));
    if (clamped === this._bpm) return;
    this.anchorStep = this.stepAt(atTime);
    this.anchorTime = atTime;
    this._bpm = clamped;
  }

  /** Reset to step 0 at the given time. */
  reset(atTime: number): void {
    this.anchorTime = atTime;
    this.anchorStep = 0;
  }

  /** Fractional step index at an audio timestamp. */
  stepAt(time: number): number {
    return this.anchorStep + (time - this.anchorTime) / this.secondsPerStep;
  }

  /** Audio timestamp of a (possibly fractional) step index. */
  timeOfStep(step: number): number {
    return this.anchorTime + (step - this.anchorStep) * this.secondsPerStep;
  }

  /** Full transport position at an audio timestamp. */
  positionAt(time: number, confident = true): Transport {
    return positionOfStep(this.stepAt(time), this._bpm, confident);
  }
}

/** Pure step -> musical position conversion. Exported for testing. */
export function positionOfStep(step: number, bpm: number, confident = true): Transport {
  const bar = Math.floor(step / STEPS_PER_BAR);
  const beat = (step % STEPS_PER_BAR) / STEPS_PER_BEAT;
  const phrasePos = (((step % STEPS_PER_PHRASE) + STEPS_PER_PHRASE) % STEPS_PER_PHRASE) / STEPS_PER_PHRASE;
  return { bar, beat, phrasePos, bpm, step, confident };
}

/** Bar index a step falls in. */
export function barOfStep(step: number): number {
  return Math.floor(step / STEPS_PER_BAR);
}

/** Step index at which a bar begins. */
export function stepOfBar(bar: number): number {
  return bar * STEPS_PER_BAR;
}
