#version 300 es
precision highp float;

#include "common"

in vec2 vUv;

uniform sampler2D uScene;
uniform sampler2D uVolumetric;
uniform sampler2D uFeedback;

uniform float uTime;
uniform float uAspect;
uniform float uWarp;
uniform float uKaleido;
uniform float uSegments;
uniform float uFeedbackAmt;
uniform float uEnergy;
uniform float uBeatPhase;

out vec4 fragColor;

/**
 * Mirror-repeat a UV instead of clamping it.
 *
 * Warping and folding both push samples outside 0..1. Clamping smears the edge
 * pixel into a streak across the border; mirroring tiles the image back on
 * itself, which is both seamless and exactly the symmetry the kaleidoscope is
 * already producing.
 */
vec2 mirrorUv(vec2 uv) {
  return abs(fract(uv * 0.5) * 2.0 - 1.0);
}

void main() {
  // Work in centred, aspect-corrected space so the fold is circular rather
  // than an ellipse stretched to the viewport.
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);

  p = domainWarp(p, uTime, uWarp * 0.22);

  if (uKaleido > 0.001) {
    vec2 k = kaleidoscope(p, uSegments);
    k = rot2(uTime * 0.06) * k;
    p = mix(p, k, uKaleido);
  }

  vec2 suv = mirrorUv(p / vec2(uAspect, 1.0) + 0.5);

  vec3 col = texture(uScene, suv).rgb + texture(uVolumetric, suv).rgb;

  // Feedback: resample the previous output slightly rotated and zoomed about
  // the centre. Iterating that transform every frame is what generates true
  // infinite recursion — each frame contains a smaller, turned copy of the one
  // before it, all the way back.
  if (uFeedbackAmt > 0.001) {
    float zoom = 1.0 - 0.012 - 0.01 * uEnergy;
    vec2 fp = (vUv - 0.5) * vec2(uAspect, 1.0);
    fp = rot2(0.004 + 0.01 * uEnergy) * fp * zoom;
    vec2 fuv = mirrorUv(fp / vec2(uAspect, 1.0) + 0.5);
    vec3 fb = texture(uFeedback, fuv).rgb;
    // Tint the trail as it recirculates so long tails drift through hue
    // instead of just fading grey.
    fb *= mix(vec3(1.0), tripPalette(uTime * 0.05 + 0.3) * 1.6, 0.45);
    // Strictly below 1 so the loop is a decaying series and cannot run away.
    col += fb * uFeedbackAmt * 0.88;
  }

  // Plasma bed: an oil-on-water field mixed in under everything, strongest
  // where the warp is strongest.
  if (uWarp > 0.001) {
    float pl = fbm(vec3(p * 1.7, uTime * 0.22));
    col += tripPalette(pl * 1.8 + uTime * 0.09) * pl * uWarp * 0.1;
  }

  fragColor = vec4(col, 1.0);
}
