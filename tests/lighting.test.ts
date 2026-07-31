import { describe, expect, it } from 'vitest';
import { GENRES } from '../src/audio/genres';
import { COLORS, INTENSITIES, LASER_CUES, MOVEMENTS, aimAt, type CueContext } from '../src/lighting/cues';
import { REDUCED_MAX_STROBE_HZ, Rig } from '../src/lighting/rig';
import { aimDirection } from '../src/core/math';

function makeRig(beams = 8): Rig {
  const rig = new Rig();
  for (let i = 0; i < beams; i++) {
    rig.addFixture({ kind: 'beam', pos: [(i - beams / 2) * 2, 10, -6] });
  }
  rig.addLaser({ pos: [0, 8, -8] });
  return rig;
}

function makeContext(overrides: Partial<CueContext> = {}): CueContext {
  return {
    time: 3.25,
    dt: 1 / 60,
    beatPhase: 0.25,
    barPhase: 0.5,
    phrasePos: 0.3,
    bar: 7,
    beat: 2,
    section: 'drop',
    energy: 0.8,
    bands: { sub: 0.6, low: 0.7, mid: 0.4, high: 0.3 },
    onsets: { kick: true, snare: false, hat: false },
    palette: GENRES.trance.lighting.palette,
    personality: GENRES.trance.lighting,
    crowdCenter: [0, 1.6, 6],
    ...overrides,
  };
}

describe('movement cues', () => {
  for (const cue of MOVEMENTS) {
    it(`${cue.name} produces finite, in-range pan and tilt`, () => {
      const rig = makeRig();
      const beams = rig.group('beam');
      cue.apply(makeContext(), beams);
      for (const f of beams) {
        expect(Number.isFinite(f.targetPan)).toBe(true);
        expect(Number.isFinite(f.targetTilt)).toBe(true);
        // Tilt is measured from straight down, so it must stay within [0, PI].
        expect(f.targetTilt).toBeGreaterThanOrEqual(0);
        expect(f.targetTilt).toBeLessThanOrEqual(Math.PI);
        expect(Math.abs(f.targetPan)).toBeLessThanOrEqual(Math.PI);
      }
    });
  }

  it('spreads a fan across the fixture group', () => {
    const rig = makeRig();
    const beams = rig.group('beam');
    MOVEMENTS.find((m) => m.name === 'fan')!.apply(makeContext(), beams);
    // Outermost fixtures must point further out than the middle ones.
    expect(Math.abs(beams[0].targetPan)).toBeGreaterThan(Math.abs(beams[3].targetPan));
  });

  it('converges every beam on one point in a cone', () => {
    const rig = makeRig();
    const beams = rig.group('beam');
    const ctx = makeContext();
    MOVEMENTS.find((m) => m.name === 'cone')!.apply(ctx, beams);
    // Fixtures on opposite sides must aim inward, i.e. with opposite pan signs.
    expect(Math.sign(beams[0].targetPan)).not.toBe(Math.sign(beams[beams.length - 1].targetPan));
  });
});

describe('aimAt', () => {
  it('produces a direction that points at the target', () => {
    const rig = makeRig(1);
    const f = rig.group('beam')[0];
    const target: [number, number, number] = [3, 0, 5];
    aimAt(f, target);

    const dir = aimDirection(f.targetPan, f.targetTilt);
    const dx = target[0] - f.pos[0];
    const dy = target[1] - f.pos[1];
    const dz = target[2] - f.pos[2];
    const len = Math.hypot(dx, dy, dz);
    expect(dir[0]).toBeCloseTo(dx / len, 5);
    expect(dir[1]).toBeCloseTo(dy / len, 5);
    expect(dir[2]).toBeCloseTo(dz / len, 5);
  });
});

describe('colour cues', () => {
  for (const cue of COLORS) {
    it(`${cue.name} stays within the 0..1 colour range`, () => {
      const rig = makeRig();
      const beams = rig.group('beam');
      cue.apply(makeContext(), beams);
      for (const f of beams) {
        for (const ch of f.targetColor) {
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  it('desaturates for a monochrome genre', () => {
    const rig = makeRig();
    const beams = rig.group('beam');
    const ctx = makeContext({ personality: GENRES.techno.lighting, palette: GENRES.techno.lighting.palette });
    COLORS.find((c) => c.name === 'spread')!.apply(ctx, beams);
    for (const f of beams) {
      const [r, g, b] = f.targetColor;
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.35);
    }
  });
});

describe('intensity cues', () => {
  for (const cue of INTENSITIES) {
    it(`${cue.name} keeps dimmers in 0..1 and strobe rates sane`, () => {
      const rig = makeRig();
      const beams = rig.group('beam');
      cue.apply(makeContext(), beams, 1);
      for (const f of beams) {
        expect(f.targetDimmer).toBeGreaterThanOrEqual(0);
        expect(f.targetDimmer).toBeLessThanOrEqual(1);
        expect(f.strobeHz).toBeGreaterThanOrEqual(0);
        expect(f.strobeHz).toBeLessThan(40);
      }
    });
  }

  it('scales with the level it is given', () => {
    const rig = makeRig();
    const beams = rig.group('beam');
    INTENSITIES.find((i) => i.name === 'full')!.apply(makeContext(), beams, 0.4);
    for (const f of beams) expect(f.targetDimmer).toBeCloseTo(0.4);
  });

  it('lights exactly one fixture at a time in a chase', () => {
    const rig = makeRig();
    const beams = rig.group('beam');
    INTENSITIES.find((i) => i.name === 'chase')!.apply(makeContext(), beams, 1);
    expect(beams.filter((f) => f.targetDimmer > 0.5)).toHaveLength(1);
  });
});

describe('laser cues', () => {
  for (const cue of LASER_CUES) {
    it(`${cue.name} sets a valid effect and beam count`, () => {
      const rig = makeRig();
      cue.apply(makeContext(), rig.lasers, 1);
      for (const l of rig.lasers) {
        expect(l.count).toBeGreaterThan(0);
        expect(l.targetIntensity).toBeGreaterThanOrEqual(0);
        expect(l.targetIntensity).toBeLessThanOrEqual(1);
        expect(Number.isFinite(l.spread)).toBe(true);
      }
    });
  }

  it('turns the lasers off for the off cue', () => {
    const rig = makeRig();
    LASER_CUES.find((l) => l.name === 'off')!.apply(makeContext(), rig.lasers, 1);
    for (const l of rig.lasers) expect(l.targetIntensity).toBe(0);
  });
});

describe('Rig', () => {
  it('eases dimmers toward their targets and normalises aim', () => {
    const rig = makeRig(2);
    const f = rig.group('beam')[0];
    f.targetDimmer = 1;
    rig.update(1 / 60, 0);
    expect(f.dimmer).toBeGreaterThan(0);
    expect(f.dimmer).toBeLessThanOrEqual(1);
    expect(Math.hypot(...f.dir)).toBeCloseTo(1, 5);
  });

  it('snaps dimmers up faster than it fades them down', () => {
    const rig = makeRig(1);
    const f = rig.group('beam')[0];
    f.targetDimmer = 1;
    rig.update(1 / 60, 0);
    const rise = f.dimmer;

    f.dimmer = 1;
    f.targetDimmer = 0;
    rig.update(1 / 60, 0);
    const fall = 1 - f.dimmer;
    expect(rise).toBeGreaterThan(fall);
  });

  it('chops output with the strobe shutter', () => {
    const rig = makeRig(1);
    const f = rig.group('beam')[0];
    f.dimmer = 1;
    f.targetDimmer = 1;
    f.strobeHz = 10;
    f.strobeDuty = 0.4;

    rig.update(0, 0); // phase 0 — shutter open
    expect(f.out).toBeGreaterThan(0.5);
    rig.update(0, 0.08); // phase 0.8 — shutter closed
    expect(f.out).toBe(0);
  });

  it('clamps the strobe rate and lifts the floor when flashing is reduced', () => {
    const rig = makeRig(1);
    rig.safety.reduceFlashing = true;
    const f = rig.group('beam')[0];
    f.dimmer = 1;
    f.targetDimmer = 1;
    f.strobeHz = 30;

    // Sample a full second: with the cap in place there can be at most a
    // couple of dark phases, and none of them may reach full black.
    let minOut = 1;
    for (let i = 0; i < 120; i++) {
      rig.update(0, i / 120);
      minOut = Math.min(minOut, f.out);
    }
    expect(minOut).toBeGreaterThan(0.3);
    expect(REDUCED_MAX_STROBE_HZ).toBeLessThan(3);
  });

  it('decays a haze burst back to the base level', () => {
    const rig = makeRig(1);
    rig.haze = 1;
    const base = rig.hazeDensity();
    rig.burstHaze(1);
    expect(rig.hazeDensity()).toBeGreaterThan(base);
    for (let i = 0; i < 300; i++) rig.update(1 / 60, i / 60);
    expect(rig.hazeDensity()).toBeCloseTo(base, 5);
  });

  it('blacks out every emitter', () => {
    const rig = makeRig(4);
    for (const f of rig.fixtures) f.targetDimmer = 1;
    for (const l of rig.lasers) l.targetIntensity = 1;
    rig.blackout();
    for (const f of rig.fixtures) expect(f.targetDimmer).toBe(0);
    for (const l of rig.lasers) expect(l.targetIntensity).toBe(0);
  });
});
