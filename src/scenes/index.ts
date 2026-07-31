import type { Vec3 } from '../core/math';
import type { GenreId } from '../core/types';
import { MAT, MeshBuilder } from '../gfx/mesh';
import type { Rig } from '../lighting/rig';

export interface SceneDef {
  id: string;
  name: string;
  blurb: string;
  room: { width: number; depth: number; height: number };
  /** Where the dance floor is, for audience-facing cues and camera framing. */
  crowdCenter: Vec3;
  crowdCount: number;
  /** Spread of the crowd around `crowdCenter`. */
  crowdSpread: { x: number; z: number };
  hazeBase: number;
  suggestedGenres: GenreId[];
  /** Rig the fixtures. */
  patch(rig: Rig): void;
  /** Build the static room geometry. */
  buildRoom(b: MeshBuilder, rig: Rig): void;
}

/**
 * Floor, four walls and a ceiling. The room is a closed box because the
 * volumetric pass needs geometry to terminate against — an open scene would let
 * every beam march to the far plane and wash the image out.
 *
 * Convention throughout: the stage is at -Z, the crowd at +Z, Y is up.
 */
function shell(b: MeshBuilder, w: number, d: number, h: number): void {
  const hw = w / 2;
  const hd = d / 2;

  b.quad([-hw, 0, hd], [hw, 0, hd], [hw, 0, -hd], [-hw, 0, -hd], [0, 1, 0], MAT.FLOOR, 0, 8);
  b.quad([-hw, h, -hd], [hw, h, -hd], [hw, h, hd], [-hw, h, hd], [0, -1, 0], MAT.WALL, 0, 6);
  b.quad([-hw, 0, -hd], [hw, 0, -hd], [hw, h, -hd], [-hw, h, -hd], [0, 0, 1], MAT.WALL, 0, 4);
  b.quad([hw, 0, hd], [-hw, 0, hd], [-hw, h, hd], [hw, h, hd], [0, 0, -1], MAT.WALL, 0, 4);
  b.quad([-hw, 0, hd], [-hw, 0, -hd], [-hw, h, -hd], [-hw, h, hd], [1, 0, 0], MAT.WALL, 0, 4);
  b.quad([hw, 0, -hd], [hw, 0, hd], [hw, h, hd], [hw, h, -hd], [-1, 0, 0], MAT.WALL, 0, 4);
}

/** Horizontal truss running across the room at height `y`. */
function truss(b: MeshBuilder, y: number, z: number, halfWidth: number): void {
  b.box([0, y, z], [halfWidth, 0.12, 0.12], MAT.TRUSS);
  b.box([0, y - 0.55, z], [halfWidth, 0.1, 0.1], MAT.TRUSS);
  const span = Math.floor(halfWidth);
  for (let i = -span; i <= span; i += 2) {
    b.box([i, y - 0.28, z], [0.06, 0.28, 0.06], MAT.TRUSS);
  }
}

/** Small housing box under each fixture so the rig is visible in the room. */
function housings(b: MeshBuilder, rig: Rig): void {
  for (const f of rig.fixtures) {
    const size: Vec3 = f.kind === 'beam' ? [0.16, 0.3, 0.16] : [0.22, 0.24, 0.22];
    b.box(f.pos, size, MAT.FIXTURE);
  }
  for (const l of rig.lasers) {
    b.box(l.pos, [0.24, 0.16, 0.3], MAT.FIXTURE);
  }
}

function djBooth(b: MeshBuilder, z: number, width = 3.2, height = 1.15): void {
  b.box([0, height / 2, z], [width / 2, height / 2, 0.7], MAT.BOOTH);
  b.box([0, height + 0.06, z], [width / 2 + 0.15, 0.06, 0.85], MAT.TRUSS);
}

function ledWallQuad(b: MeshBuilder, centerZ: number, halfW: number, halfH: number, centerY: number): void {
  b.quad(
    [-halfW, centerY - halfH, centerZ],
    [halfW, centerY - halfH, centerZ],
    [halfW, centerY + halfH, centerZ],
    [-halfW, centerY + halfH, centerZ],
    [0, 0, 1],
    MAT.LEDWALL,
  );
}

function bars(b: MeshBuilder, rig: Rig): void {
  rig.bars.forEach((bar, i) => {
    b.strip(bar.start, bar.end, 0.09, MAT.LEDBAR, i);
  });
}

// ---------------------------------------------------------------- mainstage

export const MAINSTAGE: SceneDef = {
  id: 'mainstage',
  name: 'Festival Mainstage',
  blurb: 'Wide arc of beams, a wall of LED, and payoffs you can see from the back.',
  room: { width: 44, depth: 46, height: 15 },
  crowdCenter: [0, 1.6, 8],
  crowdCount: 420,
  crowdSpread: { x: 17, z: 15 },
  hazeBase: 0.95,
  suggestedGenres: ['trance', 'house'],

  patch(rig) {
    // Beam arc across the front truss.
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      rig.addFixture({
        kind: 'beam',
        pos: [(t - 0.5) * 30, 11.4, -8],
        homePan: (t - 0.5) * 0.6,
        homeTilt: 1.35,
        reach: 60,
      });
    }
    // Washes lower and further out, filling the room with colour.
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      rig.addFixture({
        kind: 'wash',
        pos: [(t - 0.5) * 34, 8.2, -3],
        homePan: (t - 0.5) * 0.9,
        homeTilt: 1.0,
        reach: 34,
        cone: 0.3,
        targetCone: 0.3,
      });
    }
    for (let i = 0; i < 4; i++) {
      rig.addFixture({
        kind: 'strobe',
        pos: [(i / 3 - 0.5) * 22, 9.5, -10],
        homeTilt: 1.15,
        reach: 40,
        cone: 0.5,
        targetCone: 0.5,
      });
    }
    for (let i = 0; i < 2; i++) {
      rig.addFixture({
        kind: 'blinder',
        pos: [(i - 0.5) * 12, 6.5, -9],
        homeTilt: 1.35,
        reach: 46,
        cone: 0.62,
        targetCone: 0.62,
      });
    }
    for (let i = 0; i < 4; i++) {
      rig.addLaser({
        pos: [(i / 3 - 0.5) * 24, 10.2, -9.5],
        reach: 70,
        color: [0.1, 1, 0.4],
        targetColor: [0.1, 1, 0.4],
      });
    }

    rig.addBar([-9, 2.4, -11.6], [9, 2.4, -11.6], 48);
    rig.addBar([-9, 5.6, -11.6], [9, 5.6, -11.6], 48);
    rig.addBar([-11.5, 0.3, -11.4], [-11.5, 7.5, -11.4], 32);
    rig.addBar([11.5, 0.3, -11.4], [11.5, 7.5, -11.4], 32);

    rig.setWall({
      center: [0, 6.5, -11.9],
      halfWidth: 9,
      halfHeight: 4.6,
      mode: 'logo',
      intensity: 0.8,
      color: [0.3, 0.6, 1],
      spectrum: new Float32Array(4),
    });
  },

  buildRoom(b, rig) {
    const { width, depth, height } = MAINSTAGE.room;
    shell(b, width, depth, height);
    truss(b, 11.6, -8, 16);
    truss(b, 8.4, -3, 17.5);
    // Stage deck.
    b.box([0, 0.6, -10], [14, 0.6, 3], MAT.BOOTH);
    djBooth(b, -9.4, 4, 1.3);
    ledWallQuad(b, -11.9, 9, 4.6, 6.5);
    bars(b, rig);
    housings(b, rig);
  },
};

// ---------------------------------------------------------------- cathedral

export const CATHEDRAL: SceneDef = {
  id: 'cathedral',
  name: 'Laser Cathedral',
  blurb: 'Thick air and eight projectors. The lasers are the instrument here.',
  room: { width: 30, depth: 40, height: 13 },
  crowdCenter: [0, 1.6, 5],
  crowdCount: 300,
  crowdSpread: { x: 11, z: 13 },
  hazeBase: 1.5,
  suggestedGenres: ['techno', 'dnb'],

  patch(rig) {
    // Deliberately few conventional fixtures — they would compete with the beams.
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      rig.addFixture({
        kind: 'beam',
        pos: [(t - 0.5) * 18, 10.5, -6],
        homePan: (t - 0.5) * 0.5,
        homeTilt: 1.45,
        reach: 55,
      });
    }
    for (let i = 0; i < 4; i++) {
      rig.addFixture({
        kind: 'wash',
        pos: [(i / 3 - 0.5) * 20, 7.5, 2],
        homeTilt: 1.0,
        reach: 26,
        cone: 0.34,
        targetCone: 0.34,
      });
    }
    for (let i = 0; i < 2; i++) {
      rig.addFixture({
        kind: 'strobe',
        pos: [(i - 0.5) * 14, 9, -7],
        homeTilt: 1.2,
        reach: 38,
        cone: 0.55,
        targetCone: 0.55,
      });
    }

    // Projectors ringing the room: front pair low, side pairs high, rear pair
    // firing back over the crowd. That spread is what makes tunnels close.
    const spots: Vec3[] = [
      [-9, 3.2, -10],
      [9, 3.2, -10],
      [-13.5, 9.5, -2],
      [13.5, 9.5, -2],
      [-13.5, 9.5, 8],
      [13.5, 9.5, 8],
      [-6, 11.5, 14],
      [6, 11.5, 14],
    ];
    spots.forEach((pos, i) => {
      rig.addLaser({
        pos,
        reach: 80,
        count: 18,
        spinRate: 0.3 + i * 0.05,
        color: [0.2, 1, 0.5],
        targetColor: [0.2, 1, 0.5],
      });
    });

    rig.addBar([-6, 0.25, -13.6], [6, 0.25, -13.6], 40);
    rig.addBar([-13.9, 0.3, -6], [-13.9, 0.3, 10], 40);
    rig.addBar([13.9, 0.3, -6], [13.9, 0.3, 10], 40);

    rig.setWall({
      center: [0, 4.2, -13.9],
      halfWidth: 4,
      halfHeight: 2.4,
      mode: 'noise',
      intensity: 0.5,
      color: [0.7, 0.9, 1],
      spectrum: new Float32Array(4),
    });
  },

  buildRoom(b, rig) {
    const { width, depth, height } = CATHEDRAL.room;
    shell(b, width, depth, height);
    truss(b, 10.7, -6, 10);
    truss(b, 10.7, 4, 10);
    // Columns, for beams to cut between.
    for (const x of [-11, 11]) {
      for (const z of [-8, 0, 8]) {
        b.box([x, height / 2, z], [0.5, height / 2, 0.5], MAT.WALL);
      }
    }
    djBooth(b, -11.5, 3.4, 1.2);
    ledWallQuad(b, -13.9, 4, 2.4, 4.2);
    bars(b, rig);
    housings(b, rig);
  },
};

// ---------------------------------------------------------------- club room

export const CLUBROOM: SceneDef = {
  id: 'clubroom',
  name: 'Intimate Club Room',
  blurb: 'Low ceiling, pixel bars round the booth, everyone close enough to touch it.',
  room: { width: 18, depth: 24, height: 6.2 },
  crowdCenter: [0, 1.6, 3],
  crowdCount: 180,
  crowdSpread: { x: 6.5, z: 7.5 },
  hazeBase: 0.85,
  suggestedGenres: ['house', 'breakbeat'],

  patch(rig) {
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      rig.addFixture({
        kind: 'beam',
        pos: [(t - 0.5) * 9, 5.4, -3],
        homePan: (t - 0.5) * 0.5,
        homeTilt: 1.3,
        reach: 26,
      });
    }
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      rig.addFixture({
        kind: 'wash',
        pos: [(t - 0.5) * 13, 5.5, 2.5],
        homeTilt: 0.85,
        reach: 15,
        cone: 0.36,
        targetCone: 0.36,
      });
    }
    rig.addFixture({
      kind: 'strobe',
      pos: [0, 5.6, -1],
      homeTilt: 1.0,
      reach: 20,
      cone: 0.65,
      targetCone: 0.65,
    });
    rig.addFixture({
      kind: 'blinder',
      pos: [0, 4.2, -5.4],
      homeTilt: 1.45,
      reach: 24,
      cone: 0.7,
      targetCone: 0.7,
    });
    for (let i = 0; i < 2; i++) {
      rig.addLaser({
        pos: [(i - 0.5) * 7, 5.2, -5],
        reach: 34,
        count: 12,
        color: [1, 0.2, 0.5],
        targetColor: [1, 0.2, 0.5],
      });
    }

    // Pixel bars framing the booth — the graphic signature of a small room.
    rig.addBar([-3.2, 1.35, -6.4], [3.2, 1.35, -6.4], 32);
    rig.addBar([-3.4, 0.15, -6.2], [3.4, 0.15, -6.2], 32);
    rig.addBar([-3.6, 0.2, -6.5], [-3.6, 3.0, -6.5], 20);
    rig.addBar([3.6, 0.2, -6.5], [3.6, 3.0, -6.5], 20);
    rig.addBar([-8.9, 2.6, -4], [-8.9, 2.6, 6], 40);
    rig.addBar([8.9, 2.6, -4], [8.9, 2.6, 6], 40);

    rig.setWall({
      center: [0, 3.4, -7.4],
      halfWidth: 3.2,
      halfHeight: 1.8,
      mode: 'spectrum',
      intensity: 0.7,
      color: [1, 0.5, 0.2],
      spectrum: new Float32Array(4),
    });
  },

  buildRoom(b, rig) {
    const { width, depth, height } = CLUBROOM.room;
    shell(b, width, depth, height);
    truss(b, 5.6, -3, 5);
    truss(b, 5.7, 2.5, 7);
    djBooth(b, -6, 2.8, 1.1);
    b.box([0, 0.25, -6.6], [4.2, 0.25, 1.4], MAT.BOOTH);
    ledWallQuad(b, -7.4, 3.2, 1.8, 3.4);
    bars(b, rig);
    housings(b, rig);
  },
};

export const SCENES: SceneDef[] = [MAINSTAGE, CATHEDRAL, CLUBROOM];

export function sceneById(id: string): SceneDef {
  return SCENES.find((s) => s.id === id) ?? MAINSTAGE;
}
