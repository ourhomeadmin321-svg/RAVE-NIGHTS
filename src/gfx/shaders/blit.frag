#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uSrc;

out vec4 fragColor;

/** Straight copy. Used to lift the half-res fractal into the scene target. */
void main() {
  fragColor = vec4(texture(uSrc, vUv).rgb, 1.0);
}
