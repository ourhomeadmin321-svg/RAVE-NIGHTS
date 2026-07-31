/** Thin WebGL2 helpers. No abstraction beyond what removes real repetition. */

export type GL = WebGL2RenderingContext;

export function compileShader(gl: GL, type: number, source: string, label: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error(`could not create shader (${label})`);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? 'unknown error';
    gl.deleteShader(sh);
    throw new Error(`${label} failed to compile:\n${log}\n${numbered(source)}`);
  }
  return sh;
}

export function createProgram(gl: GL, vsSrc: string, fsSrc: string, label: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc, `${label}.vert`);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, `${label}.frag`);
  const prog = gl.createProgram();
  if (!prog) throw new Error(`could not create program (${label})`);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? 'unknown error';
    gl.deleteProgram(prog);
    throw new Error(`${label} failed to link:\n${log}`);
  }
  return prog;
}

function numbered(src: string): string {
  return src
    .split('\n')
    .map((l, i) => `${String(i + 1).padStart(4)} | ${l}`)
    .join('\n');
}

/**
 * Resolve `#include "name"` against a chunk map. Vite's `?raw` gives plain
 * strings with no preprocessor, and duplicating the noise and phase functions
 * into four shaders would guarantee they drift apart.
 */
export function resolveIncludes(src: string, chunks: Record<string, string>, depth = 0): string {
  if (depth > 8) throw new Error('shader #include nested too deeply');
  return src.replace(/^[ \t]*#include\s+"([^"]+)"[ \t]*$/gm, (_m, name: string) => {
    const chunk = chunks[name];
    if (chunk === undefined) throw new Error(`unknown shader include: "${name}"`);
    return resolveIncludes(chunk, chunks, depth + 1);
  });
}

export class UniformCache {
  private map = new Map<string, WebGLUniformLocation | null>();
  constructor(
    private gl: GL,
    private program: WebGLProgram,
  ) {}

  loc(name: string): WebGLUniformLocation | null {
    let l = this.map.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name);
      this.map.set(name, l);
    }
    return l;
  }
}

export interface Framebuffer {
  fbo: WebGLFramebuffer;
  color: WebGLTexture;
  depth: WebGLTexture | null;
  width: number;
  height: number;
}

export interface FboOptions {
  depth?: boolean;
  /** Defaults to RGBA16F, which the HDR passes need. */
  internalFormat?: number;
  format?: number;
  type?: number;
  filter?: number;
}

export function createFramebuffer(gl: GL, width: number, height: number, opts: FboOptions = {}): Framebuffer {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const internalFormat = opts.internalFormat ?? gl.RGBA16F;
  const format = opts.format ?? gl.RGBA;
  const type = opts.type ?? gl.HALF_FLOAT;
  const filter = opts.filter ?? gl.LINEAR;

  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('could not create framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

  const color = gl.createTexture();
  if (!color) throw new Error('could not create colour texture');
  gl.bindTexture(gl.TEXTURE_2D, color);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);

  let depth: WebGLTexture | null = null;
  if (opts.depth) {
    depth = gl.createTexture();
    if (!depth) throw new Error('could not create depth texture');
    gl.bindTexture(gl.TEXTURE_2D, depth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  }

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, color, depth, width: w, height: h };
}

export function deleteFramebuffer(gl: GL, fb: Framebuffer): void {
  gl.deleteFramebuffer(fb.fbo);
  gl.deleteTexture(fb.color);
  if (fb.depth) gl.deleteTexture(fb.depth);
}

/** A single triangle covering the viewport — cheaper than a quad, no seam. */
export function createFullscreenTriangle(gl: GL): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('could not create VAO');
  const buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

export function bindTexture(gl: GL, unit: number, texture: WebGLTexture | null): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
}
