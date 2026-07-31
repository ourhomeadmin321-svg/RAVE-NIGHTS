import type { Vec3 } from '../core/math';

/** Material ids — must stay in sync with the constants in scene.frag. */
export const MAT = {
  FLOOR: 0,
  WALL: 1,
  TRUSS: 2,
  BOOTH: 3,
  LEDWALL: 4,
  LEDBAR: 5,
  FIXTURE: 6,
} as const;

export const VERTEX_FLOATS = 10; // pos3 + normal3 + uv2 + mat1 + aux1

export interface MeshData {
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * Builds the static room geometry into one interleaved buffer.
 *
 * The whole room is a single draw call — a club is a few hundred triangles and
 * splitting it into per-object draws would cost more than it saves.
 */
export class MeshBuilder {
  private verts: number[] = [];
  private idx: number[] = [];

  get vertexCount(): number {
    return this.verts.length / VERTEX_FLOATS;
  }

  private push(p: Vec3, n: Vec3, u: number, v: number, mat: number, aux: number): number {
    const i = this.vertexCount;
    this.verts.push(p[0], p[1], p[2], n[0], n[1], n[2], u, v, mat, aux);
    return i;
  }

  /** Quad wound a→b→c→d. `uvScale` tiles the UVs for surfaces like floors. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, mat: number, aux = 0, uvScale = 1): void {
    const i0 = this.push(a, n, 0, 0, mat, aux);
    const i1 = this.push(b, n, uvScale, 0, mat, aux);
    const i2 = this.push(c, n, uvScale, uvScale, mat, aux);
    const i3 = this.push(d, n, 0, uvScale, mat, aux);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  box(center: Vec3, half: Vec3, mat: number, aux = 0): void {
    const [x, y, z] = center;
    const [hx, hy, hz] = half;
    const p = (dx: number, dy: number, dz: number): Vec3 => [x + dx * hx, y + dy * hy, z + dz * hz];

    this.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), [0, 0, 1], mat, aux);
    this.quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), [0, 0, -1], mat, aux);
    this.quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), [1, 0, 0], mat, aux);
    this.quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), [-1, 0, 0], mat, aux);
    this.quad(p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), [0, 1, 0], mat, aux);
    this.quad(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), [0, -1, 0], mat, aux);
  }

  /**
   * A thin emissive strip between two points, always facing +Z-ish.
   * `aux` carries the bar index so the fragment shader can look up its pixels.
   */
  strip(start: Vec3, end: Vec3, thickness: number, mat: number, aux: number): void {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const dz = end[2] - start[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return;

    // Perpendicular in the plane that faces the room.
    const ax = dx / len;
    const ay = dy / len;
    const az = dz / len;
    // Prefer a vertical offset for horizontal bars, horizontal for vertical bars.
    const useVertical = Math.abs(ay) < 0.7;
    const px = useVertical ? 0 : 1;
    const py = useVertical ? thickness : 0;
    const pz = 0;
    const ox = useVertical ? 0 : thickness;

    const a: Vec3 = [start[0] - ox * px, start[1] - py, start[2] - pz];
    const b: Vec3 = [end[0] - ox * px, end[1] - py, end[2] - pz];
    const c: Vec3 = [end[0] + ox * px, end[1] + py, end[2] + pz];
    const d: Vec3 = [start[0] + ox * px, start[1] + py, start[2] + pz];

    // Normal points away from the wall the bar is mounted on.
    const n: Vec3 = normalizeSafe([-az * 0 + 0, 0, 1]);
    this.quad(a, b, c, d, n, mat, aux);
    // Back face so the bar reads from behind too.
    this.quad(d, c, b, a, [0, 0, -1], mat, aux);
    void ax;
  }

  build(): MeshData {
    return { vertices: new Float32Array(this.verts), indices: new Uint32Array(this.idx) };
  }
}

function normalizeSafe(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1];
}
