/**
 * Shared GLSL — the ONE copy of the small noise/colour helpers every shader needs.
 *
 * three compiles every non-raw ShaderMaterial as GLSL 3.00 (`#version 300 es`),
 * defining `attribute`/`varying`/`texture2D`/`gl_FragColor` for us, so this code is
 * written in the familiar WebGL1 spelling and uses `texture2D` freely.
 *
 * All procedural detail here is *stateless*: it is a pure function of a coordinate
 * and a seed, so two frames of the same frame state are identical. That keeps the
 * screenshot harness meaningful.
 */

/**
 * 3D value noise (quintic interpolation) and fbm.
 *
 * Value noise is chosen over simplex on purpose: it is cheap in a software rasteriser,
 * its lattice is stable, and at the amplitudes used here (planet relief, dust
 * filaments, corona flicker) the axis-aligned traits are not visible. `hash13` is the
 * usual sin-free 32-bit mix — no trig, no branch.
 */
export const GLSL_NOISE = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 p) {
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
  vec4 nx00 = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), f.z);
  vec2 nx0 = mix(nx00.xy, nx00.zw, f.y);
  return mix(nx0.x, nx0.y, f.x);
}

// 1..7 octaves; 7 is the compile-time ceiling, and the caller's octave count is a uniform.
float fbm3(vec3 p, int octaves) {
  float amplitude = 0.5;
  float sum = 0.0;
  float norm = 0.0;
  for (int i = 0; i < 7; i++) {
    if (i >= octaves) break;
    sum += amplitude * vnoise(p);
    norm += amplitude;
    p = p * 2.03 + vec3(17.1, 9.7, 3.3);
    amplitude *= 0.5;
  }
  return sum / max(norm, 1e-4);
}

// Trilinear faded 1D noise, used for ring banding.
float vnoise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash13(vec3(i, 3.7, 1.1)), hash13(vec3(i + 1.0, 3.7, 1.1)), f);
}
`;

/** A soft round sprite profile. `d` is 0 at the centre, 1 at the sprite edge. */
export const GLSL_POINT = /* glsl */ `
float pointProfile(float d, float sharpness) {
  float core = exp(-d * d * sharpness);
  float halo = exp(-d * 5.0) * 0.30;
  return core + halo * (1.0 - core);
}
`;

/**
 * Radial ring banding, shared by the ring mesh and by the ring's shadow on the
 * planet's surface, so the shadow bands line up with the rings that cast them.
 * `t` is 0 at the inner edge, 1 at the outer edge.
 *
 * The profile is a *density*, not a brightness: broad zones, a couple of shallow
 * divisions, and a gentle ringlet structure. Every transition is wide enough to
 * survive a pixel, and no term is allowed to reach zero — a ring is translucent dust
 * everywhere, never a black bar, and the spacing is irregular enough not to read as a
 * record groove. (An earlier profile multiplied the density by 0.02-0.01 at two hard
 * gaps and squashed it through a 0.16..0.78 smoothstep; that painted the concentric
 * hard-edged bands in the frame the owner rejected.)
 */
export const GLSL_RINGS = /* glsl */ `
float ringDensity(float t) {
  // Low-frequency zones, irregular mid-scale bands and faint ringlets. The
  // frequencies are deliberately not harmonic: evenly spaced rings are the tell of a
  // synthetic pattern.
  float zones = vnoise1(t * 2.1 + 4.0);
  float bands = vnoise1(t * 5.7 + 11.0);
  float fine = vnoise1(t * 17.0 + 2.0);
  float density = 0.70 + 0.17 * (zones - 0.5) + 0.19 * (bands - 0.5) + 0.13 * (fine - 0.5);

  // Divisions: shallow and wide-shouldered, like the Cassini gap seen through a
  // telescope — a thinning of the dust, not a painted stripe.
  float gapA = smoothstep(0.27, 0.40, t) * (1.0 - smoothstep(0.43, 0.60, t));
  float gapB = smoothstep(0.66, 0.72, t) * (1.0 - smoothstep(0.79, 0.88, t));
  density *= 1.0 - 0.46 * gapA;
  density *= 1.0 - 0.40 * gapB;

  // Ringlets: a gentle brightness variation, never a hard lane.
  density *= 0.88 + 0.17 * smoothstep(0.25, 0.75, vnoise1(t * 23.0 + 21.0));
  return clamp(density, 0.0, 1.0);
}
`;

/** ACES filmic tone mapping (Narkowicz approximation) and sRGB encode. */
export const GLSL_TONEMAP = /* glsl */ `
vec3 acesTone(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
`;
