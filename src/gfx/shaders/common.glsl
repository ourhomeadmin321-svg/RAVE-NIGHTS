// Shared shader chunk: noise, scattering, tonemapping.
// Included by the scene, volumetric, laser and composite passes so the haze
// field they all sample is literally the same function.

#define PI 3.14159265359

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * valueNoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

/**
 * Haze density at a world point.
 *
 * Single source of truth: the raymarched fixture beams and the laser quads both
 * call this, which is what keeps a laser from appearing to cut through clear
 * air in the middle of a thick patch of fog.
 *
 * Haze pools toward the floor because that is what a hazer actually does in a
 * room — it is heavier than air and gets stirred up by the crowd.
 */
float hazeDensity(vec3 p, float t, float base) {
  vec3 q = p * 0.085 + vec3(t * 0.021, t * 0.008, -t * 0.014);
  float n = fbm(q);
  float floorBias = mix(1.35, 0.55, clamp(p.y / 9.0, 0.0, 1.0));
  return base * mix(0.45, 1.3, n) * floorBias;
}

/** Henyey-Greenstein phase function: forward scattering makes beams glow. */
float hg(float cosTheta, float g) {
  float g2 = g * g;
  float denom = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * PI * pow(max(denom, 1e-4), 1.5));
}

/** ACES filmic curve — keeps saturated beams from clipping to flat white. */
vec3 acesTonemap(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 1e-5), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// ---------------------------------------------------------------- psychedelia

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

/**
 * Cosine gradient palette (Inigo Quilez). Four vec3 controls give a smooth
 * cyclic ramp, which is what keeps fractal orbit-trap colouring from banding
 * the way an indexed lookup table does.
 */
vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

/** The default psychedelic ramp: saturated, cyclic, never reaching black. */
vec3 tripPalette(float t) {
  return cosPalette(t,
    vec3(0.55, 0.45, 0.55),
    vec3(0.45, 0.48, 0.45),
    vec3(1.0, 1.0, 1.0),
    vec3(0.0, 0.33, 0.67));
}

/**
 * Fold a point radially into `segments` mirrored wedges.
 *
 * `p` is centred and aspect-corrected by the caller. Mirroring alternate wedges
 * rather than just repeating them is what makes the seams line up — a plain
 * modulo leaves a visible discontinuity all the way round.
 */
vec2 kaleidoscope(vec2 p, float segments) {
  float a = atan(p.y, p.x);
  float r = length(p);
  float seg = 6.28318 / max(segments, 1.0);
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  return vec2(cos(a), sin(a)) * r;
}

/**
 * Domain warping: offset the sample point by noise, then offset *that* by more
 * noise. Two levels is what turns smooth noise into something that looks like
 * it is flowing, rather than a static cloud sliding past.
 */
vec2 domainWarp(vec2 p, float t, float amount) {
  if (amount <= 0.0) return p;
  vec3 q = vec3(p * 2.2, t * 0.18);
  float a = valueNoise(q);
  float b = valueNoise(q + vec3(5.2, 1.3, 0.4));
  vec3 r = vec3(p * 2.6 + vec2(a, b) * 1.6, t * 0.14 + 3.1);
  float c = valueNoise(r);
  float d = valueNoise(r + vec3(1.7, 9.2, 2.8));
  return p + (vec2(c, d) - 0.5) * amount;
}
