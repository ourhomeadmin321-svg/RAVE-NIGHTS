#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uSrc;
uniform vec2 uTexel;      // 1 / source resolution
uniform float uThreshold; // > 0 only on the first level

out vec4 fragColor;

/** Karis-style 13-tap downsample — stable under motion, no fireflies. */
void main() {
  vec2 t = uTexel;
  vec3 a = texture(uSrc, vUv + vec2(-2.0, 2.0) * t).rgb;
  vec3 b = texture(uSrc, vUv + vec2(0.0, 2.0) * t).rgb;
  vec3 c = texture(uSrc, vUv + vec2(2.0, 2.0) * t).rgb;
  vec3 d = texture(uSrc, vUv + vec2(-2.0, 0.0) * t).rgb;
  vec3 e = texture(uSrc, vUv).rgb;
  vec3 f = texture(uSrc, vUv + vec2(2.0, 0.0) * t).rgb;
  vec3 g = texture(uSrc, vUv + vec2(-2.0, -2.0) * t).rgb;
  vec3 h = texture(uSrc, vUv + vec2(0.0, -2.0) * t).rgb;
  vec3 i = texture(uSrc, vUv + vec2(2.0, -2.0) * t).rgb;
  vec3 j = texture(uSrc, vUv + vec2(-1.0, 1.0) * t).rgb;
  vec3 k = texture(uSrc, vUv + vec2(1.0, 1.0) * t).rgb;
  vec3 l = texture(uSrc, vUv + vec2(-1.0, -1.0) * t).rgb;
  vec3 m = texture(uSrc, vUv + vec2(1.0, -1.0) * t).rgb;

  vec3 col = e * 0.125;
  col += (a + c + g + i) * 0.03125;
  col += (b + d + f + h) * 0.0625;
  col += (j + k + l + m) * 0.125;

  if (uThreshold > 0.0) {
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    // Soft knee so bright beams ramp into bloom instead of popping.
    float knee = uThreshold * 0.6;
    float soft = clamp(lum - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    float contrib = max(soft, lum - uThreshold) / max(lum, 1e-4);
    col *= contrib;
  }

  fragColor = vec4(col, 1.0);
}
