#version 300 es
precision highp float;

#include "common"

in vec3 vWorld;
in float vSide;
in float vT;
in vec3 vColor;
in float vIntensity;

uniform float uTime;
uniform float uHaze;
uniform float uGain;

out vec4 fragColor;

/**
 * Laser beams are drawn as camera-facing quads rather than raymarched.
 *
 * A real laser beam is close to zero-radius; a 32-step march through the room
 * would step straight past it and it would flicker in and out as the camera
 * moved. Billboarded geometry gives an exact, stable beam — and sampling the
 * *same* `hazeDensity` the volumetric pass uses keeps it physically consistent
 * with the moving-head cones around it, so a laser dims through thin air and
 * blazes through a hazer burst.
 */
void main() {
  // Gaussian across the width: a hard core with a soft halo.
  float core = exp(-vSide * vSide * 9.0);
  float halo = exp(-vSide * vSide * 1.6) * 0.22;

  // Beams lose energy with distance from the projector.
  float fade = 1.0 - vT * 0.55;

  float dens = hazeDensity(vWorld, uTime, uHaze);
  float visible = 0.28 + dens * 0.85;

  vec3 c = vColor * vIntensity * (core + halo) * fade * visible * uGain;
  fragColor = vec4(c, 1.0);
}
