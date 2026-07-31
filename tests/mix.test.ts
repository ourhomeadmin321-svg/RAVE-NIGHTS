import { describe, expect, it } from 'vitest';
import { filterForSection, sectionMix } from '../src/audio/synth';
import type { ArrangementState } from '../src/audio/arrangement';
import type { Section } from '../src/core/types';
import { Rng } from '../src/core/rng';

function state(section: Section, barsIn = 4, bars = 16): ArrangementState {
  return {
    section,
    startBar: 0,
    barsIn,
    barsToNext: bars - barsIn,
    progress: barsIn / bars,
    nextSection: 'drop',
  };
}

describe('sectionMix', () => {
  const sections: Section[] = ['intro', 'build', 'drop', 'breakdown', 'outro'];

  it('keeps every layer level in 0..1', () => {
    for (const s of sections) {
      for (const energy of [0, 0.5, 1]) {
        const mix = sectionMix(state(s), energy);
        for (const [layer, v] of Object.entries(mix)) {
          expect(v, `${s}.${layer}`).toBeGreaterThanOrEqual(0);
          expect(v, `${s}.${layer}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('removes the kick in a breakdown and restores it on the drop', () => {
    expect(sectionMix(state('breakdown'), 0.8).kick).toBe(0);
    expect(sectionMix(state('drop'), 0.8).kick).toBe(1);
  });

  it('holds the bass back until the intro is under way', () => {
    expect(sectionMix(state('intro', 0), 1).bass).toBe(0);
    expect(sectionMix(state('intro', 12), 1).bass).toBeGreaterThan(0);
  });

  it('brings the lead in gradually through a build', () => {
    const early = sectionMix(state('build', 2), 0.8).lead;
    const late = sectionMix(state('build', 14), 0.8).lead;
    expect(late).toBeGreaterThan(early);
  });

  it('gives a drop more total energy than any other section', () => {
    const total = (s: Section): number =>
      Object.values(sectionMix(state(s), 0.8)).reduce((a, b) => a + b, 0);
    const drop = total('drop');
    for (const s of ['intro', 'build', 'breakdown', 'outro'] as Section[]) {
      expect(drop).toBeGreaterThan(total(s));
    }
  });
});

describe('filterForSection', () => {
  it('opens the filter through a build and lands fully open on the drop', () => {
    const early = filterForSection(state('build', 0));
    const late = filterForSection(state('build', 15));
    expect(late).toBeGreaterThan(early);
    expect(filterForSection(state('drop'))).toBe(0.5);
  });

  it('stays inside the knob range for every section', () => {
    for (const s of ['intro', 'build', 'drop', 'breakdown', 'outro'] as Section[]) {
      for (const barsIn of [0, 8, 16]) {
        const v = filterForSection(state(s, barsIn));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = Array.from({ length: 10 }, () => new Rng('rave').next());
    const b = Array.from({ length: 10 }, () => new Rng('rave').next());
    expect(a).toEqual(b);
  });

  it('differs between seeds', () => {
    expect(new Rng('a').next()).not.toBe(new Rng('b').next());
  });

  it('stays in [0, 1) and never degenerates', () => {
    const rng = new Rng(0);
    let distinct = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      distinct.add(v);
    }
    expect(distinct.size).toBeGreaterThan(900);
  });

  it('picks within bounds', () => {
    const rng = new Rng('pick');
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 200; i++) {
      expect(items).toContain(rng.pick(items));
      const n = rng.int(0, 3);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(3);
    }
  });
});
