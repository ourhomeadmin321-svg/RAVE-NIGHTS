#version 300 es
precision highp float;

#include "common"
#include "fixtures"

in vec2 vUv;
in vec3 vWorld;
in float vSeed;

uniform vec3 uEye;

out vec4 fragColor;

/**
 * Crowd as rim-lit silhouettes.
 *
 * Bodies are almost pure black; all the readable detail is the rim the fixtures
 * carve out of their edges. That is genuinely how a crowd looks from the floor
 * of a dark room, and it means a few hundred billboards read as a packed room
 * without any character geometry.
 */
void main() {
  // Rough head-and-shoulders silhouette from two overlapping capsules.
  vec2 p = vUv - vec2(0.5, 0.0);
  float head = 1.0 - smoothstep(0.085, 0.105, length((p - vec2(0.0, 0.87)) * vec2(1.0, 0.85)));
  float body = 1.0 - smoothstep(0.20, 0.24, length((p - vec2(0.0, 0.38)) * vec2(1.0, 0.42)));
  float arms = 1.0 - smoothstep(0.06, 0.09, abs(p.x) - 0.16);
  arms *= step(0.45, vUv.y) * step(vUv.y, 0.85) * step(0.5, fract(vSeed * 7.0));
  float mask = clamp(max(max(head, body), arms), 0.0, 1.0);
  if (mask < 0.02) discard;

  // Edge factor: bright at the silhouette boundary, dark in the middle.
  float edge = smoothstep(0.15, 0.95, 1.0 - mask) + smoothstep(0.3, 0.0, abs(p.x) - 0.12) * 0.25;

  vec3 col = vec3(0.006);
  for (int i = 0; i < MAX_FIXTURES; i++) {
    if (i >= uFixCount) break;
    vec3 toLight;
    float dist;
    float spot = fixtureSpot(i, vWorld, toLight, dist);
    if (spot <= 0.0) continue;
    // Back-lit rim: strongest when the light is behind the person.
    vec3 V = normalize(uEye - vWorld);
    float back = clamp(dot(toLight, -V) * 0.5 + 0.5, 0.0, 1.0);
    col += uFixCol[i].rgb * spot * (0.25 + back * 1.1) * (0.15 + edge * 0.9);
  }

  fragColor = vec4(col, mask);
}
