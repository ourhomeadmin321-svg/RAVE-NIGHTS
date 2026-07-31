import { describe, expect, it } from 'vitest';
import { Trip } from '../src/gfx/trip';
import type { Bands, GenreId, MusicSource, Onsets, Section, Transport } from '../src/core/types';

/** Minimal MusicSource stub — the trip model only reads a few fields. */
function source(over: Partial<{
  section: Section;
  energy: number;
  barsToNext: number;
  onsets: Onsets;
}> = {}): MusicSource {
  const s = over.section ?? 'drop';
  const e = over.energy ?? 0.8;
  const b = over.barsToNext ?? -1;
  const o = over.onsets ?? { kick: false, snare: false, hat: false };
  return {
    kind: 'synth',
    transport: (): Transport => ({ bar: 0, beat: 0, phrasePos: 0, bpm: 138, step: 0, confident: true }),
    section: () => s,
    barsToNextSection: () => b,
    bands: (): Bands => ({ sub: 0.5, low: 0.5, mid: 0.5, high: 0.5 }),
    onsets: () => o,
    energy: () => e,
    genre: (): GenreId => 'trance',
    update: () => undefined,
  };
}

/** Run the model to convergence for a fixed input. */
function settle(trip: Trip, src: MusicSource, seconds = 12): number {
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) trip.update(dt, src);
  return trip.level;
}

describe('Trip', () => {
  it('starts sober', () => {
    expect(new Trip().level).toBe(0);
  });

  it('ranks sections by how far gone they are', () => {
    const at = (section: Section): number => settle(new Trip(), source({ section, energy: 0.6 }));
    const intro = at('intro');
    const outro = at('outro');
    const breakdown = at('breakdown');
    const build = at('build');
    const drop = at('drop');

    expect(intro).toBeLessThan(outro);
    expect(outro).toBeLessThan(breakdown);
    expect(breakdown).toBeLessThan(build);
    expect(build).toBeLessThan(drop);
  });

  it('keeps the level in 0..1 at every extreme', () => {
    for (const section of ['intro', 'build', 'drop', 'breakdown', 'outro'] as Section[]) {
      for (const energy of [0, 0.5, 1]) {
        const l = settle(new Trip(), source({ section, energy }));
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThanOrEqual(1);
      }
    }
  });

  it('climbs through a build toward the drop', () => {
    const far = settle(new Trip(), source({ section: 'build', energy: 0.6, barsToNext: 8 }));
    const near = settle(new Trip(), source({ section: 'build', energy: 0.6, barsToNext: 1 }));
    expect(near).toBeGreaterThan(far);
  });

  it('rises faster than it falls', () => {
    const dt = 1 / 60;
    const up = new Trip();
    for (let i = 0; i < 30; i++) up.update(dt, source({ section: 'drop' }));
    const risen = up.level;

    const down = new Trip();
    settle(down, source({ section: 'drop' }));
    const peak = down.level;
    for (let i = 0; i < 30; i++) down.update(dt, source({ section: 'intro', energy: 0 }));
    const fallen = peak - down.level;

    expect(risen).toBeGreaterThan(fallen);
  });

  it('is frame-rate independent', () => {
    const src = source({ section: 'drop' });
    const fast = new Trip();
    for (let i = 0; i < 600; i++) fast.update(1 / 120, src);
    const slow = new Trip();
    for (let i = 0; i < 300; i++) slow.update(1 / 60, src);
    expect(fast.level).toBeCloseTo(slow.level, 3);
  });

  describe('layer staggering', () => {
    // The whole design is that effects arrive in sequence rather than together.
    it('brings the liquid warp in before the kaleidoscope or the fractal', () => {
      const t = new Trip();
      t.override = 0.3;
      settle(t, source());
      const l = t.layers();
      expect(l.warp).toBeGreaterThan(0);
      expect(l.kaleido).toBe(0);
      expect(l.fractal).toBe(0);
    });

    it('holds the fractal back until nearly maximum', () => {
      const t = new Trip();
      t.override = 0.45;
      settle(t, source());
      expect(t.layers().fractal).toBe(0);

      t.override = 1;
      settle(t, source());
      expect(t.layers().fractal).toBeGreaterThan(0.9);
    });

    it('keeps every layer in 0..1 across the whole range', () => {
      const t = new Trip();
      for (let v = 0; v <= 1.0001; v += 0.05) {
        t.override = v;
        settle(t, source(), 6);
        const l = t.layers();
        for (const [name, value] of Object.entries(l)) {
          if (name === 'segments') continue;
          expect(value, `${name} at ${v.toFixed(2)}`).toBeGreaterThanOrEqual(0);
          expect(value, `${name} at ${v.toFixed(2)}`).toBeLessThanOrEqual(1);
        }
      }
    });

    it('keeps feedback strictly below 1 so the loop cannot run away', () => {
      // Each frame multiplies the previous one by this; at 1.0 it never decays.
      const t = new Trip();
      t.override = 1;
      settle(t, source());
      expect(t.layers().feedback).toBeLessThan(0.95);
    });

    it('uses a sane kaleidoscope segment count', () => {
      const t = new Trip();
      settle(t, source());
      const seg = t.layers().segments;
      expect(seg).toBeGreaterThanOrEqual(3);
      expect(seg).toBeLessThanOrEqual(16);
    });
  });

  it('spikes the glitch on a snare and decays it', () => {
    const t = new Trip();
    t.override = 0.8;
    settle(t, source(), 6);
    const quiet = t.layers().glitch;

    t.update(1 / 60, source({ onsets: { kick: false, snare: true, hat: false } }));
    const hit = t.layers().glitch;
    expect(hit).toBeGreaterThan(quiet);

    for (let i = 0; i < 60; i++) t.update(1 / 60, source());
    expect(t.layers().glitch).toBeLessThan(hit);
  });

  it('respects a manual bias and hands back control at zero', () => {
    const src = source({ section: 'intro', energy: 0 });
    const biased = new Trip();
    biased.bias = 0.8;
    const plain = new Trip();
    expect(settle(biased, src)).toBeGreaterThan(settle(plain, src));

    biased.bias = 0;
    expect(settle(biased, src)).toBeCloseTo(settle(plain, src), 3);
  });

  it('resets to sober', () => {
    const t = new Trip();
    settle(t, source());
    t.reset();
    expect(t.level).toBe(0);
  });
});
