import type { GenreId, RGB } from '../core/types';
import type { ArrangementStep } from './arrangement';
import { DEFAULT_CYCLE } from './arrangement';

/**
 * Genre definitions.
 *
 * Patterns are written as 16-character strings — one bar of 16th notes — so
 * they read like a drum machine grid instead of an array of magic numbers:
 *   `x` accent   `o` normal   `-` ghost   `.` rest
 *
 * Each genre also carries a *lighting personality*. Tempo alone does not
 * distinguish these styles (dubstep and techno overlap in BPM but feel nothing
 * alike), and neither does the light show: a techno room is monochrome and
 * brutal where a trance mainstage is full-spectrum and euphoric. Encoding that
 * here is what stops every genre from looking the same.
 */

export type PatternString = string;

export interface DrumGrid {
  kick: PatternString;
  snare: PatternString;
  hat: PatternString;
  openHat: PatternString;
  perc: PatternString;
}

export type BassVoice = 'sub' | 'acid' | 'reese' | 'wobble' | 'pluck';
export type LeadVoice = 'supersaw' | 'stab' | 'pluck' | 'none';

export interface LightingPersonality {
  /** Colors the director draws from, linear-ish RGB 0..1. */
  palette: RGB[];
  /** How fast moving heads travel, 0..1. */
  movementSpeed: number;
  /** How readily strobes and blinders fire, 0..1. */
  strobeAggression: number;
  /** How much of the look is carried by lasers, 0..1. */
  laserDensity: number;
  /** 0 = wide wash cones, 1 = pencil beams. */
  beamTightness: number;
  /** Baseline haze density multiplier. */
  hazeBias: number;
  /** Whether the palette should stay near-monochrome. */
  monochrome: boolean;
}

export interface GenreDef {
  id: GenreId;
  name: string;
  blurb: string;
  bpm: { default: number; min: number; max: number };
  /** 0 = straight, ~0.15 = a noticeable shuffle. Applied to off-16ths. */
  swing: number;
  /** True for four-on-the-floor genres; false for break-driven ones. */
  fourOnFloor: boolean;
  /** Half-time feel — the drums sit at half the apparent tempo. */
  halfTime: boolean;
  drums: DrumGrid;
  /** Extra drum energy layered in on drops. */
  dropDrums?: Partial<DrumGrid>;
  bassVoice: BassVoice;
  bassPattern: PatternString;
  leadVoice: LeadVoice;
  leadPattern: PatternString;
  /** Semitone offsets from the root that form the scale. */
  scale: number[];
  /** MIDI note of the root. */
  root: number;
  /** Chord progression as scale degrees, one entry per 4 bars. */
  progression: number[];
  lighting: LightingPersonality;
  /** Optional arrangement override. */
  cycle?: readonly ArrangementStep[];
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];

export const GENRES: Record<GenreId, GenreDef> = {
  house: {
    id: 'house',
    name: 'House',
    blurb: 'Four-on-the-floor, swung hats, warm chord stabs.',
    bpm: { default: 124, min: 118, max: 130 },
    swing: 0.14,
    fourOnFloor: true,
    halfTime: false,
    drums: {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      hat: '..o...o...o...o.',
      openHat: '..x...x...x...x.',
      perc: '......-...-...-.',
    },
    dropDrums: { perc: '..-.-.-...-.-.-.' },
    bassVoice: 'pluck',
    bassPattern: 'x..x..x...x..x..',
    leadVoice: 'stab',
    leadPattern: '..x...x.....x...',
    scale: MINOR,
    root: 45, // A2
    progression: [0, 5, 3, 4],
    lighting: {
      palette: [
        [1.0, 0.45, 0.12],
        [1.0, 0.15, 0.55],
        [0.95, 0.8, 0.35],
        [0.35, 0.15, 0.7],
      ],
      movementSpeed: 0.35,
      strobeAggression: 0.25,
      laserDensity: 0.35,
      beamTightness: 0.4,
      hazeBias: 0.85,
      monochrome: false,
    },
  },

  techno: {
    id: 'techno',
    name: 'Techno',
    blurb: 'Relentless, minimal, industrial. The room goes monochrome.',
    bpm: { default: 132, min: 126, max: 145 },
    swing: 0,
    fourOnFloor: true,
    halfTime: false,
    drums: {
      kick: 'x...x...x...x...',
      snare: '....o.......o...',
      hat: 'o-o-o-o-o-o-o-o-',
      openHat: '..x...x...x...x.',
      perc: '...-..-....-..-.',
    },
    dropDrums: { hat: 'xoxoxoxoxoxoxoxo', perc: '..-.-.-.-.-.-.-.' },
    bassVoice: 'acid',
    bassPattern: 'x.xxx.x.xx.x.xx.',
    leadVoice: 'none',
    leadPattern: '................',
    scale: PHRYGIAN,
    root: 41, // F2
    progression: [0, 0, 6, 0],
    lighting: {
      palette: [
        [1.0, 1.0, 1.0],
        [0.6, 0.9, 1.0],
        [0.75, 0.8, 0.95],
        [0.9, 0.95, 1.0],
      ],
      movementSpeed: 0.7,
      strobeAggression: 0.95,
      laserDensity: 0.5,
      beamTightness: 0.95,
      hazeBias: 1.2,
      monochrome: true,
    },
  },

  trance: {
    id: 'trance',
    name: 'Trance',
    blurb: 'Long builds, supersaw leads, breakdowns that gut you.',
    bpm: { default: 138, min: 132, max: 145 },
    swing: 0,
    fourOnFloor: true,
    halfTime: false,
    drums: {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      hat: '..o...o...o...o.',
      openHat: '..x...x...x...x.',
      perc: '..............-.',
    },
    dropDrums: { hat: 'o-o-o-o-o-o-o-o-' },
    bassVoice: 'sub',
    // The trance signature: offbeat 16ths rolling in behind the kick.
    bassPattern: '.xx..xx..xx..xx.',
    leadVoice: 'supersaw',
    leadPattern: 'x.......x...x...',
    scale: MINOR,
    root: 45,
    progression: [0, 5, 3, 4],
    lighting: {
      palette: [
        [0.2, 0.5, 1.0],
        [1.0, 0.3, 0.75],
        [0.35, 1.0, 0.85],
        [1.0, 0.75, 0.2],
        [0.7, 0.3, 1.0],
      ],
      movementSpeed: 0.5,
      strobeAggression: 0.6,
      laserDensity: 0.85,
      beamTightness: 0.6,
      hazeBias: 1.0,
      monochrome: false,
    },
    cycle: [
      // Trance earns its drop with a longer build and a real breakdown.
      { section: 'intro', bars: 16 },
      { section: 'build', bars: 32 },
      { section: 'drop', bars: 32 },
      { section: 'breakdown', bars: 32 },
      { section: 'build', bars: 16 },
      { section: 'drop', bars: 32 },
      { section: 'outro', bars: 8 },
    ],
  },

  dubstep: {
    id: 'dubstep',
    name: 'Dubstep',
    blurb: 'Half-time, wobble bass, drops that hit like a truck.',
    bpm: { default: 140, min: 136, max: 146 },
    swing: 0,
    fourOnFloor: false,
    halfTime: true,
    drums: {
      // Half-time: kick on 1, snare on 3. The tempo is 140 but it *feels* 70.
      kick: 'x.......x.x.....',
      snare: '........x.......',
      hat: '..o...o...o...o.',
      openHat: '............x...',
      perc: '..............-.',
    },
    dropDrums: { kick: 'x...x...x.x.....', perc: '...-......-...-.' },
    bassVoice: 'wobble',
    bassPattern: 'x...x...x...x...',
    leadVoice: 'none',
    leadPattern: '................',
    scale: PHRYGIAN,
    root: 38, // D2
    progression: [0, 0, 3, 2],
    lighting: {
      palette: [
        [0.35, 1.0, 0.25],
        [0.7, 0.2, 1.0],
        [1.0, 0.9, 0.1],
        [0.1, 1.0, 0.8],
      ],
      movementSpeed: 0.85,
      strobeAggression: 1.0,
      laserDensity: 0.6,
      beamTightness: 0.8,
      hazeBias: 1.1,
      monochrome: false,
    },
    cycle: [
      { section: 'intro', bars: 8 },
      { section: 'build', bars: 8 },
      { section: 'drop', bars: 16 },
      { section: 'breakdown', bars: 8 },
      { section: 'build', bars: 8 },
      { section: 'drop', bars: 16 },
      { section: 'outro', bars: 8 },
    ],
  },

  dnb: {
    id: 'dnb',
    name: 'Drum & Bass',
    blurb: 'Rolling breakbeats at 174, reese bass under everything.',
    bpm: { default: 174, min: 168, max: 180 },
    swing: 0,
    fourOnFloor: false,
    halfTime: false,
    drums: {
      // Two-step: kick on 1 and the "and" of 3, snare on 2 and 4.
      kick: 'x.........x.....',
      snare: '....x.......x...',
      hat: 'o-o-o-o-o-o-o-o-',
      openHat: '......x.......x.',
      perc: '..-..-..-..-..-.',
    },
    dropDrums: { kick: 'x....x....x...x.', perc: '-.-.-.-.-.-.-.-.' },
    bassVoice: 'reese',
    bassPattern: 'x.......x.......',
    leadVoice: 'none',
    leadPattern: '................',
    scale: MINOR,
    root: 36, // C2
    progression: [0, 0, 5, 3],
    lighting: {
      palette: [
        [0.15, 0.5, 1.0],
        [1.0, 0.5, 0.05],
        [0.1, 0.95, 1.0],
        [1.0, 0.2, 0.3],
      ],
      movementSpeed: 1.0,
      strobeAggression: 0.8,
      laserDensity: 0.9,
      beamTightness: 0.85,
      hazeBias: 1.0,
      monochrome: false,
    },
  },

  breakbeat: {
    id: 'breakbeat',
    name: 'Breakbeat',
    blurb: 'Chopped breaks, syncopated and off-grid. No four-on-the-floor.',
    bpm: { default: 132, min: 124, max: 140 },
    swing: 0.08,
    fourOnFloor: false,
    halfTime: false,
    drums: {
      kick: 'x..x..x.....x...',
      snare: '....x.......x...',
      hat: 'o-o-o-o-o-o-o-o-',
      openHat: '..........x.....',
      perc: '..-...-..-....-.',
    },
    dropDrums: { kick: 'x..x..x...x.x...', snare: '....x...-...x..-' },
    bassVoice: 'acid',
    bassPattern: 'x..x..x...x..x..',
    leadVoice: 'stab',
    leadPattern: '....x.......x...',
    scale: MINOR,
    root: 43, // G2
    progression: [0, 3, 5, 4],
    lighting: {
      palette: [
        [1.0, 0.25, 0.1],
        [0.2, 0.85, 1.0],
        [1.0, 0.85, 0.2],
        [0.9, 0.1, 0.6],
      ],
      movementSpeed: 0.75,
      strobeAggression: 0.55,
      laserDensity: 0.45,
      beamTightness: 0.55,
      hazeBias: 0.9,
      monochrome: false,
    },
  },
};

/** Velocity for a step, 0 when there is no hit. */
export function stepVelocity(pattern: PatternString, step: number): number {
  const ch = pattern[((step % 16) + 16) % 16];
  switch (ch) {
    case 'x':
      return 1;
    case 'o':
      return 0.72;
    case '-':
      return 0.4;
    default:
      return 0;
  }
}

/** A grid is well-formed if every lane is exactly 16 legal characters. */
export function validateGrid(grid: Partial<DrumGrid>): boolean {
  return Object.values(grid).every(
    (lane) => typeof lane === 'string' && lane.length === 16 && /^[xo\-.]{16}$/.test(lane),
  );
}

export function cycleFor(genre: GenreDef): readonly ArrangementStep[] {
  return genre.cycle ?? DEFAULT_CYCLE;
}

/** Equal-temperament MIDI note to frequency. */
export function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Nth degree of a scale, wrapping into higher octaves as needed. */
export function scaleNote(scale: number[], root: number, degree: number): number {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return root + octave * 12 + scale[idx];
}
