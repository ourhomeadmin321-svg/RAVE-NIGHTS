#version 300 es
precision highp float;
precision highp sampler2D;

#include "common"

in vec2 vUv;

uniform sampler2D uScene;
uniform sampler2D uVolumetric;
uniform sampler2D uDepth;

uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform vec3 uEye;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
/** Distance the lens is focused at, in metres. */
uniform float uFocus;
/** Maximum circle of confusion, in UV units. 0 disables defocus. */
uniform float uBokeh;
/** Camera motion blur strength, 0 disables. */
uniform float uShutter;
uniform int uTaps;

out vec4 fragColor;

const float GOLDEN_ANGLE = 2.39996323;

float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

vec3 sourceAt(vec2 uv) {
  return texture(uScene, uv).rgb + texture(uVolumetric, uv).rgb;
}

/**
 * Lens simulation: defocus and shutter, in one pass.
 *
 * Both are camera properties, so they belong here — on the clean image, before
 * the psychedelic layer. Defocusing *after* the kaleidoscope would blur the
 * mirrored copies rather than the room, which is not what a lens does; the
 * camera sees the room, and everything downstream happens to what it saw.
 *
 * Bokeh samples on a golden-angle spiral rather than a grid. The spiral has no
 * preferred axis, so out-of-focus highlights come out round instead of
 * developing the faint cross pattern a square tap layout leaves behind.
 */
void main() {
  float rawDepth = texture(uDepth, vUv).r;
  float dist = rawDepth >= 1.0 ? uFar : linearDepth(rawDepth);

  // Circle of confusion. Scaled relative to the focus distance so the falloff
  // stays natural whether the camera is across the room or up against the rig.
  float coc = clamp(abs(dist - uFocus) / max(uFocus * 0.75, 2.5), 0.0, 1.0);
  // Background defocuses harder than foreground, as a real lens does.
  coc *= dist > uFocus ? 1.0 : 0.65;
  float radius = coc * uBokeh;

  // Reproject through last frame's matrix to recover screen-space velocity.
  vec2 velocity = vec2(0.0);
  if (uShutter > 0.0) {
    vec4 world = uInvViewProj * vec4(vUv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
    world /= world.w;
    vec4 prev = uPrevViewProj * vec4(world.xyz, 1.0);
    if (prev.w > 0.0001) {
      vec2 prevUv = (prev.xy / prev.w) * 0.5 + 0.5;
      velocity = (vUv - prevUv) * uShutter;
      // Cap the streak. An unclamped velocity smears the whole frame on a hard
      // camera cut, which reads as a bug rather than as motion.
      float len = length(velocity);
      if (len > 0.045) velocity *= 0.045 / len;
    }
  }

  vec3 sum = sourceAt(vUv);
  float weight = 1.0;

  if (radius > 0.0005 || length(velocity) > 0.0005) {
    // Dither the starting angle so the tap pattern does not align between
    // neighbouring pixels and print a visible rosette.
    float jitter = hash12(gl_FragCoord.xy) * 6.28318;

    for (int i = 1; i < 48; i++) {
      if (i >= uTaps) break;
      float t = float(i) / float(uTaps);

      // sqrt spacing keeps the samples uniform by area, not by radius —
      // otherwise the centre is oversampled and the bokeh looks dense in the
      // middle and thin at the edge.
      float r = sqrt(t);
      float a = float(i) * GOLDEN_ANGLE + jitter;
      vec2 offset = vec2(cos(a), sin(a)) * r * radius;

      // March along the velocity vector at the same time, which folds motion
      // blur into the same taps instead of paying for a second pass.
      offset += velocity * (t - 0.5);

      vec2 uv = clamp(vUv + offset * uTexel * 300.0, vec2(0.0), vec2(1.0));

      // Reject samples much closer to the camera than this pixel, so a sharp
      // foreground cannot bleed outward over a defocused background.
      float sd = texture(uDepth, uv).r;
      float sDist = sd >= 1.0 ? uFar : linearDepth(sd);
      float accept = sDist > dist - 1.5 ? 1.0 : 0.15;

      sum += sourceAt(uv) * accept;
      weight += accept;
    }
  }

  fragColor = vec4(sum / weight, 1.0);
}
