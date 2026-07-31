import { Rng } from '../core/rng';
import { aimDirection, cross, invert, normalize, sub, type Vec3 } from '../core/math';
import type { Bands } from '../core/types';
import type { FixtureKind, Laser, Rig } from '../lighting/rig';
import type { SceneDef } from '../scenes';
import { Camera } from './camera';
import {
  bindTexture,
  createFramebuffer,
  createFullscreenTriangle,
  createProgram,
  deleteFramebuffer,
  resolveIncludes,
  UniformCache,
  type Framebuffer,
  type GL,
} from './gl';
import { MeshBuilder, VERTEX_FLOATS } from './mesh';

import commonGlsl from './shaders/common.glsl?raw';
import fixturesGlsl from './shaders/fixtures.glsl?raw';
import fullscreenVert from './shaders/fullscreen.vert?raw';
import sceneVert from './shaders/scene.vert?raw';
import sceneFrag from './shaders/scene.frag?raw';
import crowdVert from './shaders/crowd.vert?raw';
import crowdFrag from './shaders/crowd.frag?raw';
import volumetricFrag from './shaders/volumetric.frag?raw';
import laserVert from './shaders/laser.vert?raw';
import laserFrag from './shaders/laser.frag?raw';
import bloomDownFrag from './shaders/bloom_down.frag?raw';
import bloomUpFrag from './shaders/bloom_up.frag?raw';
import compositeFrag from './shaders/composite.frag?raw';

const CHUNKS: Record<string, string> = { common: commonGlsl, fixtures: fixturesGlsl };

/** Must match MAX_FIXTURES in shaders/fixtures.glsl. */
export const MAX_FIXTURES = 32;
const MAX_LASER_BEAMS = 320;
const LASER_FLOATS_PER_VERT = 9;
const BAR_TEX_WIDTH = 64;

/** Least-expendable first, so the cap drops washes rather than blinders. */
const PACK_ORDER: FixtureKind[] = ['blinder', 'strobe', 'beam', 'wash'];

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export const QUALITIES: Quality[] = ['low', 'medium', 'high', 'ultra'];

interface QualitySettings {
  renderScale: number;
  volScale: number;
  steps: number;
  bloomLevels: number;
}

const QUALITY_SETTINGS: Record<Quality, QualitySettings> = {
  low: { renderScale: 0.6, volScale: 0.35, steps: 18, bloomLevels: 3 },
  medium: { renderScale: 0.85, volScale: 0.5, steps: 30, bloomLevels: 4 },
  high: { renderScale: 1, volScale: 0.55, steps: 44, bloomLevels: 5 },
  ultra: { renderScale: 1, volScale: 0.8, steps: 72, bloomLevels: 5 },
};

export interface FrameState {
  time: number;
  dt: number;
  beatPhase: number;
  bands: Bands;
  energy: number;
  /** 0..1, spikes on a drop. */
  impact: number;
  reduceFlashing: boolean;
}

/**
 * The renderer.
 *
 * Pass order matters and is not arbitrary:
 *   1. scene geometry into an HDR target with depth
 *   2. crowd billboards (needs scene depth)
 *   3. laser quads, depth-tested so beams stop at walls but do not write depth
 *   4. volumetric raymarch at reduced resolution, reading scene depth to know
 *      where to stop
 *   5. bloom chain off the combined image
 *   6. composite, tonemap, grade
 *
 * Steps 3 and 4 are separate on purpose — see the comment in laser.frag for why
 * lasers are geometry rather than marched.
 */
export class Renderer {
  readonly gl: GL;
  readonly canvas: HTMLCanvasElement;
  camera = new Camera();

  quality: Quality = 'high';
  /** When true, quality steps itself down rather than dropping frames. */
  adaptive = true;
  bloomAmount = 0.45;
  bloomThreshold = 1.1;
  exposure = 0.85;
  anamorphic = 0.35;
  /**
   * Volumetric scattering coefficient, in inverse metres.
   *
   * Calibrated by measuring rendered frames rather than picked by eye: too high
   * and the accumulated in-scatter saturates the whole frame to white, too low
   * and the beams stop reading as solid shafts of light.
   */
  scatter = 1.9;
  /** Multiplier on haze density reaching the shaders. */
  hazeScale = 0.5;
  /** Overall fixture output gain feeding both the scene and volumetric passes. */
  fixtureGain = 0.8;
  /** Laser brightness, balanced against the volumetric cones. */
  laserGain = 0.55;
  /** 0 normal, 1 scene, 2 volumetric, 3 bloom. Isolates a pass for tuning. */
  debugView = 0;

  private hdrSupported: boolean;

  private sceneProgram: WebGLProgram;
  private crowdProgram: WebGLProgram;
  private volProgram: WebGLProgram;
  private laserProgram: WebGLProgram;
  private bloomDownProgram: WebGLProgram;
  private bloomUpProgram: WebGLProgram;
  private compositeProgram: WebGLProgram;

  private sceneU: UniformCache;
  private crowdU: UniformCache;
  private volU: UniformCache;
  private laserU: UniformCache;
  private bloomDownU: UniformCache;
  private bloomUpU: UniformCache;
  private compositeU: UniformCache;

  private fsTriangle: WebGLVertexArrayObject;

  private sceneVao: WebGLVertexArrayObject | null = null;
  private sceneIndexCount = 0;
  private crowdVao: WebGLVertexArrayObject | null = null;
  private crowdCount = 0;
  private laserVao: WebGLVertexArrayObject;
  private laserBuffer: WebGLBuffer;
  private laserData: Float32Array;
  private laserVertCount = 0;

  private barTexture: WebGLTexture;
  private barPixels: Uint8Array;
  private barCount = 0;

  private sceneFbo: Framebuffer | null = null;
  private volFbo: Framebuffer | null = null;
  private bloomChain: Framebuffer[] = [];

  private width = 1;
  private height = 1;
  private frame = 0;

  // Adaptive-quality bookkeeping.
  private frameTimes: number[] = [];
  private sinceQualityChange = 0;

  // Fixture uniform staging buffers, reused every frame.
  private fixPos = new Float32Array(MAX_FIXTURES * 4);
  private fixDir = new Float32Array(MAX_FIXTURES * 4);
  private fixCol = new Float32Array(MAX_FIXTURES * 4);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: true,
      powerPreference: 'high-performance',
      // Only the screenshot runner needs the buffer to survive compositing, and
      // asking for it costs real fill-rate on some drivers. Opt in with ?capture.
      preserveDrawingBuffer: new URLSearchParams(location.search).has('capture'),
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    // Rendering to float targets needs an extension even in WebGL2. Without it
    // we fall back to 8-bit and lose highlight headroom, but still run.
    this.hdrSupported = gl.getExtension('EXT_color_buffer_float') !== null;

    const build = (vs: string, fs: string, label: string): WebGLProgram =>
      createProgram(gl, resolveIncludes(vs, CHUNKS), resolveIncludes(fs, CHUNKS), label);

    this.sceneProgram = build(sceneVert, sceneFrag, 'scene');
    this.crowdProgram = build(crowdVert, crowdFrag, 'crowd');
    this.volProgram = build(fullscreenVert, volumetricFrag, 'volumetric');
    this.laserProgram = build(laserVert, laserFrag, 'laser');
    this.bloomDownProgram = build(fullscreenVert, bloomDownFrag, 'bloomDown');
    this.bloomUpProgram = build(fullscreenVert, bloomUpFrag, 'bloomUp');
    this.compositeProgram = build(fullscreenVert, compositeFrag, 'composite');

    this.sceneU = new UniformCache(gl, this.sceneProgram);
    this.crowdU = new UniformCache(gl, this.crowdProgram);
    this.volU = new UniformCache(gl, this.volProgram);
    this.laserU = new UniformCache(gl, this.laserProgram);
    this.bloomDownU = new UniformCache(gl, this.bloomDownProgram);
    this.bloomUpU = new UniformCache(gl, this.bloomUpProgram);
    this.compositeU = new UniformCache(gl, this.compositeProgram);

    this.fsTriangle = createFullscreenTriangle(gl);

    // Laser geometry is rebuilt every frame; allocate once and stream into it.
    this.laserData = new Float32Array(MAX_LASER_BEAMS * 6 * LASER_FLOATS_PER_VERT);
    const lvao = gl.createVertexArray();
    const lbuf = gl.createBuffer();
    if (!lvao || !lbuf) throw new Error('could not create laser buffers');
    this.laserVao = lvao;
    this.laserBuffer = lbuf;
    gl.bindVertexArray(lvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, lbuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.laserData.byteLength, gl.DYNAMIC_DRAW);
    const stride = LASER_FLOATS_PER_VERT * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 20);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 32);
    gl.bindVertexArray(null);

    const tex = gl.createTexture();
    if (!tex) throw new Error('could not create LED bar texture');
    this.barTexture = tex;
    this.barPixels = new Uint8Array(BAR_TEX_WIDTH * 4);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ------------------------------------------------------------ scene setup

  /** Rebuild all geometry for a scene. Call after the rig has been patched. */
  loadScene(scene: SceneDef, rig: Rig): void {
    const gl = this.gl;

    const builder = new MeshBuilder();
    scene.buildRoom(builder, rig);
    const mesh = builder.build();

    if (this.sceneVao) gl.deleteVertexArray(this.sceneVao);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('could not create scene VAO');
    this.sceneVao = vao;
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    const stride = VERTEX_FLOATS * 4;
    const attrs: Array<[number, number, number]> = [
      [0, 3, 0],
      [1, 3, 12],
      [2, 2, 24],
      [3, 1, 32],
      [4, 1, 36],
    ];
    for (const [loc, size, offset] of attrs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    }
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.sceneIndexCount = mesh.indices.length;

    this.buildCrowd(scene);

    this.barCount = Math.max(1, rig.bars.length);
    this.barPixels = new Uint8Array(BAR_TEX_WIDTH * this.barCount * 4);
    gl.bindTexture(gl.TEXTURE_2D, this.barTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8, BAR_TEX_WIDTH, this.barCount, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.barPixels,
    );
  }

  /** Crowd positions are seeded per scene so a room looks the same each visit. */
  private buildCrowd(scene: SceneDef): void {
    const gl = this.gl;
    const rng = new Rng(`crowd:${scene.id}`);
    const n = scene.crowdCount;
    const offsets = new Float32Array(n * 3);
    const scaleSeed = new Float32Array(n * 2);

    for (let i = 0; i < n; i++) {
      // Denser toward the front — a real floor packs against the stage.
      const bias = Math.pow(rng.next(), 0.65);
      const z = scene.crowdCenter[2] - scene.crowdSpread.z * 0.55 + bias * scene.crowdSpread.z * 1.6;
      const spreadAtZ = scene.crowdSpread.x * (0.55 + bias * 0.55);
      offsets[i * 3] = (rng.next() * 2 - 1) * spreadAtZ;
      offsets[i * 3 + 1] = 0;
      offsets[i * 3 + 2] = z;
      scaleSeed[i * 2] = 1.55 + rng.next() * 0.35;
      scaleSeed[i * 2 + 1] = rng.next();
    }

    if (this.crowdVao) gl.deleteVertexArray(this.crowdVao);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('could not create crowd VAO');
    this.crowdVao = vao;
    gl.bindVertexArray(vao);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const off = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, off);
    gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    const ss = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ss);
    gl.bufferData(gl.ARRAY_BUFFER, scaleSeed, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
    this.crowdCount = n;
  }

  // ------------------------------------------------------------ resize

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const q = QUALITY_SETTINGS[this.quality];
    const w = Math.max(1, Math.floor(cssW * dpr * q.renderScale));
    const h = Math.max(1, Math.floor(cssH * dpr * q.renderScale));

    this.canvas.width = Math.max(1, Math.floor(cssW * dpr));
    this.canvas.height = Math.max(1, Math.floor(cssH * dpr));

    if (w === this.width && h === this.height && this.sceneFbo) return;
    this.width = w;
    this.height = h;
    this.allocateTargets();
  }

  private allocateTargets(): void {
    const gl = this.gl;
    const q = QUALITY_SETTINGS[this.quality];
    const hdr = this.hdrSupported
      ? {}
      : { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };

    if (this.sceneFbo) deleteFramebuffer(gl, this.sceneFbo);
    if (this.volFbo) deleteFramebuffer(gl, this.volFbo);
    for (const fb of this.bloomChain) deleteFramebuffer(gl, fb);
    this.bloomChain = [];

    this.sceneFbo = createFramebuffer(gl, this.width, this.height, { depth: true, ...hdr });
    this.volFbo = createFramebuffer(gl, this.width * q.volScale, this.height * q.volScale, hdr);

    let w = Math.max(1, Math.floor(this.width / 2));
    let h = Math.max(1, Math.floor(this.height / 2));
    for (let i = 0; i < q.bloomLevels && w > 4 && h > 4; i++) {
      this.bloomChain.push(createFramebuffer(gl, w, h, hdr));
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
    }
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.width = -1; // force reallocation
    this.resize();
  }

  // ------------------------------------------------------------ frame

  render(rig: Rig, scene: SceneDef, state: FrameState): void {
    const gl = this.gl;
    if (!this.sceneFbo || !this.volFbo) this.resize();
    const sceneFbo = this.sceneFbo!;
    const volFbo = this.volFbo!;
    const q = QUALITY_SETTINGS[this.quality];

    this.frame++;
    this.trackPerformance(state.dt);

    const aspect = this.width / Math.max(1, this.height);
    const { viewProj, eye } = this.camera.viewProj(aspect, state.time);
    const invViewProj = invert(viewProj);

    const active = this.packFixtures(rig);
    this.uploadBarTexture(rig);

    // ---- 1. scene geometry
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo.fbo);
    gl.viewport(0, 0, sceneFbo.width, sceneFbo.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    gl.useProgram(this.sceneProgram);
    gl.uniformMatrix4fv(this.sceneU.loc('uViewProj'), false, viewProj);
    gl.uniform3fv(this.sceneU.loc('uEye'), eye);
    gl.uniform1f(this.sceneU.loc('uTime'), state.time);
    gl.uniform1f(this.sceneU.loc('uBeatPhase'), state.beatPhase);
    gl.uniform1f(this.sceneU.loc('uEnergy'), state.energy);
    gl.uniform4f(
      this.sceneU.loc('uSpectrum'),
      state.bands.sub, state.bands.low, state.bands.mid, state.bands.high,
    );
    const wall = rig.wall;
    gl.uniform1i(this.sceneU.loc('uWallMode'), wallModeIndex(wall?.mode ?? 'off'));
    gl.uniform1f(this.sceneU.loc('uWallIntensity'), wall?.intensity ?? 0);
    gl.uniform3fv(this.sceneU.loc('uWallColor'), wall?.color ?? [0, 0, 0]);
    gl.uniform1f(this.sceneU.loc('uBarCount'), this.barCount);
    bindTexture(gl, 0, this.barTexture);
    gl.uniform1i(this.sceneU.loc('uBarTex'), 0);
    this.uploadFixtureUniforms(this.sceneU, active);

    gl.bindVertexArray(this.sceneVao);
    gl.drawElements(gl.TRIANGLES, this.sceneIndexCount, gl.UNSIGNED_INT, 0);

    // ---- 2. crowd
    if (this.crowdCount > 0) {
      gl.useProgram(this.crowdProgram);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniformMatrix4fv(this.crowdU.loc('uViewProj'), false, viewProj);
      gl.uniform3fv(this.crowdU.loc('uEye'), eye);
      gl.uniform1f(this.crowdU.loc('uTime'), state.time);
      gl.uniform1f(this.crowdU.loc('uBeatPhase'), state.beatPhase);
      gl.uniform1f(this.crowdU.loc('uEnergy'), state.energy);
      this.uploadFixtureUniforms(this.crowdU, active);
      gl.bindVertexArray(this.crowdVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.crowdCount);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
    }

    // ---- 3. lasers (additive, depth-tested against the room, no depth write)
    this.buildLaserGeometry(rig, eye);
    if (this.laserVertCount > 0) {
      gl.useProgram(this.laserProgram);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.uniformMatrix4fv(this.laserU.loc('uViewProj'), false, viewProj);
      gl.uniform1f(this.laserU.loc('uTime'), state.time);
      gl.uniform1f(this.laserU.loc('uHaze'), rig.hazeDensity() * this.hazeScale);
      gl.uniform1f(this.laserU.loc('uGain'), this.laserGain);
      gl.bindVertexArray(this.laserVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.laserBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.laserData, 0, this.laserVertCount * LASER_FLOATS_PER_VERT);
      gl.drawArrays(gl.TRIANGLES, 0, this.laserVertCount);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
    }

    // ---- 4. volumetric
    gl.bindFramebuffer(gl.FRAMEBUFFER, volFbo.fbo);
    gl.viewport(0, 0, volFbo.width, volFbo.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.volProgram);
    bindTexture(gl, 0, sceneFbo.depth);
    gl.uniform1i(this.volU.loc('uDepth'), 0);
    gl.uniformMatrix4fv(this.volU.loc('uInvViewProj'), false, invViewProj);
    gl.uniform3fv(this.volU.loc('uEye'), eye);
    gl.uniform1f(this.volU.loc('uTime'), state.time);
    gl.uniform1f(this.volU.loc('uHaze'), rig.hazeDensity() * scene.hazeBase * this.hazeScale);
    gl.uniform1i(this.volU.loc('uSteps'), q.steps);
    gl.uniform1f(this.volU.loc('uFrame'), this.frame % 64);
    gl.uniform1f(this.volU.loc('uMaxDist'), 120);
    gl.uniform1f(this.volU.loc('uScatter'), this.scatter);
    this.uploadFixtureUniforms(this.volU, active);
    gl.bindVertexArray(this.fsTriangle);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- 5. bloom
    this.renderBloom(sceneFbo);

    // ---- 6. composite to the screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.compositeProgram);
    bindTexture(gl, 0, sceneFbo.color);
    gl.uniform1i(this.compositeU.loc('uScene'), 0);
    bindTexture(gl, 1, volFbo.color);
    gl.uniform1i(this.compositeU.loc('uVolumetric'), 1);
    bindTexture(gl, 2, this.bloomChain.length > 0 ? this.bloomChain[0].color : sceneFbo.color);
    gl.uniform1i(this.compositeU.loc('uBloom'), 2);
    gl.uniform1f(this.compositeU.loc('uTime'), state.time);
    gl.uniform1f(this.compositeU.loc('uExposure'), this.exposure);
    gl.uniform1f(this.compositeU.loc('uBloomAmount'), this.bloomChain.length > 0 ? this.bloomAmount : 0);
    gl.uniform1f(this.compositeU.loc('uImpact'), state.impact);
    gl.uniform1f(this.compositeU.loc('uGrain'), 0.035);
    gl.uniform1f(this.compositeU.loc('uVignette'), 0.75);
    gl.uniform1f(this.compositeU.loc('uReduceFlashing'), state.reduceFlashing ? 1 : 0);
    gl.uniform1i(this.compositeU.loc('uDebug'), this.debugView);
    gl.bindVertexArray(this.fsTriangle);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private renderBloom(sceneFbo: Framebuffer): void {
    const gl = this.gl;
    if (this.bloomChain.length === 0) return;

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.fsTriangle);

    // Downsample, thresholding only on the first level.
    gl.useProgram(this.bloomDownProgram);
    let srcTex = sceneFbo.color;
    let srcW = sceneFbo.width;
    let srcH = sceneFbo.height;
    for (let i = 0; i < this.bloomChain.length; i++) {
      const dst = this.bloomChain[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.width, dst.height);
      bindTexture(gl, 0, srcTex);
      gl.uniform1i(this.bloomDownU.loc('uSrc'), 0);
      gl.uniform2f(this.bloomDownU.loc('uTexel'), 1 / srcW, 1 / srcH);
      gl.uniform1f(this.bloomDownU.loc('uThreshold'), i === 0 ? this.bloomThreshold : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      srcTex = dst.color;
      srcW = dst.width;
      srcH = dst.height;
    }

    // Upsample back down the chain, adding as we go.
    gl.useProgram(this.bloomUpProgram);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.bloomChain.length - 1; i > 0; i--) {
      const src = this.bloomChain[i];
      const dst = this.bloomChain[i - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.width, dst.height);
      bindTexture(gl, 0, src.color);
      gl.uniform1i(this.bloomUpU.loc('uSrc'), 0);
      gl.uniform2f(this.bloomUpU.loc('uTexel'), 1 / src.width, 1 / src.height);
      gl.uniform1f(this.bloomUpU.loc('uRadius'), 1.1);
      gl.uniform1f(this.bloomUpU.loc('uAnamorphic'), this.anamorphic);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
  }

  // ------------------------------------------------------------ data upload

  /**
   * Pack only fixtures that are emitting. This is the main lever on volumetric
   * cost: the shader loops `uFixCount` times per step, so a dark rig is nearly
   * free and a full-blast drop is the worst case rather than the constant one.
   */
  private packFixtures(rig: Rig): number {
    let n = 0;
    // Priority order matters only when a rig exceeds the cap, but then it
    // matters a lot: dropping a blinder on a drop is obvious, dropping a wash
    // is not. Washes go last so they are the ones that lose.
    for (const kind of PACK_ORDER) {
      for (const f of rig.fixtures) {
        if (f.kind !== kind) continue;
        if (n >= MAX_FIXTURES) break;
        if (f.out <= 0.004) continue;
        const i = n * 4;
        this.fixPos[i] = f.pos[0];
        this.fixPos[i + 1] = f.pos[1];
        this.fixPos[i + 2] = f.pos[2];
        this.fixPos[i + 3] = f.reach;

        this.fixDir[i] = f.dir[0];
        this.fixDir[i + 1] = f.dir[1];
        this.fixDir[i + 2] = f.dir[2];
        // Outer edge of the cone, with a soft shoulder for washes.
        this.fixDir[i + 3] = Math.cos(Math.min(Math.PI * 0.5, f.cone * 1.35));

        const gain = this.fixtureGain * (f.kind === 'blinder' ? 1.8 : f.kind === 'strobe' ? 1.5 : 1);
        this.fixCol[i] = f.color[0] * f.out * gain;
        this.fixCol[i + 1] = f.color[1] * f.out * gain;
        this.fixCol[i + 2] = f.color[2] * f.out * gain;
        this.fixCol[i + 3] = Math.cos(f.cone * 0.55);
        n++;
      }
    }
    return n;
  }

  private uploadFixtureUniforms(u: UniformCache, count: number): void {
    const gl = this.gl;
    gl.uniform1i(u.loc('uFixCount'), count);
    if (count === 0) return;
    gl.uniform4fv(u.loc('uFixPos'), this.fixPos, 0, count * 4);
    gl.uniform4fv(u.loc('uFixDir'), this.fixDir, 0, count * 4);
    gl.uniform4fv(u.loc('uFixCol'), this.fixCol, 0, count * 4);
  }

  private uploadBarTexture(rig: Rig): void {
    if (rig.bars.length === 0) return;
    const gl = this.gl;
    const px = this.barPixels;
    for (let b = 0; b < rig.bars.length && b < this.barCount; b++) {
      const bar = rig.bars[b];
      const n = bar.pixels.length;
      for (let x = 0; x < BAR_TEX_WIDTH; x++) {
        const src = bar.pixels[Math.min(n - 1, Math.floor((x / BAR_TEX_WIDTH) * n))];
        const o = (b * BAR_TEX_WIDTH + x) * 4;
        px[o] = Math.min(255, src[0] * 255);
        px[o + 1] = Math.min(255, src[1] * 255);
        px[o + 2] = Math.min(255, src[2] * 255);
        px[o + 3] = 255;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.barTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BAR_TEX_WIDTH, this.barCount, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }

  /** Rebuild every laser beam as a camera-facing quad. */
  private buildLaserGeometry(rig: Rig, eye: Vec3): void {
    const data = this.laserData;
    let v = 0;
    let beams = 0;

    for (const l of rig.lasers) {
      if (l.intensity <= 0.01) continue;
      const count = Math.max(1, Math.min(32, Math.floor(l.count)));
      for (let i = 0; i < count && beams < MAX_LASER_BEAMS; i++, beams++) {
        const dir = laserBeamDirection(l, i, count);
        const a: Vec3 = l.pos;
        const b: Vec3 = [
          l.pos[0] + dir[0] * l.reach,
          l.pos[1] + dir[1] * l.reach,
          l.pos[2] + dir[2] * l.reach,
        ];

        // Widen with distance so the far end does not vanish to sub-pixel.
        const rNear = 0.035;
        const rFar = 0.14;
        const sideA = billboardSide(a, dir, eye, rNear);
        const sideB = billboardSide(b, dir, eye, rFar);

        const push = (p: Vec3, off: Vec3, sign: number, t: number): void => {
          data[v++] = p[0] + off[0] * sign;
          data[v++] = p[1] + off[1] * sign;
          data[v++] = p[2] + off[2] * sign;
          data[v++] = sign;
          data[v++] = t;
          data[v++] = l.color[0];
          data[v++] = l.color[1];
          data[v++] = l.color[2];
          data[v++] = l.intensity;
        };

        push(a, sideA, -1, 0);
        push(a, sideA, 1, 0);
        push(b, sideB, 1, 1);
        push(a, sideA, -1, 0);
        push(b, sideB, 1, 1);
        push(b, sideB, -1, 1);
      }
    }
    this.laserVertCount = v / LASER_FLOATS_PER_VERT;
  }

  // ------------------------------------------------------------ adaptive

  private trackPerformance(dt: number): void {
    if (dt <= 0 || dt > 0.5) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    this.sinceQualityChange += dt;

    if (!this.adaptive || this.frameTimes.length < 90 || this.sinceQualityChange < 3) return;

    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const idx = QUALITIES.indexOf(this.quality);

    // Step down well before frames are visibly dropping; step up only when
    // there is real headroom, so we do not oscillate across the threshold.
    if (median > 0.021 && idx > 0) {
      this.setQuality(QUALITIES[idx - 1]);
      this.sinceQualityChange = 0;
      this.frameTimes = [];
    } else if (median < 0.011 && idx < QUALITIES.length - 1) {
      this.setQuality(QUALITIES[idx + 1]);
      this.sinceQualityChange = 0;
      this.frameTimes = [];
    }
  }

  /** Median frame time in milliseconds, for the readout. */
  frameMs(): number {
    if (this.frameTimes.length === 0) return 0;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] * 1000;
  }
}

/**
 * Direction of beam `i` of `count` for a laser, from its effect type.
 *
 * The named effects here are the standard club/ILDA vocabulary — fan, tunnel,
 * cone, sheet ("liquid sky"), scan, grid — because those are what a real
 * projector's built-in patterns are called and what an operator asks for.
 */
export function laserBeamDirection(l: Laser, i: number, count: number): Vec3 {
  const forward = aimDirection(l.pan, l.tilt);
  // Any non-parallel reference works; guard the degenerate straight-up case.
  const ref: Vec3 = Math.abs(forward[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
  const right = normalize(cross(forward, ref));
  const up = normalize(cross(right, forward));

  const t = count > 1 ? (i / (count - 1)) * 2 - 1 : 0;

  switch (l.effect) {
    case 'fan': {
      const a = t * l.spread;
      return normalize(axisRotate(forward, right, a));
    }
    case 'sheet': {
      // Flat horizontal sheet with a slow ripple across it.
      const a = t * l.spread;
      const ripple = Math.sin(l.spin * 2 + t * 4) * 0.03;
      return normalize(axisRotate(axisRotate(forward, right, a), up, ripple));
    }
    case 'cone': {
      const a = (i / count) * Math.PI * 2 + l.spin;
      return normalize([
        forward[0] * Math.cos(l.spread) + (right[0] * Math.cos(a) + up[0] * Math.sin(a)) * Math.sin(l.spread),
        forward[1] * Math.cos(l.spread) + (right[1] * Math.cos(a) + up[1] * Math.sin(a)) * Math.sin(l.spread),
        forward[2] * Math.cos(l.spread) + (right[2] * Math.cos(a) + up[2] * Math.sin(a)) * Math.sin(l.spread),
      ]);
    }
    case 'tunnel': {
      // A cone whose half-angle breathes while it spins — reads as depth.
      const a = (i / count) * Math.PI * 2 + l.spin;
      const s = l.spread * (0.7 + 0.3 * Math.sin(l.spin * 0.7));
      return normalize([
        forward[0] * Math.cos(s) + (right[0] * Math.cos(a) + up[0] * Math.sin(a)) * Math.sin(s),
        forward[1] * Math.cos(s) + (right[1] * Math.cos(a) + up[1] * Math.sin(a)) * Math.sin(s),
        forward[2] * Math.cos(s) + (right[2] * Math.cos(a) + up[2] * Math.sin(a)) * Math.sin(s),
      ]);
    }
    case 'scan': {
      const a = Math.sin(l.spin + i * 1.3) * l.spread * 4;
      const b = Math.cos(l.spin * 0.7 + i * 2.1) * l.spread * 2;
      return normalize(axisRotate(axisRotate(forward, right, a), up, b));
    }
    case 'grid': {
      // Half the beams horizontal, half vertical — a crossing lattice.
      const half = Math.floor(count / 2);
      if (i < half) {
        const u = half > 1 ? (i / (half - 1)) * 2 - 1 : 0;
        return normalize(axisRotate(forward, right, u * l.spread));
      }
      const j = i - half;
      const n = count - half;
      const u = n > 1 ? (j / (n - 1)) * 2 - 1 : 0;
      return normalize(axisRotate(forward, up, u * l.spread));
    }
    default:
      return forward;
  }
}

/** Rotate `v` about `axis` by `angle` (Rodrigues). */
function axisRotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, v);
  const d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  return [
    v[0] * c + k[0] * s + axis[0] * d * (1 - c),
    v[1] * c + k[1] * s + axis[1] * d * (1 - c),
    v[2] * c + k[2] * s + axis[2] * d * (1 - c),
  ];
}

/** Offset perpendicular to the beam and to the view direction. */
function billboardSide(point: Vec3, axis: Vec3, eye: Vec3, radius: number): Vec3 {
  const toEye = normalize(sub(eye, point));
  let side = cross(axis, toEye);
  const len = Math.hypot(side[0], side[1], side[2]);
  if (len < 1e-5) {
    // Looking straight down the beam: any perpendicular will do.
    side = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : cross(axis, [0, 1, 0]);
  }
  const n = normalize(side);
  return [n[0] * radius, n[1] * radius, n[2] * radius];
}

function wallModeIndex(mode: string): number {
  switch (mode) {
    case 'spectrum': return 1;
    case 'pulse': return 2;
    case 'tunnel': return 3;
    case 'strobe': return 4;
    case 'logo': return 5;
    case 'noise': return 6;
    default: return 0;
  }
}
