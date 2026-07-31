import type { Bands, Onsets } from '../core/types';

/**
 * Spectral analysis shared by both audio modes.
 *
 * The synth engine uses this only for band energies (its onsets and transport
 * are ground truth); the input mode leans on all of it, including the beat
 * tracker below.
 */

export interface BandEdges {
  sub: [number, number];
  low: [number, number];
  mid: [number, number];
  high: [number, number];
}

export const DEFAULT_BANDS: BandEdges = {
  sub: [20, 60],
  low: [60, 250],
  mid: [250, 2000],
  high: [2000, 16000],
};

/** Asymmetric smoothing: snap up fast, fall away slowly, like a VU meter. */
function smooth(prev: number, next: number, attack: number, release: number, dt: number): number {
  const coeff = next > prev ? attack : release;
  const k = 1 - Math.exp(-dt / Math.max(coeff, 1e-4));
  return prev + (next - prev) * k;
}

export class SpectralAnalyser {
  private node: AnalyserNode;
  private freq: Float32Array<ArrayBuffer>;
  private prevMag: Float32Array<ArrayBuffer>;
  private binHz: number;

  private smoothed: Bands = { sub: 0, low: 0, mid: 0, high: 0 };
  private _energy = 0;

  // Flux history feeds both onset detection and the tempo tracker.
  private fluxLow: number[] = [];
  private fluxMid: number[] = [];
  private fluxHigh: number[] = [];
  private onsetEnvelope: number[] = [];
  private _onsets: Onsets = { kick: false, snare: false, hat: false };
  private refractory = { kick: 0, snare: 0, hat: 0 };

  /** How many flux frames of history to keep (~8 seconds at 60fps). */
  private readonly historyLen = 512;

  constructor(node: AnalyserNode, private edges: BandEdges = DEFAULT_BANDS) {
    this.node = node;
    this.freq = new Float32Array(node.frequencyBinCount);
    this.prevMag = new Float32Array(node.frequencyBinCount);
    this.binHz = node.context.sampleRate / node.fftSize;
  }

  bands(): Bands {
    return this.smoothed;
  }

  energy(): number {
    return this._energy;
  }

  onsets(): Onsets {
    return this._onsets;
  }

  /** Recent onset strength history, newest last. Used for tempo detection. */
  envelope(): number[] {
    return this.onsetEnvelope;
  }

  update(dt: number): void {
    this.node.getFloatFrequencyData(this.freq);

    // dB (-90..-10) to linear 0..1.
    const bins = this.freq.length;
    let fluxL = 0;
    let fluxM = 0;
    let fluxH = 0;
    const raw: Bands = { sub: 0, low: 0, mid: 0, high: 0 };
    const counts = { sub: 0, low: 0, mid: 0, high: 0 };

    for (let i = 0; i < bins; i++) {
      const hz = i * this.binHz;
      const db = this.freq[i];
      const mag = Math.max(0, (db + 90) / 80); // 0..1

      const d = mag - this.prevMag[i];
      const rect = d > 0 ? d : 0; // half-wave rectified: onsets are rises only
      if (hz < this.edges.low[1]) fluxL += rect;
      else if (hz < this.edges.mid[1]) fluxM += rect;
      else fluxH += rect;
      this.prevMag[i] = mag;

      if (hz >= this.edges.sub[0] && hz < this.edges.sub[1]) {
        raw.sub += mag;
        counts.sub++;
      } else if (hz >= this.edges.low[0] && hz < this.edges.low[1]) {
        raw.low += mag;
        counts.low++;
      } else if (hz >= this.edges.mid[0] && hz < this.edges.mid[1]) {
        raw.mid += mag;
        counts.mid++;
      } else if (hz >= this.edges.high[0] && hz < this.edges.high[1]) {
        raw.high += mag;
        counts.high++;
      }
    }

    const norm = (v: number, c: number) => (c > 0 ? Math.min(1, (v / c) * 1.6) : 0);
    const target: Bands = {
      sub: norm(raw.sub, counts.sub),
      low: norm(raw.low, counts.low),
      mid: norm(raw.mid, counts.mid),
      high: norm(raw.high, counts.high),
    };

    this.smoothed = {
      sub: smooth(this.smoothed.sub, target.sub, 0.02, 0.16, dt),
      low: smooth(this.smoothed.low, target.low, 0.02, 0.14, dt),
      mid: smooth(this.smoothed.mid, target.mid, 0.03, 0.12, dt),
      high: smooth(this.smoothed.high, target.high, 0.02, 0.09, dt),
    };

    const e = this.smoothed.sub * 0.35 + this.smoothed.low * 0.3 + this.smoothed.mid * 0.22 + this.smoothed.high * 0.13;
    this._energy = smooth(this._energy, Math.min(1, e * 1.5), 0.08, 0.5, dt);

    push(this.fluxLow, fluxL, this.historyLen);
    push(this.fluxMid, fluxM, this.historyLen);
    push(this.fluxHigh, fluxH, this.historyLen);
    push(this.onsetEnvelope, fluxL + fluxM * 0.5, this.historyLen);

    for (const k of ['kick', 'snare', 'hat'] as const) {
      this.refractory[k] = Math.max(0, this.refractory[k] - dt);
    }
    this._onsets = {
      kick: this.detect('kick', this.fluxLow, 1.55, 0.09),
      snare: this.detect('snare', this.fluxMid, 1.5, 0.09),
      hat: this.detect('hat', this.fluxHigh, 1.45, 0.045),
    };
  }

  /**
   * Onset when the newest flux frame exceeds an adaptive threshold: the median
   * of recent history times a sensitivity factor. Median rather than mean so a
   * single loud transient does not raise the bar for everything after it.
   */
  private detect(key: keyof Onsets, hist: number[], factor: number, refractorySec: number): boolean {
    if (hist.length < 12 || this.refractory[key] > 0) return false;
    const window = hist.slice(-43);
    const sorted = [...window].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const value = hist[hist.length - 1];
    const threshold = median * factor + 0.02;
    if (value > threshold && value > 0.05) {
      this.refractory[key] = refractorySec;
      return true;
    }
    return false;
  }
}

function push(arr: number[], v: number, max: number): void {
  arr.push(v);
  if (arr.length > max) arr.shift();
}

export interface TempoEstimate {
  bpm: number;
  /** 0..1 — how much stronger the winning lag was than the field. */
  confidence: number;
}

/**
 * Estimate tempo by autocorrelating an onset-strength envelope.
 *
 * Pure function so it can be tested against synthetic click trains at known
 * tempos. `frameRate` is how many envelope samples there are per second (the
 * render frame rate when driven live).
 *
 * Autocorrelation is octave-ambiguous by nature — a 174 BPM signal correlates
 * nearly as well at 87. We resolve that by folding candidates into the given
 * BPM window and then preferring the lower-order (longer) lag on near-ties,
 * which is the beat rather than a subdivision of it.
 */
export function detectBpm(
  envelope: readonly number[] | Float32Array,
  frameRate: number,
  minBpm = 70,
  maxBpm = 200,
): TempoEstimate {
  const n = envelope.length;
  if (n < 32 || frameRate <= 0) return { bpm: 0, confidence: 0 };

  // Remove DC so silence between hits contributes nothing.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += envelope[i];
  mean /= n;
  const x = new Float32Array(n);
  let power = 0;
  for (let i = 0; i < n; i++) {
    x[i] = envelope[i] - mean;
    power += x[i] * x[i];
  }
  if (power <= 1e-9) return { bpm: 0, confidence: 0 };

  const minLag = Math.max(2, Math.floor((60 / maxBpm) * frameRate));
  const maxLag = Math.min(n - 2, Math.ceil((60 / minBpm) * frameRate));
  if (maxLag <= minLag) return { bpm: 0, confidence: 0 };

  const lagCount = maxLag - minLag + 1;
  const scores = new Float32Array(lagCount);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const count = n - lag;
    for (let i = 0; i < count; i++) sum += x[i] * x[i + lag];
    // Normalise by overlap so long lags are not penalised for having fewer
    // terms — without this, every estimate drifts toward the shortest lag.
    scores[lag - minLag] = sum / count;
  }

  let bestIdx = 0;
  for (let i = 1; i < lagCount; i++) if (scores[i] > scores[bestIdx]) bestIdx = i;
  if (scores[bestIdx] <= 0) return { bpm: 0, confidence: 0 };

  // A periodic signal peaks at its period *and every multiple of it*, all with
  // similar strength once normalised. The fundamental is therefore the
  // shortest strong peak, not the strongest one — so take the earliest local
  // maximum that comes close to the best score.
  const threshold = scores[bestIdx] * 0.85;
  let chosenIdx = bestIdx;
  for (let i = 1; i < lagCount - 1; i++) {
    if (scores[i] >= threshold && scores[i] >= scores[i - 1] && scores[i] >= scores[i + 1]) {
      chosenIdx = i;
      break;
    }
  }

  // Integer lags are coarse: at 60fps, 174 BPM sits between lag 20 and 21,
  // a 9 BPM gap. Fitting a parabola through the peak recovers the fraction.
  let lag = chosenIdx + minLag;
  if (chosenIdx > 0 && chosenIdx < lagCount - 1) {
    const y0 = scores[chosenIdx - 1];
    const y1 = scores[chosenIdx];
    const y2 = scores[chosenIdx + 1];
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) > 1e-12) {
      const offset = (0.5 * (y0 - y2)) / denom;
      if (Math.abs(offset) <= 1) lag += offset;
    }
  }
  if (lag <= 0) return { bpm: 0, confidence: 0 };

  let bpm = (60 * frameRate) / lag;
  // Fold octave errors back into the requested window.
  while (bpm > maxBpm) bpm /= 2;
  while (bpm < minBpm) bpm *= 2;

  let absMean = 0;
  for (let i = 0; i < lagCount; i++) absMean += Math.abs(scores[i]);
  absMean /= lagCount;
  const confidence = absMean > 0 ? Math.min(1, Math.max(0, (scores[bestIdx] / absMean - 1) / 3)) : 0;

  return { bpm, confidence };
}
