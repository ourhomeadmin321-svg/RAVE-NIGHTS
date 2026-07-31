#version 300 es
precision highp float;

#include "common"
#include "fixtures"

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
flat in int vMat;
flat in float vAux;

uniform vec3 uEye;
uniform float uTime;
uniform float uBeatPhase;
uniform vec4 uSpectrum;   // sub, low, mid, high
uniform vec3 uWallColor;
uniform float uWallIntensity;
uniform int uWallMode;    // 0 off, 1 spectrum, 2 pulse, 3 tunnel, 4 strobe, 5 logo, 6 noise
uniform sampler2D uBarTex;
uniform float uBarCount;
uniform float uEnergy;

out vec4 fragColor;

// Material ids, matching src/gfx/mesh.ts.
const int MAT_FLOOR = 0;
const int MAT_WALL = 1;
const int MAT_TRUSS = 2;
const int MAT_BOOTH = 3;
const int MAT_LEDWALL = 4;
const int MAT_LEDBAR = 5;
const int MAT_FIXTURE = 6;

/** Procedural LED wall content. `uv` is 0..1 across the panel. */
vec3 wallContent(vec2 uv) {
  if (uWallMode == 0) return vec3(0.0);

  // Quantise to a pixel pitch so it reads as a real LED panel, not a gradient.
  vec2 grid = vec2(96.0, 54.0);
  vec2 cell = floor(uv * grid) / grid;
  vec2 inCell = fract(uv * grid);
  float mask = smoothstep(0.0, 0.12, inCell.x) * smoothstep(1.0, 0.88, inCell.x)
             * smoothstep(0.0, 0.12, inCell.y) * smoothstep(1.0, 0.88, inCell.y);

  vec3 c = vec3(0.0);

  if (uWallMode == 1) {
    // Spectrum bars.
    float band = cell.x * 4.0;
    float level = band < 1.0 ? uSpectrum.x : band < 2.0 ? uSpectrum.y : band < 3.0 ? uSpectrum.z : uSpectrum.w;
    level = clamp(level * 1.25, 0.0, 1.0);
    float lit = step(cell.y, level);
    c = mix(uWallColor, vec3(1.0), cell.y * 0.6) * lit;
  } else if (uWallMode == 2) {
    // Concentric pulse rings expanding on the beat.
    float r = length((cell - 0.5) * vec2(1.8, 1.0));
    float rings = fract(r * 5.0 - uTime * 1.2);
    c = uWallColor * smoothstep(0.55, 1.0, rings) * (0.35 + 0.65 * (1.0 - uBeatPhase));
  } else if (uWallMode == 3) {
    // Perspective tunnel.
    vec2 p = (cell - 0.5) * vec2(1.8, 1.0);
    float a = atan(p.y, p.x);
    float r = max(length(p), 0.02);
    float z = 1.0 / r + uTime * 1.6;
    float stripes = step(0.5, fract(z * 0.5)) * step(0.5, fract(a * 3.0 / PI + uTime * 0.2));
    c = mix(uWallColor, vec3(1.0), stripes) * stripes * (0.4 + r);
  } else if (uWallMode == 4) {
    // Full-panel strobe.
    float on = step(0.5, fract(uTime * 8.0));
    c = vec3(on) * 0.8;
  } else if (uWallMode == 5) {
    // Idle: slow scanning bands.
    float band = smoothstep(0.45, 0.5, fract(cell.y * 3.0 - uTime * 0.15));
    c = uWallColor * band * 0.5;
    c += uWallColor * smoothstep(0.98, 1.0, fract(cell.x * 2.0 - uTime * 0.05)) * 0.8;
  } else {
    // Noise wash for breakdowns.
    float n = valueNoise(vec3(cell * 12.0, uTime * 0.4));
    c = uWallColor * smoothstep(0.4, 0.85, n);
  }

  return c * mask * uWallIntensity * 1.25;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uEye - vWorld);

  // Emissive materials skip the lighting loop entirely.
  if (vMat == MAT_LEDWALL) {
    fragColor = vec4(wallContent(vUv), 1.0);
    return;
  }
  if (vMat == MAT_LEDBAR) {
    float row = (vAux + 0.5) / max(uBarCount, 1.0);
    vec3 px = texture(uBarTex, vec2(vUv.x, row)).rgb;
    // Slight bloom-friendly overdrive plus a dark gap between pixels.
    float pitch = smoothstep(0.0, 0.15, fract(vUv.x * 32.0)) * smoothstep(1.0, 0.85, fract(vUv.x * 32.0));
    fragColor = vec4(px * 1.8 * mix(0.35, 1.0, pitch), 1.0);
    return;
  }

  vec3 albedo;
  float rough;
  if (vMat == MAT_FLOOR) {
    // Reflective black floor with a faint tile grid.
    vec2 g = abs(fract(vWorld.xz * 0.5) - 0.5);
    float line = smoothstep(0.48, 0.5, max(g.x, g.y));
    albedo = mix(vec3(0.018, 0.019, 0.024), vec3(0.05), line);
    rough = 0.12;
  } else if (vMat == MAT_WALL) {
    float n = valueNoise(vWorld * 1.6);
    albedo = vec3(0.028, 0.028, 0.034) * (0.7 + n * 0.6);
    rough = 0.8;
  } else if (vMat == MAT_TRUSS) {
    albedo = vec3(0.09, 0.095, 0.105);
    rough = 0.35;
  } else if (vMat == MAT_BOOTH) {
    albedo = vec3(0.035, 0.035, 0.042);
    rough = 0.5;
  } else {
    albedo = vec3(0.05, 0.05, 0.055);
    rough = 0.45;
  }

  // A near-black ambient so unlit geometry still has silhouette.
  vec3 col = albedo * 0.06;

  for (int i = 0; i < MAX_FIXTURES; i++) {
    if (i >= uFixCount) break;
    vec3 toLight;
    float dist;
    float spot = fixtureSpot(i, vWorld, toLight, dist);
    if (spot <= 0.0) continue;

    vec3 L = -toLight;
    float ndl = max(dot(N, L), 0.0);
    vec3 lightCol = uFixCol[i].rgb;

    col += albedo * lightCol * ndl * spot * 2.6;

    // Specular glint — this is what sells a wet-looking club floor.
    vec3 H = normalize(L + V);
    float shine = pow(max(dot(N, H), 0.0), mix(220.0, 12.0, rough));
    col += lightCol * shine * spot * (1.0 - rough) * 2.2;
  }

  if (vMat == MAT_FIXTURE) {
    // Housings pick up a little of their own output as spill.
    col += albedo * uEnergy * 0.15;
  }

  fragColor = vec4(col, 1.0);
}
