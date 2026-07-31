import { describe, expect, it } from 'vitest';
import { detectBpm } from '../src/audio/analysis';

/**
 * Synthesise an onset-strength envelope for a click train, the way the live
 * analyser produces one: sampled once per rendered frame, with each hit a sharp
 * attack that decays over a few frames.
 */
function clickEnvelope(bpm: number, seconds: number, frameRate = 60, subdivision = 1): number[] {
  const frames = Math.floor(seconds * frameRate);
  const env: number[] = [];
  for (let i = 0; i < frames; i++) {
    const beats = (i / frameRate) * (bpm / 60) * subdivision;
    const phase = beats - Math.floor(beats);
    env.push(Math.exp(-phase * 14));
  }
  return env;
}

describe('detectBpm', () => {
  // The three tempos the app actually cares about: house, trance, DnB.
  for (const bpm of [124, 138, 174]) {
    it(`recovers ${bpm} BPM from a click train within 2 BPM`, () => {
      const est = detectBpm(clickEnvelope(bpm, 8), 60);
      expect(est.bpm).toBeGreaterThan(bpm - 2);
      expect(est.bpm).toBeLessThan(bpm + 2);
      expect(est.confidence).toBeGreaterThan(0.2);
    });
  }

  it('works at a non-60 frame rate', () => {
    const est = detectBpm(clickEnvelope(128, 8, 144), 144);
    expect(est.bpm).toBeGreaterThan(126);
    expect(est.bpm).toBeLessThan(130);
  });

  it('finds the beat, not the subdivision, when 8ths are present', () => {
    // Beats at 128 BPM with quieter offbeat 8ths layered on top.
    const beat = clickEnvelope(128, 8);
    const eighths = clickEnvelope(128, 8, 60, 2);
    const env = beat.map((v, i) => v + eighths[i] * 0.5);
    const est = detectBpm(env, 60);
    expect(est.bpm).toBeGreaterThan(126);
    expect(est.bpm).toBeLessThan(130);
  });

  it('folds an out-of-range estimate back into the window', () => {
    const est = detectBpm(clickEnvelope(180, 8), 60, 70, 160);
    expect(est.bpm).toBeGreaterThanOrEqual(70);
    expect(est.bpm).toBeLessThanOrEqual(160);
    // 180 folds to 90.
    expect(est.bpm).toBeCloseTo(90, 0);
  });

  it('reports nothing for silence', () => {
    expect(detectBpm(new Array(480).fill(0), 60)).toEqual({ bpm: 0, confidence: 0 });
  });

  it('reports nothing for a constant signal', () => {
    expect(detectBpm(new Array(480).fill(0.7), 60).bpm).toBe(0);
  });

  it('reports nothing for too little history', () => {
    expect(detectBpm([1, 0, 1, 0], 60).bpm).toBe(0);
  });

  it('gives noise a much lower confidence than a steady beat', () => {
    const noise = Array.from({ length: 480 }, () => Math.random());
    const noiseConf = detectBpm(noise, 60).confidence;
    const beatConf = detectBpm(clickEnvelope(128, 8), 60).confidence;
    expect(beatConf).toBeGreaterThan(noiseConf);
  });

  it('never returns a non-finite tempo', () => {
    for (const env of [[0, 1], new Array(64).fill(0), clickEnvelope(90, 2)]) {
      const est = detectBpm(env, 60);
      expect(Number.isFinite(est.bpm)).toBe(true);
      expect(Number.isFinite(est.confidence)).toBe(true);
    }
  });
});
