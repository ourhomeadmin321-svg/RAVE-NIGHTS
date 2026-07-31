import { describe, expect, it } from 'vitest';
import { GENRES, mtof, scaleNote, stepVelocity, validateGrid } from '../src/audio/genres';
import { GENRE_IDS } from '../src/core/types';

describe('genre definitions', () => {
  it('covers every declared genre id', () => {
    for (const id of GENRE_IDS) expect(GENRES[id]).toBeDefined();
    expect(Object.keys(GENRES).sort()).toEqual([...GENRE_IDS].sort());
  });

  for (const id of GENRE_IDS) {
    const g = GENRES[id];

    describe(id, () => {
      it('has well-formed 16-step drum grids', () => {
        expect(validateGrid(g.drums)).toBe(true);
        if (g.dropDrums) expect(validateGrid(g.dropDrums)).toBe(true);
      });

      it('has 16-step bass and lead patterns', () => {
        expect(g.bassPattern).toHaveLength(16);
        expect(g.leadPattern).toHaveLength(16);
      });

      it('has a default tempo inside its own range', () => {
        expect(g.bpm.min).toBeLessThanOrEqual(g.bpm.default);
        expect(g.bpm.default).toBeLessThanOrEqual(g.bpm.max);
      });

      it('has a usable lighting palette', () => {
        expect(g.lighting.palette.length).toBeGreaterThanOrEqual(3);
        for (const c of g.lighting.palette) {
          expect(c).toHaveLength(3);
          for (const ch of c) expect(ch).toBeGreaterThanOrEqual(0);
          for (const ch of c) expect(ch).toBeLessThanOrEqual(1);
        }
      });

      it('keeps lighting personality values in 0..1', () => {
        const l = g.lighting;
        for (const v of [l.movementSpeed, l.strobeAggression, l.laserDensity, l.beamTightness]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      });

      it('has an ascending scale starting at the root', () => {
        expect(g.scale[0]).toBe(0);
        for (let i = 1; i < g.scale.length; i++) expect(g.scale[i]).toBeGreaterThan(g.scale[i - 1]);
      });

      it('declares only in-scale progression degrees', () => {
        for (const d of g.progression) {
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThan(g.scale.length);
        }
      });
    });
  }

  it('marks the four-on-the-floor genres correctly', () => {
    expect(GENRES.house.fourOnFloor).toBe(true);
    expect(GENRES.techno.fourOnFloor).toBe(true);
    expect(GENRES.trance.fourOnFloor).toBe(true);
    expect(GENRES.dnb.fourOnFloor).toBe(false);
    expect(GENRES.breakbeat.fourOnFloor).toBe(false);
  });

  it('puts a kick on every beat of a four-on-the-floor genre', () => {
    for (const id of ['house', 'techno', 'trance'] as const) {
      for (const step of [0, 4, 8, 12]) {
        expect(stepVelocity(GENRES[id].drums.kick, step)).toBeGreaterThan(0);
      }
    }
  });

  it('gives dubstep a half-time backbeat on 3', () => {
    expect(GENRES.dubstep.halfTime).toBe(true);
    expect(stepVelocity(GENRES.dubstep.drums.snare, 8)).toBeGreaterThan(0);
    expect(stepVelocity(GENRES.dubstep.drums.snare, 4)).toBe(0);
  });
});

describe('validateGrid', () => {
  it('rejects wrong lengths and illegal characters', () => {
    expect(validateGrid({ kick: 'x...x...x...x..' })).toBe(false);
    expect(validateGrid({ kick: 'x...x...x...x..!' })).toBe(false);
    expect(validateGrid({ kick: 'x...x...x...x...' })).toBe(true);
  });
});

describe('stepVelocity', () => {
  it('maps the grid characters to velocities', () => {
    const lane = 'xo-.xo-.xo-.xo-.';
    expect(stepVelocity(lane, 0)).toBe(1);
    expect(stepVelocity(lane, 1)).toBeCloseTo(0.72);
    expect(stepVelocity(lane, 2)).toBeCloseTo(0.4);
    expect(stepVelocity(lane, 3)).toBe(0);
  });

  it('wraps past the end of the bar, including negatives', () => {
    const lane = 'x...............';
    expect(stepVelocity(lane, 16)).toBe(1);
    expect(stepVelocity(lane, -16)).toBe(1);
    expect(stepVelocity(lane, -1)).toBe(0);
  });
});

describe('pitch helpers', () => {
  it('puts A4 at 440Hz and octaves where they belong', () => {
    expect(mtof(69)).toBeCloseTo(440, 6);
    expect(mtof(81)).toBeCloseTo(880, 6);
    expect(mtof(57)).toBeCloseTo(220, 6);
  });

  it('walks scale degrees into higher octaves', () => {
    const minor = [0, 2, 3, 5, 7, 8, 10];
    expect(scaleNote(minor, 60, 0)).toBe(60);
    expect(scaleNote(minor, 60, 2)).toBe(63);
    // One full scale up is one octave.
    expect(scaleNote(minor, 60, 7)).toBe(72);
    expect(scaleNote(minor, 60, -7)).toBe(48);
  });
});
