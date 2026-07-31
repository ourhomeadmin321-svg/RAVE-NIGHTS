#version 300 es
precision highp float;
precision highp sampler2D;

#include "common"
#include "fixtures"

in vec2 vUv;

uniform sampler2D uDepth;
uniform mat4 uInvViewProj;
uniform vec3 uEye;
uniform float uTime;
uniform float uHaze;
uniform int uSteps;
uniform float uFrame;
uniform float uMaxDist;
uniform float uScatter;

out vec4 fragColor;

/**
 * Single-scattering raymarch through the haze.
 *
 * Cost is steps × active fixtures per pixel, so two things keep it affordable:
 * the pass runs at half resolution, and the CPU uploads only fixtures that are
 * actually emitting. A dark rig costs almost nothing.
 *
 * The step offset is dithered per pixel and per frame. Without it, a low step
 * count produces obvious concentric banding in the cones; with it, the banding
 * becomes noise that the half-res upsample and bloom smear away.
 */
void main() {
  // Rebuild the world-space ray for this pixel.
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 farPoint = uInvViewProj * vec4(ndc, 1.0, 1.0);
  farPoint /= farPoint.w;
  vec3 rd = normalize(farPoint.xyz - uEye);

  // Where the ray hits geometry — the march must stop there or beams will
  // glow through the back wall.
  float depth = texture(uDepth, vUv).r;
  float sceneDist = uMaxDist;
  if (depth < 1.0) {
    vec4 world = uInvViewProj * vec4(ndc, depth * 2.0 - 1.0, 1.0);
    world /= world.w;
    sceneDist = min(length(world.xyz - uEye), uMaxDist);
  }

  int steps = uSteps;
  float stepLen = sceneDist / float(steps);
  float jitter = hash12(gl_FragCoord.xy + uFrame * 17.31);

  vec3 acc = vec3(0.0);
  float transmittance = 1.0;

  for (int s = 0; s < 96; s++) {
    if (s >= steps) break;
    float t = (float(s) + jitter) * stepLen;
    vec3 p = uEye + rd * t;

    // Nothing below the floor or above the ceiling holds haze.
    if (p.y < -0.2 || p.y > 12.0) continue;

    float dens = hazeDensity(p, uTime, uHaze);
    if (dens <= 0.001) continue;

    vec3 inscatter = vec3(0.0);
    for (int i = 0; i < MAX_FIXTURES; i++) {
      if (i >= uFixCount) break;
      vec3 toLight;
      float dist;
      float spot = fixtureSpot(i, p, toLight, dist);
      if (spot <= 0.0) continue;
      float phase = hg(dot(-rd, toLight), 0.55);
      inscatter += uFixCol[i].rgb * spot * phase * fixtureRadiance(i);
    }

    float sigma = dens * 0.055;
    acc += inscatter * dens * stepLen * transmittance * uScatter;
    transmittance *= exp(-sigma * stepLen);
    if (transmittance < 0.02) break;
  }

  fragColor = vec4(acc, 1.0 - transmittance);
}
