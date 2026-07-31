/**
 * Synthesised voices.
 *
 * Every voice is a fire-and-forget function: build a small node graph, schedule
 * it at an exact AudioContext time, and let it tear itself down when it ends.
 * Nothing here holds state between hits, which is what makes the scheduler free
 * to run ahead of the playhead without bookkeeping.
 *
 * Gain envelopes ramp to `EPS` rather than 0 because `exponentialRampToValue`
 * is undefined at zero — a detail that silently produces clicks or NaNs if you
 * skip it.
 */

const EPS = 0.0001;

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of white noise, reused for every noise-based voice. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (buf) return buf;
  const len = Math.floor(ctx.sampleRate * 2);
  buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

function env(
  ctx: BaseAudioContext,
  t: number,
  peak: number,
  attack: number,
  decay: number,
  sustain = 0,
  hold = 0,
): GainNode {
  const g = ctx.createGain();
  const p = Math.max(peak, EPS);
  g.gain.setValueAtTime(EPS, t);
  g.gain.exponentialRampToValueAtTime(p, t + attack);
  if (sustain > 0 && hold > 0) {
    g.gain.exponentialRampToValueAtTime(Math.max(p * sustain, EPS), t + attack + decay);
    g.gain.setValueAtTime(Math.max(p * sustain, EPS), t + attack + decay + hold);
    g.gain.exponentialRampToValueAtTime(EPS, t + attack + decay + hold + decay);
  } else {
    g.gain.exponentialRampToValueAtTime(EPS, t + attack + decay);
  }
  return g;
}

function stopLater(node: AudioScheduledSourceNode, t: number): void {
  node.stop(t);
  node.onended = () => node.disconnect();
}

// ---------------------------------------------------------------- drums

export interface DrumOpts {
  vel?: number;
  tune?: number;
  decay?: number;
}

/**
 * Kick: a sine whose pitch collapses from ~`tune*1.6` to `tune` in a few
 * milliseconds, plus a short click transient for definition on small speakers.
 * That pitch collapse is the entire character of a 909-style kick.
 */
export function kick(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DrumOpts = {}): void {
  const vel = o.vel ?? 1;
  const base = o.tune ?? 48;
  const decay = o.decay ?? 0.42;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(base * 3.4, t);
  osc.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.012);
  osc.frequency.exponentialRampToValueAtTime(base, t + 0.09);

  const g = env(ctx, t, 0.95 * vel, 0.002, decay);
  osc.connect(g).connect(dest);
  osc.start(t);
  stopLater(osc, t + decay + 0.05);

  // Click transient.
  const click = ctx.createBufferSource();
  click.buffer = noiseBuffer(ctx);
  click.playbackRate.value = 1.5;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1200;
  const cg = env(ctx, t, 0.12 * vel, 0.001, 0.02);
  click.connect(hp).connect(cg).connect(dest);
  click.start(t);
  stopLater(click, t + 0.05);
}

/** Clap/snare: filtered noise burst with a short body tone under it. */
export function snare(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DrumOpts = {}): void {
  const vel = o.vel ?? 1;
  const decay = o.decay ?? 0.18;

  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx);
  n.playbackRate.value = 1 + Math.random() * 0.1;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1900;
  bp.Q.value = 0.8;
  const g = env(ctx, t, 0.6 * vel, 0.001, decay);
  n.connect(bp).connect(g).connect(dest);
  n.start(t);
  stopLater(n, t + decay + 0.05);

  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(220, t);
  body.frequency.exponentialRampToValueAtTime(160, t + 0.06);
  const bg = env(ctx, t, 0.22 * vel, 0.001, 0.07);
  body.connect(bg).connect(dest);
  body.start(t);
  stopLater(body, t + 0.15);
}

export function hat(
  ctx: BaseAudioContext,
  dest: AudioNode,
  t: number,
  o: DrumOpts & { open?: boolean } = {},
): void {
  const vel = o.vel ?? 1;
  const decay = o.decay ?? (o.open ? 0.28 : 0.045);
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx);
  n.playbackRate.value = 1.8;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = o.open ? 7000 : 8800;
  const g = env(ctx, t, 0.24 * vel, 0.001, decay);
  n.connect(hp).connect(g).connect(dest);
  n.start(t);
  stopLater(n, t + decay + 0.05);
}

export function perc(ctx: BaseAudioContext, dest: AudioNode, t: number, o: DrumOpts = {}): void {
  const vel = o.vel ?? 1;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(620 + Math.random() * 400, t);
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.05);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1400;
  bp.Q.value = 4;
  const g = env(ctx, t, 0.2 * vel, 0.001, 0.07);
  osc.connect(bp).connect(g).connect(dest);
  osc.start(t);
  stopLater(osc, t + 0.15);
}

// ---------------------------------------------------------------- bass

export interface BassOpts {
  freq: number;
  dur: number;
  vel?: number;
  /** Filter cutoff in Hz at the envelope peak. */
  cutoff?: number;
  resonance?: number;
  /** Wobble LFO rate in Hz, used by the wobble voice. */
  lfoHz?: number;
  /** Portamento from the previous note, in seconds. */
  glide?: number;
}

export function subBass(ctx: BaseAudioContext, dest: AudioNode, t: number, o: BassOpts): void {
  const vel = o.vel ?? 1;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(o.freq, t);
  const sat = ctx.createWaveShaper();
  sat.curve = softClipCurve(2.2);
  const g = env(ctx, t, 0.5 * vel, 0.006, o.dur * 0.9);
  osc.connect(sat).connect(g).connect(dest);
  osc.start(t);
  stopLater(osc, t + o.dur + 0.1);
}

/** 303-style: saw into a resonant lowpass with an envelope-swept cutoff. */
export function acidBass(ctx: BaseAudioContext, dest: AudioNode, t: number, o: BassOpts): void {
  const vel = o.vel ?? 1;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  if (o.glide && o.glide > 0) {
    osc.frequency.setValueAtTime(o.freq * 0.75, t);
    osc.frequency.exponentialRampToValueAtTime(o.freq, t + o.glide);
  } else {
    osc.frequency.setValueAtTime(o.freq, t);
  }

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = o.resonance ?? 14;
  const peak = o.cutoff ?? 2400;
  lp.frequency.setValueAtTime(Math.max(peak, 80), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(o.freq * 2.2, 80), t + o.dur * 0.85);

  const g = env(ctx, t, 0.34 * vel, 0.004, o.dur * 0.9);
  osc.connect(lp).connect(g).connect(dest);
  osc.start(t);
  stopLater(osc, t + o.dur + 0.1);
}

/** Reese: two detuned saws beating against each other, the DnB staple. */
export function reeseBass(ctx: BaseAudioContext, dest: AudioNode, t: number, o: BassOpts): void {
  const vel = o.vel ?? 1;
  const g = env(ctx, t, 0.3 * vel, 0.02, o.dur * 0.95);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = o.cutoff ?? 900;
  lp.Q.value = 3;
  lp.connect(g).connect(dest);

  for (const detune of [-11, 0, 13]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(o.freq, t);
    osc.detune.setValueAtTime(detune, t);
    osc.connect(lp);
    osc.start(t);
    stopLater(osc, t + o.dur + 0.1);
  }
}

/**
 * Wobble: a sub-heavy saw through a lowpass whose cutoff is swept by an LFO
 * running at a grid-synced rate. The LFO rate is the whole point — it has to be
 * a musical subdivision or it sounds like a broken effect rather than dubstep.
 */
export function wobbleBass(ctx: BaseAudioContext, dest: AudioNode, t: number, o: BassOpts): void {
  const vel = o.vel ?? 1;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 240;
  lp.Q.value = 12;

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(o.lfoHz ?? 4, t);
  const lfoAmt = ctx.createGain();
  lfoAmt.gain.value = 900;
  lfo.connect(lfoAmt).connect(lp.frequency);
  lfo.start(t);
  stopLater(lfo, t + o.dur + 0.1);

  const g = env(ctx, t, 0.42 * vel, 0.01, o.dur * 0.95);
  const sat = ctx.createWaveShaper();
  sat.curve = softClipCurve(3.5);

  for (const detune of [-6, 6]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(o.freq, t);
    osc.detune.setValueAtTime(detune, t);
    osc.connect(lp);
    osc.start(t);
    stopLater(osc, t + o.dur + 0.1);
  }

  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(o.freq * 0.5, t);
  const subG = ctx.createGain();
  subG.gain.value = 0.5;
  sub.connect(subG).connect(g);
  sub.start(t);
  stopLater(sub, t + o.dur + 0.1);

  lp.connect(sat).connect(g).connect(dest);
}

export function pluckBass(ctx: BaseAudioContext, dest: AudioNode, t: number, o: BassOpts): void {
  const vel = o.vel ?? 1;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(o.freq, t);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(o.cutoff ?? 1600, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(o.freq * 2, 80), t + o.dur * 0.6);
  lp.Q.value = 6;
  const g = env(ctx, t, 0.36 * vel, 0.004, o.dur * 0.7);
  osc.connect(lp).connect(g).connect(dest);
  osc.start(t);
  stopLater(osc, t + o.dur + 0.1);
}

// ---------------------------------------------------------------- lead / pad

export interface LeadOpts {
  freqs: number[];
  dur: number;
  vel?: number;
  cutoff?: number;
}

/** Seven detuned saws — the trance supersaw. */
export function supersaw(ctx: BaseAudioContext, dest: AudioNode, t: number, o: LeadOpts): void {
  const vel = o.vel ?? 1;
  const g = env(ctx, t, 0.14 * vel, 0.02, o.dur * 0.35, 0.6, o.dur * 0.4);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = o.cutoff ?? 5200;
  lp.Q.value = 1.2;
  lp.connect(g).connect(dest);

  const detunes = [-24, -14, -7, 0, 7, 14, 24];
  for (const f of o.freqs) {
    for (const d of detunes) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      osc.detune.setValueAtTime(d, t);
      osc.connect(lp);
      osc.start(t);
      stopLater(osc, t + o.dur + 0.15);
    }
  }
}

/** Short filtered chord stab — house and breaks. */
export function stab(ctx: BaseAudioContext, dest: AudioNode, t: number, o: LeadOpts): void {
  const vel = o.vel ?? 1;
  const g = env(ctx, t, 0.13 * vel, 0.004, o.dur * 0.6);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(o.cutoff ?? 3800, t);
  lp.frequency.exponentialRampToValueAtTime(900, t + o.dur * 0.6);
  lp.Q.value = 3;
  lp.connect(g).connect(dest);

  for (const f of o.freqs) {
    for (const d of [-8, 8]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      osc.detune.setValueAtTime(d, t);
      osc.connect(lp);
      osc.start(t);
      stopLater(osc, t + o.dur + 0.1);
    }
  }
}

export function pluckLead(ctx: BaseAudioContext, dest: AudioNode, t: number, o: LeadOpts): void {
  const vel = o.vel ?? 1;
  const g = env(ctx, t, 0.11 * vel, 0.003, o.dur * 0.5);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(o.cutoff ?? 4200, t);
  lp.frequency.exponentialRampToValueAtTime(700, t + o.dur * 0.5);
  lp.Q.value = 5;
  lp.connect(g).connect(dest);
  for (const f of o.freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(f, t);
    osc.connect(lp);
    osc.start(t);
    stopLater(osc, t + o.dur + 0.1);
  }
}

/** Slow, wide pad — carries the breakdowns. */
export function pad(ctx: BaseAudioContext, dest: AudioNode, t: number, o: LeadOpts): void {
  const vel = o.vel ?? 1;
  const g = env(ctx, t, 0.09 * vel, o.dur * 0.25, o.dur * 0.3, 0.7, o.dur * 0.3);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = o.cutoff ?? 2400;
  lp.connect(g).connect(dest);
  for (const f of o.freqs) {
    for (const d of [-12, 0, 12]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      osc.detune.setValueAtTime(d, t);
      osc.connect(lp);
      osc.start(t);
      stopLater(osc, t + o.dur + 0.3);
    }
  }
}

// ---------------------------------------------------------------- fx

/** White-noise riser: the build's tension in one gesture. */
export function riser(ctx: BaseAudioContext, dest: AudioNode, t: number, dur: number, vel = 1): void {
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx);
  n.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.5;
  bp.frequency.setValueAtTime(400, t);
  bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.exponentialRampToValueAtTime(0.22 * vel, t + dur * 0.92);
  g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  n.connect(bp).connect(g).connect(dest);
  n.start(t);
  stopLater(n, t + dur + 0.05);
}

/** Pitch-falling tone that lands on the drop. */
export function downlifter(ctx: BaseAudioContext, dest: AudioNode, t: number, dur = 1.5, vel = 1): void {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(1800, t);
  osc.frequency.exponentialRampToValueAtTime(70, t + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3000;
  const g = env(ctx, t, 0.18 * vel, 0.01, dur);
  osc.connect(lp).connect(g).connect(dest);
  osc.start(t);
  stopLater(osc, t + dur + 0.1);
}

/** Sub-heavy impact for the downbeat of a drop. */
export function impact(ctx: BaseAudioContext, dest: AudioNode, t: number, vel = 1): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(32, t + 0.7);
  const g = env(ctx, t, 0.8 * vel, 0.003, 1.1);
  osc.connect(g).connect(dest);
  osc.start(t);
  stopLater(osc, t + 1.3);

  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(6000, t);
  lp.frequency.exponentialRampToValueAtTime(300, t + 0.6);
  const ng = env(ctx, t, 0.3 * vel, 0.002, 0.6);
  n.connect(lp).connect(ng).connect(dest);
  n.start(t);
  stopLater(n, t + 0.8);
}

/** Reverse-swell noise sweep leading into a section change. */
export function sweep(ctx: BaseAudioContext, dest: AudioNode, t: number, dur = 1, vel = 1): void {
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx);
  n.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(2000, t);
  hp.frequency.exponentialRampToValueAtTime(300, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.exponentialRampToValueAtTime(0.16 * vel, t + dur * 0.85);
  g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  n.connect(hp).connect(g).connect(dest);
  n.start(t);
  stopLater(n, t + dur + 0.05);
}

// ---------------------------------------------------------------- utility

const curveCache = new Map<number, Float32Array<ArrayBuffer>>();

/** tanh-ish soft clipper, cached per drive amount. */
export function softClipCurve(drive: number): Float32Array<ArrayBuffer> {
  const cached = curveCache.get(drive);
  if (cached) return cached;
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  curveCache.set(drive, curve);
  return curve;
}
