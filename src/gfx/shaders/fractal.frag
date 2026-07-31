#version 300 es
precision highp float;

#include "common"

in vec2 vUv;

uniform mat4 uInvViewProj;
uniform vec3 uEye;
uniform float uTime;
uniform float uBeatPhase;
uniform float uEnergy;
uniform float uTrip;
uniform int uSteps;
uniform vec3 uTint;
uniform float uAspect;

out vec4 fragColor;

/**
 * Kaleidoscopic Iterated Function System.
 *
 * Each iteration folds space across three planes (the `abs` and the sorting
 * swaps), scales it up, and rotates. Repeating that produces a genuinely
 * self-similar solid: corridors inside corridors, all the way down, at real
 * depth rather than as a painted-on pattern.
 *
 * `trap` records how close the orbit came to the origin, which is what colours
 * the surface — orbit trapping gives structure that follows the fractal instead
 * of a gradient smeared over it.
 */
float kifs(vec3 p, float spin, out float trap) {
  const float scale = 1.92;
  vec3 offset = vec3(1.0, 1.06, 0.86);
  trap = 1e9;

  mat2 ra = rot2(spin);
  mat2 rb = rot2(spin * 0.63 + 0.4);

  for (int i = 0; i < 9; i++) {
    p = abs(p);
    // Sort components — the fold that makes it kaleidoscopic rather than a
    // plain Sierpinski stack.
    if (p.x < p.y) p.xy = p.yx;
    if (p.x < p.z) p.xz = p.zx;
    if (p.y < p.z) p.yz = p.zy;

    p.xy = ra * p.xy;
    p = p * scale - offset * (scale - 1.0);
    p.yz = rb * p.yz;

    trap = min(trap, dot(p, p));
  }
  trap = sqrt(trap);
  return (length(p) - 1.1) * pow(scale, -9.0);
}

float map(vec3 p, float spin, out float trap) {
  // Drift the whole field forward so it reads as flying through, not past.
  p.z += uTime * 0.55;
  // Gentle breathing on the beat.
  p *= 1.0 + 0.06 * (1.0 - uBeatPhase) * uEnergy;
  return kifs(p, spin, trap);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 far = uInvViewProj * vec4(ndc, 1.0, 1.0);
  far /= far.w;
  vec3 rd = normalize(far.xyz - uEye);

  // The fractal lives beyond the room, so start the march past the far wall.
  // Marching from the eye would spend most of its steps inside the club.
  float t = 22.0;
  float spin = uTime * 0.12 + uEnergy * 0.5;

  float trap = 0.0;
  float hitTrap = 0.0;
  float glow = 0.0;
  bool hit = false;

  for (int i = 0; i < 96; i++) {
    if (i >= uSteps) break;
    vec3 p = uEye + rd * t;
    float d = map(p, spin, trap);

    // Proximity glow: accumulating near-misses lights up the whole lattice
    // rather than only the surfaces the ray happens to land on.
    glow += 0.016 / (0.05 + abs(d) * 26.0);

    if (d < 0.0016 * t) {
      hit = true;
      hitTrap = trap;
      break;
    }
    t += max(d, 0.004) * 0.85;
    if (t > 120.0) break;
  }

  vec3 col = vec3(0.0);

  if (hit) {
    float shade = 1.0 - clamp((t - 22.0) / 70.0, 0.0, 1.0);
    col = tripPalette(hitTrap * 1.6 + uTime * 0.05) * (0.25 + shade * 1.5);
  }

  col += tripPalette(glow * 0.7 + uTime * 0.08 + 0.5) * glow * 0.55;

  // Bias toward the genre's own palette so the fractal belongs to this room
  // rather than looking like a screensaver dropped in behind it.
  col = mix(col, col * uTint * 1.8, 0.45);

  // Radial falloff keeps the edges of frame from competing with the rig.
  vec2 c = (vUv - 0.5) * vec2(uAspect, 1.0);
  col *= mix(1.0, smoothstep(0.95, 0.15, length(c)), 0.55);

  fragColor = vec4(col * uTrip, 1.0);
}
