#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
/** Horizontal stretch, for the anamorphic laser streak. */
uniform float uAnamorphic;

out vec4 fragColor;

/** 3x3 tent upsample. Cheap, and smooth enough to hide the downsample chain. */
void main() {
  vec2 t = uTexel * uRadius * vec2(1.0 + uAnamorphic * 3.0, 1.0);
  vec3 col = vec3(0.0);
  col += texture(uSrc, vUv + vec2(-1.0, 1.0) * t).rgb * 1.0;
  col += texture(uSrc, vUv + vec2(0.0, 1.0) * t).rgb * 2.0;
  col += texture(uSrc, vUv + vec2(1.0, 1.0) * t).rgb * 1.0;
  col += texture(uSrc, vUv + vec2(-1.0, 0.0) * t).rgb * 2.0;
  col += texture(uSrc, vUv).rgb * 4.0;
  col += texture(uSrc, vUv + vec2(1.0, 0.0) * t).rgb * 2.0;
  col += texture(uSrc, vUv + vec2(-1.0, -1.0) * t).rgb * 1.0;
  col += texture(uSrc, vUv + vec2(0.0, -1.0) * t).rgb * 2.0;
  col += texture(uSrc, vUv + vec2(1.0, -1.0) * t).rgb * 1.0;
  fragColor = vec4(col / 16.0, 1.0);
}
