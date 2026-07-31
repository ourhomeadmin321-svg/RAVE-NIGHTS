#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;    // unit quad, -0.5..0.5
layout(location = 1) in vec3 aOffset;    // per-instance ground position
layout(location = 2) in vec2 aScaleSeed; // x = height scale, y = random phase

uniform mat4 uViewProj;
uniform vec3 uEye;
uniform float uTime;
uniform float uBeatPhase;
uniform float uEnergy;

out vec2 vUv;
out vec3 vWorld;
out float vSeed;

void main() {
  float seed = aScaleSeed.y;
  float height = aScaleSeed.x;

  // Bounce on the beat, out of phase per person so the crowd never moves as
  // one block — that uniformity is the giveaway in most crowd sims.
  float bounce = (1.0 - uBeatPhase) * (0.10 + uEnergy * 0.22) * (0.6 + 0.4 * sin(seed * 31.0));
  float sway = sin(uTime * 1.7 + seed * 12.0) * 0.06;

  vec3 base = aOffset + vec3(sway, bounce, 0.0);

  // Billboard about the Y axis only: people stay upright.
  vec3 toEye = uEye - base;
  vec3 right = normalize(vec3(-toEye.z, 0.0, toEye.x));

  vec3 world = base + right * aCorner.x * height * 0.42 + vec3(0.0, (aCorner.y + 0.5) * height, 0.0);

  vUv = aCorner + 0.5;
  vWorld = world;
  vSeed = seed;
  gl_Position = uViewProj * vec4(world, 1.0);
}
