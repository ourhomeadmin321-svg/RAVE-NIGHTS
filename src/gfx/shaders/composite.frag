#version 300 es
precision highp float;

#include "common"

in vec2 vUv;

uniform sampler2D uSource;
uniform sampler2D uBloom;
uniform float uTime;
uniform float uExposure;
uniform float uBloomAmount;
/** 0..1, spikes on drops. Drives aberration and the punch-in. */
uniform float uImpact;
/** 0..1 tearing: block displacement, RGB separation, scanline shear. */
uniform float uGlitch;
uniform float uGrain;
uniform float uVignette;
/** When on, contrast and flash amplitude are pulled in for safety. */
uniform float uReduceFlashing;
/** 0 normal, 1 source only, 2 bloom only. */
uniform int uDebug;
/** Warm bleed around highlights, the way film emulsion scatters red. */
uniform float uHalation;
/** Target aspect for the matte bars. 0 disables. */
uniform float uLetterbox;
uniform float uAspect;

out vec4 fragColor;

/**
 * Horizontal block tearing.
 *
 * Rows are quantised into bands and each band is shoved sideways by a hash of
 * its index and the current time slice. Quantising *time* as well as space is
 * what makes it read as digital corruption — a continuously varying offset just
 * looks like wobble, whereas discrete jumps held for a few frames look like
 * something broke.
 */
vec2 tear(vec2 uv, float amount) {
  if (amount <= 0.001) return uv;
  float slice = floor(uTime * 18.0);
  float band = floor(uv.y * mix(14.0, 46.0, hash11(slice)));
  // `active` is a reserved word in GLSL ES — this has to be named something else.
  float torn = step(1.0 - amount * 0.5, hash12(vec2(band, slice)));
  float shift = (hash12(vec2(band * 1.7, slice * 0.9)) - 0.5) * 0.14 * amount;
  return vec2(uv.x + shift * torn, uv.y);
}

void main() {
  float safe = 1.0 - uReduceFlashing;
  float glitch = uGlitch * safe;

  // Punch in slightly on impacts — a zoom the eye reads as loudness.
  float zoom = 1.0 - uImpact * 0.012 * safe;
  vec2 uv = (vUv - 0.5) * zoom + 0.5;

  uv = tear(uv, glitch);

  // Scanline shear: a slow vertical wave that only appears once torn up.
  uv.x += sin(uv.y * 140.0 + uTime * 9.0) * 0.0022 * glitch;

  // Chromatic separation from both the drop impact and the tearing, strongest
  // toward the edges of frame where it is least likely to smear detail.
  float ca = (uImpact * 0.004 + glitch * 0.012) * safe;
  vec2 dir = uv - 0.5;
  vec3 src;
  if (ca > 0.0001) {
    src.r = texture(uSource, uv + dir * ca).r;
    src.g = texture(uSource, uv).g;
    src.b = texture(uSource, uv - dir * ca).b;
  } else {
    src = texture(uSource, uv).rgb;
  }

  vec3 bloom = texture(uBloom, uv).rgb;

  vec3 col = src + bloom * uBloomAmount;

  // Halation: on film the red layer scatters furthest, so bright sources bleed
  // a warm halo. Tinting the existing bloom is enough to read as emulsion and
  // costs nothing extra.
  if (uHalation > 0.0) {
    float b = dot(bloom, vec3(0.2126, 0.7152, 0.0722));
    col += bloom * vec3(1.0, 0.42, 0.22) * uHalation * smoothstep(0.1, 1.2, b);
  }
  if (uDebug == 1) col = src;
  else if (uDebug == 2) col = bloom;
  col *= uExposure;

  col = acesTonemap(col);

  // Hue rotation on the hardest tears, so a glitch shifts colour as well as
  // geometry rather than only displacing pixels.
  if (glitch > 0.35) {
    float amt = (glitch - 0.35) * 0.9;
    vec3 shifted = col.gbr;
    col = mix(col, shifted, amt * 0.5);
  }

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

  // Anamorphic matte. Cropping to a cinema ratio does more for "this was shot"
  // than any amount of grain, because the frame shape is the first thing the
  // eye reads as film rather than as a game viewport.
  if (uLetterbox > 0.0) {
    float visible = uAspect / uLetterbox;
    float bar = (1.0 - clamp(visible, 0.0, 1.0)) * 0.5;
    if (vUv.y < bar || vUv.y > 1.0 - bar) {
      fragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  }

  fragColor = vec4(linearToSrgb(max(col, 0.0)), 1.0);
}
