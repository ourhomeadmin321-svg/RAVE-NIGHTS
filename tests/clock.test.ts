import { describe, expect, it } from 'vitest';
import {
  BARS_PER_PHRASE,
  Clock,
  STEPS_PER_BAR,
  barOfStep,
  positionOfStep,
  stepOfBar,
} from '../src/core/clock';

describe('positionOfStep', () => {
  it('maps steps onto bars and beats', () => {
    expect(positionOfStep(0, 128)).toMatchObject({ bar: 0, beat: 0 });
    expect(positionOfStep(4, 128)).toMatchObject({ bar: 0, beat: 1 });
    expect(positionOfStep(16, 128)).toMatchObject({ bar: 1, beat: 0 });
    expect(positionOfStep(20, 128)).toMatchObject({ bar: 1, beat: 1 });
  });

  it('reports fractional beats within a step', () => {
    expect(positionOfStep(2, 128).beat).toBeCloseTo(0.5, 6);
  });

  it('wraps phrase position over 16 bars', () => {
    const stepsPerPhrase = STEPS_PER_BAR * BARS_PER_PHRASE;
    expect(positionOfStep(0, 128).phrasePos).toBe(0);
    expect(positionOfStep(stepsPerPhrase / 2, 128).phrasePos).toBeCloseTo(0.5, 6);
    // The start of the next phrase is position 0 again, not 1.
    expect(positionOfStep(stepsPerPhrase, 128).phrasePos).toBeCloseTo(0, 6);
  });

  it('round-trips bar and step helpers', () => {
    for (const bar of [0, 1, 7, 16, 129]) {
      expect(barOfStep(stepOfBar(bar))).toBe(bar);
    }
  });
});

describe('Clock', () => {
  it('is an exact inverse between step and time', () => {
    const clock = new Clock(128, 5);
    for (const step of [0, 1, 16, 137.5, 1024]) {
      expect(clock.stepAt(clock.timeOfStep(step))).toBeCloseTo(step, 6);
    }
  });

  it('advances one bar per bar-length of audio time', () => {
    const clock = new Clock(120, 0);
    // 120 BPM: one beat is 0.5s, one bar is 2s.
    expect(clock.positionAt(2).bar).toBe(1);
    expect(clock.positionAt(8).bar).toBe(4);
  });

  it('keeps musical position continuous across a tempo change', () => {
    const clock = new Clock(120, 0);
    const before = clock.stepAt(3.7);
    clock.setBpm(174, 3.7);
    const after = clock.stepAt(3.7);
    expect(after).toBeCloseTo(before, 6);
  });

  it('runs faster after a tempo increase', () => {
    // 100 BPM: one bar is 2.4s. Doubling to 200 covers two bars in that time.
    const clock = new Clock(100, 0);
    expect(clock.positionAt(2.4).bar).toBe(1);
    clock.setBpm(200, 0);
    expect(clock.positionAt(2.4).bar).toBe(2);
  });

  it('clamps absurd tempos rather than producing infinities', () => {
    const clock = new Clock(128, 0);
    clock.setBpm(10_000, 0);
    expect(clock.bpm).toBeLessThanOrEqual(220);
    clock.setBpm(-5, 0);
    expect(clock.bpm).toBeGreaterThanOrEqual(60);
    expect(Number.isFinite(clock.secondsPerStep)).toBe(true);
  });
});
