#version 300 es
precision highp float;

#include "common"

in vec2 vUv;

uniform sampler2D uScene;
uniform sampler2D uVolumetric;
uniform sampler2D uBloom;
uniform float uTime;
uniform float uExposure;
uniform float uBloomAmount;
/** 0..1, spikes on drops. Drives aberration and the punch-in. */
uniform float uImpact;
uniform float uGrain;
uniform float uVignette;
/** When on, contrast and flash amplitude are pulled in for safety. */
uniform float uReduceFlashing;
/** 0 normal, 1 scene only, 2 volumetric only, 3 bloom only. */
uniform int uDebug;

out vec4 fragColor;

void main() {
  // Punch in slightly on impacts — a zoom the eye reads as loudness.
  float zoom = 1.0 - uImpact * 0.012 * (1.0 - uReduceFlashing);
  vec2 uv = (vUv - 0.5) * zoom + 0.5;

  // Chromatic aberration, strongest at the edges and only during impacts.
  float ca = uImpact * 0.004 * (1.0 - uReduceFlashing);
  vec2 dir = uv - 0.5;
  vec3 scene;
  if (ca > 0.0001) {
    scene.r = texture(uScene, uv + dir * ca).r;
    scene.g = texture(uScene, uv).g;
    scene.b = texture(uScene, uv - dir * ca).b;
  } else {
    scene = texture(uScene, uv).rgb;
  }

  vec3 vol = texture(uVolumetric, uv).rgb;
  vec3 bloom = texture(uBloom, uv).rgb;

  vec3 col = scene + vol + bloom * uBloomAmount;
  if (uDebug == 1) col = scene;
  else if (uDebug == 2) col = vol;
  else if (uDebug == 3) col = bloom;
  col *= uExposure;

  col = acesTonemap(col);

  // Vignette.
  float r = length((vUv - 0.5) * vec2(1.0, 0.85));
  col *= mix(1.0, smoothstep(0.95, 0.28, r), uVignette);

  // Film grain, scaled down in the highlights so beams stay clean.
  float n = hash12(gl_FragCoord.xy + fract(uTime) * 731.0) - 0.5;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += n * uGrain * (1.0 - lum * 0.7);

  // Reduce-flashing mode: lift the floor and compress the top so hard cuts
  // between black and full white become a much smaller swing.
  col = mix(col, col * 0.72 + 0.055, uReduceFlashing);

  fragColor = vec4(linearToSrgb(max(col, 0.0)), 1.0);
}
