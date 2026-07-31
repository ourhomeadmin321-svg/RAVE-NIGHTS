/**
 * Shared vocabulary for the whole app.
 *
 * The single most important type here is `MusicSource`. The synth engine and
 * the audio-input mode both implement it, so every piece of lighting logic is
 * written exactly once and works against either. The synth engine fills it with
 * ground truth (it knows which beat the drop lands on); the input mode fills it
 * from spectral analysis and reports `confident: false` so the lighting
 * director degrades to reactive cues instead of faking foreknowledge.
 */

export type GenreId = 'house' | 'techno' | 'trance' | 'dubstep' | 'dnb' | 'breakbeat';

export const GENRE_IDS: GenreId[] = ['house', 'techno', 'trance', 'dubstep', 'dnb', 'breakbeat'];

/** Arrangement sections, in the order a set moves through them. */
export type Section = 'intro' | 'build' | 'drop' | 'breakdown' | 'outro';

export interface Transport {
  /** Absolute bar index since transport start. */
  bar: number;
  /** Beat within the bar, 0..3 (fractional). */
  beat: number;
  /** Position within the current 16-bar phrase, 0..1. */
  phrasePos: number;
  bpm: number;
  /** Absolute 16th-note step index since transport start. */
  step: number;
  /**
   * False when the transport is inferred from audio analysis rather than
   * generated. Consumers must not schedule anything sample-exact off an
   * unconfident transport.
   */
  confident: boolean;
}

export interface Bands {
  sub: number;
  low: number;
  mid: number;
  high: number;
}

export interface Onsets {
  kick: boolean;
  snare: boolean;
  hat: boolean;
}

export interface MusicSource {
  readonly kind: 'synth' | 'input';
  transport(): Transport;
  section(): Section;
  /** Bars remaining until the next section, or -1 when unknown. */
  barsToNextSection(): number;
  /** Smoothed band energies, each 0..1. */
  bands(): Bands;
  /** True only on the frame an onset was detected. */
  onsets(): Onsets;
  /** Overall intensity, 0..1. */
  energy(): number;
  genre(): GenreId;
  /** Advance analysis/smoothing. Called once per rendered frame. */
  update(dt: number): void;
}

export type RGB = [number, number, number];
