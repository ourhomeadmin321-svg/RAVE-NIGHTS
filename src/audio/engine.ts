import { softClipCurve } from './voices';

/**
 * The master audio chain.
 *
 * Layout mirrors a real club signal path: instrument buses feed a DJ-style
 * sweep filter, then glue compression, then a limiter guarding the output.
 * The analyser sits *after* the limiter so the lighting reacts to what the room
 * actually hears, not to a pre-fader signal that ignores the filter sweep.
 *
 *   drums ┐
 *   bass  ├─> sum ─> lowpass ─> highpass ─> glue comp ─> master gain ─> limiter ─> out
 *   lead  │                                                                  └─> analyser
 *   fx    ┘
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly drumBus: GainNode;
  readonly bassBus: GainNode;
  readonly leadBus: GainNode;
  readonly fxBus: GainNode;
  readonly analyser: AnalyserNode;

  private sum: GainNode;
  private lowpass: BiquadFilterNode;
  private highpass: BiquadFilterNode;
  private glue: DynamicsCompressorNode;
  private master: GainNode;
  private limiter: DynamicsCompressorNode;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const ctx = this.ctx;

    this.sum = ctx.createGain();
    this.sum.gain.value = 1;

    this.drumBus = ctx.createGain();
    this.bassBus = ctx.createGain();
    this.leadBus = ctx.createGain();
    this.fxBus = ctx.createGain();
    this.drumBus.gain.value = 1;
    this.bassBus.gain.value = 0.9;
    this.leadBus.gain.value = 0.8;
    this.fxBus.gain.value = 0.7;
    for (const b of [this.drumBus, this.bassBus, this.leadBus, this.fxBus]) b.connect(this.sum);

    // DJ-mixer style single knob: one filter sweeps down, the other sweeps up.
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 20000;
    this.lowpass.Q.value = 1;

    this.highpass = ctx.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 20;
    this.highpass.Q.value = 1;

    this.glue = ctx.createDynamicsCompressor();
    this.glue.threshold.value = -18;
    this.glue.knee.value = 12;
    this.glue.ratio.value = 3;
    this.glue.attack.value = 0.006;
    this.glue.release.value = 0.18;

    this.master = ctx.createGain();
    this.master.gain.value = 0.75;

    const sat = ctx.createWaveShaper();
    sat.curve = softClipCurve(1.4);

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.08;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.5;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -10;

    this.sum
      .connect(this.lowpass)
      .connect(this.highpass)
      .connect(this.glue)
      .connect(this.master)
      .connect(sat)
      .connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.limiter.connect(ctx.destination);
  }

  get currentTime(): number {
    return this.ctx.currentTime;
  }

  /** Browsers require a user gesture before audio will start. */
  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  async suspend(): Promise<void> {
    if (this.ctx.state === 'running') await this.ctx.suspend();
  }

  setMasterGain(v: number): void {
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1.2, v)), this.ctx.currentTime, 0.02);
  }

  /**
   * Single filter knob, 0..1. 0.5 is neutral; below sweeps the lowpass down,
   * above sweeps the highpass up. Exponential mapping so the sweep sounds
   * linear to the ear rather than bunching at one end.
   */
  setFilter(v: number): void {
    const t = this.ctx.currentTime;
    const x = Math.max(0, Math.min(1, v));
    if (x < 0.5) {
      const k = x / 0.5; // 0 (closed) .. 1 (open)
      const f = 180 * Math.pow(20000 / 180, k);
      this.lowpass.frequency.setTargetAtTime(f, t, 0.02);
      this.highpass.frequency.setTargetAtTime(20, t, 0.02);
      this.lowpass.Q.setTargetAtTime(1 + (1 - k) * 6, t, 0.02);
    } else {
      const k = (x - 0.5) / 0.5; // 0 (open) .. 1 (thin)
      const f = 20 * Math.pow(4000 / 20, k);
      this.highpass.frequency.setTargetAtTime(f, t, 0.02);
      this.lowpass.frequency.setTargetAtTime(20000, t, 0.02);
      this.highpass.Q.setTargetAtTime(1 + k * 6, t, 0.02);
    }
  }

  /** Duck the instrument buses, used for build-ups and breakdowns. */
  setBusGains(drums: number, bass: number, lead: number, fx: number): void {
    const t = this.ctx.currentTime;
    this.drumBus.gain.setTargetAtTime(drums, t, 0.05);
    this.bassBus.gain.setTargetAtTime(bass * 0.9, t, 0.05);
    this.leadBus.gain.setTargetAtTime(lead * 0.8, t, 0.05);
    this.fxBus.gain.setTargetAtTime(fx * 0.7, t, 0.05);
  }

  /** Route an external source (uploaded file or mic) into the analyser path. */
  connectExternal(node: AudioNode, toSpeakers: boolean): void {
    node.connect(this.analyser);
    if (toSpeakers) node.connect(this.ctx.destination);
  }

  dispose(): void {
    void this.ctx.close();
  }
}
