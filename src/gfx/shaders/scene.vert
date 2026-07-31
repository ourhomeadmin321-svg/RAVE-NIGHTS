#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in float aMat;
layout(location = 4) in float aAux;

uniform mat4 uViewProj;

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
flat out int vMat;
flat out float vAux;

void main() {
  vWorld = aPos;
  vNormal = aNormal;
  vUv = aUv;
  vMat = int(aMat + 0.5);
  vAux = aAux;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
