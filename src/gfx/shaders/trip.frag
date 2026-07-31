#version 300 es
precision highp float;

#include "common"

in vec2 vUv;

uniform sampler2D uSource;
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

  // Two samples: the straight frame and the warped, folded one.
  vec3 clean = texture(uSource, vUv).rgb;
  vec3 folded = texture(uSource, suv).rgb;

  // The fold never fully replaces the straight image. Letting it reach 100%
  // dissolves the room into abstract symmetry — legible for about two seconds,
  // then just soup, and it throws away everything the lighting rig is doing.
  // Holding a third of the un-mirrored frame keeps the beams, the crowd and the
  // architecture readable underneath, which is what makes the effect land as
  // "this room is melting" rather than "the picture broke".
  float replace = clamp(uKaleido * 0.62 + uWarp * 0.18, 0.0, 0.72);
  vec3 col = mix(clean, folded, replace);

  // Feedback: resample the previous output slightly rotated and zoomed about
  // the centre. Iterating that transform every frame is what generates true
  // infinite recursion — each frame contains a smaller, turned copy of the one
  // before it, all the way back.
  if (uFeedbackAmt > 0.001) {
    float zoom = 1.0 - 0.012 - 0.01 * uEnergy;
    vec2 fp = (vUv - 0.5) * vec2(uAspect, 1.0);
    fp = rot2(0.004 + 0.01 * uEnergy) * fp * zoom;
    vec2 fuv = mirrorUv(fp / vec2(uAspect, 1.0) + 0.5);
    vec3 fb = texture(uFeedback, fuv).rgb * uFeedbackAmt;
    // Tint the trail as it recirculates so long tails drift through hue
    // instead of just fading grey.
    fb *= mix(vec3(1.0), tripPalette(uTime * 0.05 + 0.3) * 1.6, 0.45);

    // Plain addition, with the gain capped in trip.ts so the series converges.
    //
    // Deliberately *not* a screen blend: screen adds most where the frame is
    // dark, and in a night scene that is nearly everywhere, so it lifts the
    // blacks into grey milk. Straight addition keeps trails where light
    // actually was — behind the beams and lasers — and leaves the room's
    // shadows at zero, which is the single thing that makes a dark scene read
    // as dark rather than as underexposed fog.
    col += fb;
  }

  // Plasma: an oil-on-water field that tints the light already in frame rather
  // than painting over the whole image. Gating it on luminance is what stops it
  // becoming a flat colour wash across the empty half of a dark room.
  if (uWarp > 0.001) {
    float pl = fbm(vec3(p * 1.7, uTime * 0.22));
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 plasma = tripPalette(pl * 1.8 + uTime * 0.09) * pl * uWarp * 0.5;
    col += plasma * smoothstep(0.015, 0.35, lum);
  }

  fragColor = vec4(col, 1.0);
}
