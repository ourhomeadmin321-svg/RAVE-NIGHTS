// Fixture uniform block, shared by the scene and volumetric passes.
// Only *active* fixtures are uploaded — the CPU culls anything at zero output
// before packing, so the shader loop length tracks how many lights are actually
// on rather than how many are rigged.

#define MAX_FIXTURES 32

uniform int uFixCount;
uniform vec4 uFixPos[MAX_FIXTURES]; // xyz = world position, w = throw distance
uniform vec4 uFixDir[MAX_FIXTURES]; // xyz = aim direction,  w = cos(outer cone)
uniform vec4 uFixCol[MAX_FIXTURES]; // rgb = colour * output, w = cos(inner cone)

/** Cone falloff and distance attenuation for fixture `i` at world point `p`. */
float fixtureSpot(int i, vec3 p, out vec3 toLight, out float dist) {
  vec3 d = p - uFixPos[i].xyz;
  dist = length(d);
  if (dist > uFixPos[i].w) return 0.0;
  toLight = d / max(dist, 1e-4);
  float ca = dot(toLight, uFixDir[i].xyz);
  float spot = smoothstep(uFixDir[i].w, uFixCol[i].w, ca);
  if (spot <= 0.0) return 0.0;
  // Clamp the near field. Inverse-square is correct, but a raymarch step that
  // lands a few centimetres from a lens would otherwise contribute a value
  // hundreds of times larger than its neighbours and punch a white hole in the
  // frame. Real fixtures have a physical aperture; this stands in for it.
  float clamped = max(dist, 1.6);

  // Falloff depends on how tight the fixture is, and this is the difference
  // between a rig that reads as beams and one that does not. Inverse-square
  // describes a point source spreading over a growing sphere — true for a wide
  // wash, badly wrong for a beam. A pencil beam stays collimated: its
  // cross-section barely grows, so radiance along its length holds up and the
  // shaft stays visible all the way across the room. Wash fixtures spread and
  // fall off properly.
  float tight = smoothstep(0.90, 0.999, uFixDir[i].w);
  float k = mix(0.045, 0.0022, tight);
  float atten = 1.0 / (1.0 + k * clamped * clamped);
  return spot * atten;
}

/**
 * Radiance scale for volumetric in-scattering.
 *
 * Scattering is driven by radiance — flux per unit solid angle — not by total
 * flux. A wash spreads the same lamp across a cone two orders of magnitude
 * wider than a beam does, so per steradian it is far dimmer. That single fact
 * is why a beam carves a hard shaft through haze while a wash merely tints the
 * air around it. Weighting them equally fills the whole room with milk and the
 * beams stop reading at all.
 *
 * Surface lighting in scene.frag correctly ignores this: illuminance on a wall
 * does depend on total flux, which is why a wash is the fixture you use to put
 * colour on a room.
 */
float fixtureRadiance(int i) {
  float tight = smoothstep(0.90, 0.999, uFixDir[i].w);
  return mix(0.09, 1.0, tight);
}
