#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in float aSide;   // -1..1 across the beam width
layout(location = 2) in float aT;      // 0..1 along the beam
layout(location = 3) in vec3 aColor;
layout(location = 4) in float aIntensity;

uniform mat4 uViewProj;

out vec3 vWorld;
out float vSide;
out float vT;
out vec3 vColor;
out float vIntensity;

void main() {
  vWorld = aPos;
  vSide = aSide;
  vT = aT;
  vColor = aColor;
  vIntensity = aIntensity;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
