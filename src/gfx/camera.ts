import { approach, approach3, clamp, lookAt, multiply, perspective, type Mat4, type Vec3 } from '../core/math';

export type CameraMode = 'auto' | 'orbit' | 'crowd' | 'booth' | 'overhead';

export const CAMERA_MODES: CameraMode[] = ['auto', 'orbit', 'crowd', 'booth', 'overhead'];

interface Shot {
  name: string;
  /** `p` runs 0..1 across the shot. */
  place(p: number, time: number): { pos: Vec3; target: Vec3; fov: number };
}

/**
 * Camera.
 *
 * `auto` mode cuts between shots on phrase boundaries rather than on a timer,
 * so the edit lands with the music the way a camera operator or a VJ would cut
 * it. Every mode gets a small kick-driven shake, which does more for the sense
 * of loudness than any amount of extra brightness.
 */
export class Camera {
  mode: CameraMode = 'auto';
  fov = (58 * Math.PI) / 180;

  pos: Vec3 = [0, 1.7, 12];
  target: Vec3 = [0, 2.4, -2];

  /** Orbit state, also used as the smoothing destination for scripted shots. */
  private azimuth = 0;
  private elevation = 0.18;
  private distance = 14;
  private pivot: Vec3 = [0, 2.2, 0];

  private shotIndex = 0;
  private shotStartBar = 0;
  private shake = 0;
  private shakeSeed = Math.random() * 100;

  /** Operator handheld drift. 0 is locked-off tripod, 1 is shoulder-mounted. */
  handheld = 0.7;
  /** Smoothed subject distance, in metres — what the lens focuses on. */
  private focus = 12;

  private dragging = false;
  private lastPointer: [number, number] = [0, 0];

  private shots: Shot[] = [
    {
      name: 'floor',
      place: (p, t) => ({
        pos: [Math.sin(t * 0.15) * 3, 1.65, 11 - p * 5],
        target: [0, 3.2 + Math.sin(t * 0.3) * 0.6, -4],
        fov: (62 * Math.PI) / 180,
      }),
    },
    {
      name: 'wide low',
      place: (_p, t) => ({
        pos: [Math.sin(t * 0.1) * 9, 1.1, 15],
        target: [0, 4.5, -6],
        fov: (70 * Math.PI) / 180,
      }),
    },
    {
      name: 'orbit booth',
      place: (p, t) => {
        const a = t * 0.12 + p * 1.2;
        return {
          pos: [Math.sin(a) * 8, 3.2 + Math.sin(t * 0.2) * 0.8, Math.cos(a) * 8 + 2],
          target: [0, 2.6, -3],
          fov: (55 * Math.PI) / 180,
        };
      },
    },
    {
      name: 'overhead',
      place: (p, t) => ({
        pos: [Math.sin(t * 0.2) * 4, 9.5 - p * 1.5, 6],
        target: [0, 0.5, -1],
        fov: (66 * Math.PI) / 180,
      }),
    },
    {
      name: 'behind booth',
      place: (_p, t) => ({
        pos: [Math.sin(t * 0.25) * 1.2, 3.4, -7.5],
        target: [0, 2.2, 8],
        fov: (74 * Math.PI) / 180,
      }),
    },
    {
      name: 'beam level',
      place: (p, t) => ({
        pos: [-7 + p * 14, 5.6, 4 + Math.sin(t * 0.2) * 2],
        target: [0, 3.5, -5],
        fov: (58 * Math.PI) / 180,
      }),
    },
  ];

  attach(canvas: HTMLCanvasElement): () => void {
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.lastPointer = [e.clientX, e.clientY];
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer[0];
      const dy = e.clientY - this.lastPointer[1];
      this.lastPointer = [e.clientX, e.clientY];
      // Dragging implies the user wants control; hand it to them.
      if (this.mode === 'auto') this.mode = 'orbit';
      this.azimuth -= dx * 0.005;
      this.elevation = clamp(this.elevation + dy * 0.004, -0.35, 1.2);
    };
    const up = (e: PointerEvent) => {
      this.dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.mode === 'auto') this.mode = 'orbit';
      this.distance = clamp(this.distance * Math.exp(e.deltaY * 0.001), 3, 30);
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });

    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }

  /** Force a cut to the next shot. */
  cut(): void {
    this.shotIndex = (this.shotIndex + 1) % this.shots.length;
    this.shotStartBar = -1;
  }

  shotName(): string {
    return this.mode === 'auto' ? this.shots[this.shotIndex].name : this.mode;
  }

  update(dt: number, ctx: { bar: number; time: number; kick: boolean; energy: number }): void {
    if (ctx.kick) this.shake = Math.min(1, this.shake + 0.35 + ctx.energy * 0.35);
    this.shake = Math.max(0, this.shake - dt * 3.4);

    let wantPos: Vec3;
    let wantTarget: Vec3;
    let wantFov = this.fov;

    switch (this.mode) {
      case 'auto': {
        // Cut every 8 bars, on the bar line.
        if (this.shotStartBar < 0) this.shotStartBar = ctx.bar;
        const held = ctx.bar - this.shotStartBar;
        if (held >= 8) {
          this.shotIndex = (this.shotIndex + 1) % this.shots.length;
          this.shotStartBar = ctx.bar;
        }
        const p = Math.min(1, Math.max(0, (ctx.bar - this.shotStartBar) / 8));
        const shot = this.shots[this.shotIndex].place(p, ctx.time);
        wantPos = shot.pos;
        wantTarget = shot.target;
        wantFov = shot.fov;
        break;
      }
      case 'orbit': {
        const ce = Math.cos(this.elevation);
        wantPos = [
          this.pivot[0] + Math.sin(this.azimuth) * this.distance * ce,
          this.pivot[1] + Math.sin(this.elevation) * this.distance + 1.5,
          this.pivot[2] + Math.cos(this.azimuth) * this.distance * ce,
        ];
        wantTarget = this.pivot;
        break;
      }
      case 'crowd':
        wantPos = [Math.sin(ctx.time * 0.35) * 0.35, 1.65, 8.5];
        wantTarget = [0, 3.4, -5];
        wantFov = (68 * Math.PI) / 180;
        break;
      case 'booth':
        wantPos = [0, 3.1, -6.5];
        wantTarget = [0, 2.0, 9];
        wantFov = (76 * Math.PI) / 180;
        break;
      case 'overhead':
        wantPos = [0, 11, 5];
        wantTarget = [0, 0, -1];
        wantFov = (62 * Math.PI) / 180;
        break;
    }

    // Cuts should be instant, drift should be smooth. Snapping on a cut and
    // easing otherwise is what separates an edit from a lazy flythrough.
    const cutting = this.mode === 'auto' && ctx.bar === this.shotStartBar;
    const rate = cutting ? 60 : 4.5;
    this.pos = approach3(this.pos, wantPos, rate, dt);
    this.target = approach3(this.target, wantTarget, rate, dt);
    this.fov = approach(this.fov, wantFov, 3, dt);
    this.updateFocus(dt, this.pos);
  }

  /**
   * Camera position with kick shake and handheld drift applied.
   *
   * The drift is three sine layers at incommensurate rates rather than noise,
   * because a human operator's sway has slow structure to it — a single fast
   * jitter reads as a broken mount, and true random reads as an earthquake.
   * The rates are deliberately not multiples of each other so the pattern never
   * visibly repeats.
   */
  shakenPos(time: number): Vec3 {
    const s = this.shakeSeed;
    let x = this.pos[0];
    let y = this.pos[1];
    let z = this.pos[2];

    if (this.handheld > 0.001) {
      const h = this.handheld;
      // Slow sway, mid-rate breathing, fine tremor.
      x += (Math.sin(time * 0.37 + s) * 0.05 + Math.sin(time * 1.31 + s * 2.1) * 0.014) * h;
      y += (Math.sin(time * 0.29 + s * 1.7) * 0.04 + Math.sin(time * 1.73 + s) * 0.011) * h;
      z += Math.sin(time * 0.23 + s * 0.9) * 0.035 * h;
    }

    if (this.shake > 0.001) {
      const a = this.shake * 0.06;
      x += Math.sin(time * 47 + s) * a;
      y += Math.sin(time * 61 + s * 1.7) * a;
      z += Math.sin(time * 53 + s * 2.3) * a * 0.5;
    }

    return [x, y, z];
  }

  /**
   * Distance the lens should focus at.
   *
   * Taken from the camera's own subject rather than from a depth readback: the
   * look-at target *is* what the shot is about, so focusing on it is both free
   * and correct. Easing it produces real focus pulls whenever the camera cuts
   * or moves, which is most of what sells a shot as photographed.
   */
  focusDistance(): number {
    return this.focus;
  }

  private updateFocus(dt: number, eye: Vec3): void {
    const dx = this.target[0] - eye[0];
    const dy = this.target[1] - eye[1];
    const dz = this.target[2] - eye[2];
    const want = Math.max(1.5, Math.hypot(dx, dy, dz));
    // Slower than the camera move, so focus visibly lags a cut and catches up.
    this.focus = approach(this.focus, want, 2.2, dt);
  }

  viewProj(aspect: number, time: number): { view: Mat4; proj: Mat4; viewProj: Mat4; eye: Vec3 } {
    const eye = this.shakenPos(time);
    // A hand-held camera is never quite level; a slow roll on the up vector is
    // the cheapest way to say "a person is holding this".
    const roll = this.handheld * (Math.sin(time * 0.19 + this.shakeSeed) * 0.022 + this.shake * 0.03);
    const up: Vec3 = [Math.sin(roll), Math.cos(roll), 0];
    const view = lookAt(eye, this.target, up);
    const proj = perspective(this.fov, aspect, 0.1, 160);
    return { view, proj, viewProj: multiply(proj, view), eye };
  }
}
