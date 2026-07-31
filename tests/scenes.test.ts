import { describe, expect, it } from 'vitest';
import { SCENES, sceneById } from '../src/scenes';
import { MeshBuilder, VERTEX_FLOATS } from '../src/gfx/mesh';
import { Rig } from '../src/lighting/rig';
import { MAX_FIXTURES, laserBeamDirection } from '../src/gfx/renderer';
import type { LaserEffect } from '../src/lighting/rig';

describe('scenes', () => {
  it('has unique ids and falls back for an unknown one', () => {
    const ids = SCENES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(sceneById('does-not-exist')).toBe(SCENES[0]);
    for (const s of SCENES) expect(sceneById(s.id)).toBe(s);
  });

  for (const scene of SCENES) {
    describe(scene.id, () => {
      it('patches a rig with fixtures, lasers and bars', () => {
        const rig = new Rig();
        scene.patch(rig);
        expect(rig.fixtures.length).toBeGreaterThan(0);
        expect(rig.lasers.length).toBeGreaterThan(0);
        expect(rig.bars.length).toBeGreaterThan(0);
        expect(rig.wall).not.toBeNull();
      });

      it('rigs no more fixtures than the shader can hold', () => {
        const rig = new Rig();
        scene.patch(rig);
        expect(rig.fixtures.length).toBeLessThanOrEqual(MAX_FIXTURES);
      });

      it('keeps every fixture inside the room', () => {
        const rig = new Rig();
        scene.patch(rig);
        const { width, depth, height } = scene.room;
        for (const f of [...rig.fixtures, ...rig.lasers]) {
          expect(Math.abs(f.pos[0])).toBeLessThanOrEqual(width / 2);
          expect(Math.abs(f.pos[2])).toBeLessThanOrEqual(depth / 2);
          expect(f.pos[1]).toBeGreaterThanOrEqual(0);
          expect(f.pos[1]).toBeLessThanOrEqual(height);
        }
      });

      it('indexes each fixture group from zero', () => {
        const rig = new Rig();
        scene.patch(rig);
        for (const kind of ['beam', 'wash', 'strobe', 'blinder'] as const) {
          const group = rig.group(kind);
          group.forEach((f, i) => expect(f.index).toBe(i));
        }
      });

      it('builds finite room geometry', () => {
        const rig = new Rig();
        scene.patch(rig);
        const b = new MeshBuilder();
        scene.buildRoom(b, rig);
        const mesh = b.build();

        expect(mesh.indices.length).toBeGreaterThan(0);
        expect(mesh.indices.length % 3).toBe(0);
        expect(mesh.vertices.length % VERTEX_FLOATS).toBe(0);

        const vertexCount = mesh.vertices.length / VERTEX_FLOATS;
        for (const i of mesh.indices) expect(i).toBeLessThan(vertexCount);
        for (const v of mesh.vertices) expect(Number.isFinite(v)).toBe(true);
      });
    });
  }
});

describe('laserBeamDirection', () => {
  const effects: LaserEffect[] = ['fan', 'tunnel', 'cone', 'sheet', 'scan', 'grid'];

  for (const effect of effects) {
    it(`${effect} returns unit vectors for every beam`, () => {
      const rig = new Rig();
      const laser = rig.addLaser({ pos: [0, 8, -8], effect, count: 16, spread: 0.5 });
      for (let i = 0; i < laser.count; i++) {
        const d = laserBeamDirection(laser, i, laser.count);
        expect(Math.hypot(...d)).toBeCloseTo(1, 5);
      }
    });

    it(`${effect} spreads beams rather than stacking them`, () => {
      const rig = new Rig();
      const laser = rig.addLaser({ pos: [0, 8, -8], effect, count: 12, spread: 0.5 });
      const first = laserBeamDirection(laser, 0, laser.count);
      const last = laserBeamDirection(laser, laser.count - 1, laser.count);
      const dot = first[0] * last[0] + first[1] * last[1] + first[2] * last[2];
      expect(dot).toBeLessThan(0.9999);
    });
  }

  it('survives a laser aimed straight up, where the basis is degenerate', () => {
    const rig = new Rig();
    const laser = rig.addLaser({ pos: [0, 1, 0], effect: 'cone', count: 8, tilt: Math.PI });
    for (let i = 0; i < laser.count; i++) {
      const d = laserBeamDirection(laser, i, laser.count);
      expect(Math.hypot(...d)).toBeCloseTo(1, 5);
    }
  });

  it('handles a single-beam laser', () => {
    const rig = new Rig();
    const laser = rig.addLaser({ pos: [0, 5, 0], effect: 'fan', count: 1 });
    const d = laserBeamDirection(laser, 0, 1);
    expect(Math.hypot(...d)).toBeCloseTo(1, 5);
  });
});
