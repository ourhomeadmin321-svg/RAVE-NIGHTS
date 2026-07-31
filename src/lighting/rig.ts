import { aimDirection, approach, approach3, clamp01, type Vec3 } from '../core/math';
import type { RGB } from '../core/types';

export type FixtureKind = 'beam' | 'wash' | 'strobe' | 'blinder';

export type LaserEffect = 'off' | 'fan' | 'tunnel' | 'cone' | 'sheet' | 'scan' | 'grid';

/**
 * One moving head, strobe or blinder.
 *
 * Everything the director touches is a `target*` field; the fixture eases
 * toward it in `update`. Real moving heads have mass and cannot teleport, and
 * modelling that is most of what makes the rig read as physical rather than as
 * a slideshow of poses. Strobes and blinders are the exception — they snap,
 * which is exactly why they read as impacts.
 */
export interface Fixture {
  id: number;
  kind: FixtureKind;
  pos: Vec3;
  /** Index within its kind group — chases key off this. */
  index: number;

  homePan: number;
  homeTilt: number;

  pan: number;
  tilt: number;
  targetPan: number;
  targetTilt: number;

  dimmer: number;
  targetDimmer: number;

  color: RGB;
  targetColor: RGB;

  /** Cone half-angle in radians. Beams are tight, washes are wide. */
  cone: number;
  targetCone: number;

  /** 0 = shutter open. Otherwise flashes at this rate in Hz. */
  strobeHz: number;
  /** Fraction of each strobe cycle the shutter is open. */
  strobeDuty: number;

  /** How fast pan/tilt track their targets, in approach units per second. */
  moveRate: number;
  /** Throw distance in metres. */
  reach: number;

  // Computed each frame.
  dir: Vec3;
  /** Final emitted intensity after the shutter. */
  out: number;
}

export interface LedBar {
  id: number;
  start: Vec3;
  end: Vec3;
  pixels: RGB[];
  intensity: number;
}

export type WallMode = 'spectrum' | 'pulse' | 'tunnel' | 'strobe' | 'logo' | 'noise' | 'off';

export interface LedWall {
  center: Vec3;
  /** Half-extents in world units. */
  halfWidth: number;
  halfHeight: number;
  mode: WallMode;
  intensity: number;
  color: RGB;
  /** Feeds the wall shader; set from band energies. */
  spectrum: Float32Array;
}

export interface Laser {
  id: number;
  pos: Vec3;
  color: RGB;
  targetColor: RGB;
  effect: LaserEffect;
  /** Beams in the fan/cone/tunnel. */
  count: number;
  /** Angular spread of the effect, radians. */
  spread: number;
  pan: number;
  tilt: number;
  targetPan: number;
  targetTilt: number;
  /** Rotation phase, advanced by spinRate each second. */
  spin: number;
  spinRate: number;
  intensity: number;
  targetIntensity: number;
  reach: number;
}

/** Global safety clamps. Honoured by every flashing element in the app. */
export interface SafetySettings {
  reduceFlashing: boolean;
  /** Hard ceiling on strobe rate, in Hz. */
  maxStrobeHz: number;
}

export const SAFE_DEFAULTS: SafetySettings = { reduceFlashing: false, maxStrobeHz: 14 };

/** Ceiling used when "reduce flashing" is on — below the photosensitivity risk band. */
export const REDUCED_MAX_STROBE_HZ = 2.5;

export class Rig {
  fixtures: Fixture[] = [];
  lasers: Laser[] = [];
  bars: LedBar[] = [];
  wall: LedWall | null = null;

  /** Haze density, 0..2. Nothing in the air means no visible beams at all. */
  haze = 1;
  /** Transient boost from a hazer burst; decays on its own. */
  hazeBurst = 0;

  safety: SafetySettings = { ...SAFE_DEFAULTS };

  private nextId = 0;

  addFixture(f: Partial<Fixture> & Pick<Fixture, 'kind' | 'pos'>): Fixture {
    const index = this.fixtures.filter((x) => x.kind === f.kind).length;
    const isBeam = f.kind === 'beam';
    const fixture: Fixture = {
      id: this.nextId++,
      index,
      homePan: f.homePan ?? 0,
      homeTilt: f.homeTilt ?? Math.PI * 0.35,
      pan: f.homePan ?? 0,
      tilt: f.homeTilt ?? Math.PI * 0.35,
      targetPan: f.homePan ?? 0,
      targetTilt: f.homeTilt ?? Math.PI * 0.35,
      dimmer: 0,
      targetDimmer: 0,
      color: [1, 1, 1],
      targetColor: [1, 1, 1],
      cone: isBeam ? 0.035 : 0.22,
      targetCone: isBeam ? 0.035 : 0.22,
      strobeHz: 0,
      strobeDuty: 0.4,
      moveRate: isBeam ? 7 : 4,
      reach: isBeam ? 45 : 26,
      dir: [0, -1, 0],
      out: 0,
      ...f,
    };
    this.fixtures.push(fixture);
    return fixture;
  }

  addLaser(l: Partial<Laser> & Pick<Laser, 'pos'>): Laser {
    const laser: Laser = {
      id: this.nextId++,
      color: [0, 1, 0.3],
      targetColor: [0, 1, 0.3],
      effect: 'fan',
      count: 12,
      spread: 0.55,
      pan: 0,
      tilt: Math.PI * 0.5,
      targetPan: 0,
      targetTilt: Math.PI * 0.5,
      spin: 0,
      spinRate: 0.2,
      intensity: 0,
      targetIntensity: 0,
      reach: 60,
      ...l,
    };
    this.lasers.push(laser);
    return laser;
  }

  addBar(start: Vec3, end: Vec3, pixelCount: number): LedBar {
    const bar: LedBar = {
      id: this.nextId++,
      start,
      end,
      pixels: Array.from({ length: pixelCount }, () => [0, 0, 0] as RGB),
      intensity: 1,
    };
    this.bars.push(bar);
    return bar;
  }

  setWall(wall: LedWall): void {
    this.wall = wall;
  }

  group(kind: FixtureKind): Fixture[] {
    return this.fixtures.filter((f) => f.kind === kind);
  }

  hazeDensity(): number {
    return clamp01((this.haze + this.hazeBurst) / 2) * 2;
  }

  burstHaze(amount = 0.8): void {
    this.hazeBurst = Math.min(1.5, this.hazeBurst + amount);
  }

  /**
   * Advance the rig. `time` is the audio clock, so shutters stay phase-locked
   * to the music instead of to wall-clock time.
   */
  update(dt: number, time: number): void {
    const maxHz = this.safety.reduceFlashing ? REDUCED_MAX_STROBE_HZ : this.safety.maxStrobeHz;

    for (const f of this.fixtures) {
      f.pan = approach(f.pan, f.targetPan, f.moveRate, dt);
      f.tilt = approach(f.tilt, f.targetTilt, f.moveRate, dt);
      f.cone = approach(f.cone, f.targetCone, 6, dt);
      f.color = approach3(f.color, f.targetColor, 9, dt);
      // Dimmers snap up and fade down — a light hitting full instantly is what
      // makes a bump read as a hit.
      const rate = f.targetDimmer > f.dimmer ? 26 : 9;
      f.dimmer = approach(f.dimmer, f.targetDimmer, rate, dt);
      f.dir = aimDirection(f.pan, f.tilt);

      let shutter = 1;
      if (f.strobeHz > 0) {
        const hz = Math.min(f.strobeHz, maxHz);
        const duty = this.safety.reduceFlashing ? Math.min(f.strobeDuty, 0.5) : f.strobeDuty;
        const phase = (time * hz) % 1;
        shutter = phase < duty ? 1 : 0;
        if (this.safety.reduceFlashing) {
          // Soften rather than blacking out: a dim floor keeps the room legible.
          shutter = 0.45 + shutter * 0.55;
        }
      }
      f.out = clamp01(f.dimmer) * shutter;
    }

    for (const l of this.lasers) {
      l.pan = approach(l.pan, l.targetPan, 5, dt);
      l.tilt = approach(l.tilt, l.targetTilt, 5, dt);
      l.color = approach3(l.color, l.targetColor, 10, dt);
      l.intensity = approach(l.intensity, l.targetIntensity, l.targetIntensity > l.intensity ? 22 : 8, dt);
      l.spin += l.spinRate * dt;
    }

    this.hazeBurst = Math.max(0, this.hazeBurst - dt * 0.35);
  }

  /** Reset every emitter to dark. Used on scene changes and blackout cues. */
  blackout(): void {
    for (const f of this.fixtures) {
      f.targetDimmer = 0;
      f.strobeHz = 0;
    }
    for (const l of this.lasers) l.targetIntensity = 0;
    for (const b of this.bars) for (const p of b.pixels) p[0] = p[1] = p[2] = 0;
    if (this.wall) this.wall.intensity = 0;
  }
}
