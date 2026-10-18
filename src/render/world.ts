/**
 * Worlds — the one planet look.
 *
 * A `Planet` (and a `Moon`, which carries the same `SurfaceSpec`) is turned into a
 * small rig: an opaque surface sphere, an optional cloud shell, an optional atmosphere
 * rim, and optional rings. The same rig is used by the system view (small spheres,
 * fewer segments) and the planet view (the showpiece), so a world never has two
 * different looks depending on how far away you are.
 *
 * Everything is procedural on the GPU. `SurfaceSpec` is the whole recipe: palette,
 * turbulence, bandiness, roughness, cloudiness and city lights. The shader evaluates
 * domain-warped fbm on the sphere direction, which costs a few uniforms instead of a
 * texture upload (`docs/ARCHITECTURE.md`, Data flow) and never seams at a pole.
 *
 * Lighting is done in WORLD space from the host star's direction. The surface mesh
 * only rotates for its own spin; using the geometric world normal means the shader
 * never has to reconstruct a rotation matrix per frame. Ring shadows are analytic
 * (planet → ring, ring → planet) rather than shadow-map passes, which is what keeps the
 * planet view under 40 draw calls.
 */

import * as THREE from 'three';
import type { Atmosphere, PlanetKind, RingSystem, Rgb, SurfaceSpec } from '../sim/types';
import { GLSL_NOISE, GLSL_RINGS } from './glsl';
import { hashString } from './rand';
import { drawnRingRadii } from './scales';

const WHITE = new THREE.Color(1, 1, 1);

const KIND_CODE: Record<PlanetKind, number> = {
  terrestrial: 0,
  ocean: 1,
  desert: 2,
  ice: 3,
  lava: 4,
  toxic: 5,
  barren: 6,
  gas: 7,
  icegiant: 8,
};

const SURFACE_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = normalize(position);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorld = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const SURFACE_FRAG = /* glsl */ `
${GLSL_NOISE}
${GLSL_RINGS}

uniform float uSeed;
uniform int uKind;
uniform int uGiant;
uniform float uTurbulence;
uniform float uBandiness;
uniform float uRoughness;
uniform float uCoverage;
uniform float uIceLine;
uniform float uIceStrength;
uniform float uNightLights;
uniform int uOctaves;
uniform int uWarpOctaves;
uniform vec3 uDeep;
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec3 uIce;
uniform vec3 uWater;
uniform float uHasWater;

uniform vec3 uStarDir;
uniform vec3 uStarColor;
uniform float uStarIntensity;
uniform vec3 uCenter;
uniform vec3 uAtmoColor;
uniform float uAtmoAmount;

uniform vec3 uRingNormal;
uniform float uRingInner;
uniform float uRingOuter;
uniform float uRingOpacity;
// Fine surface detail is aliasing on a world that is twenty pixels across, so the small
// views turn it off rather than dithering the globe into a QR code.
uniform float uFine;
// Banding frequency multiplier: a world that is ninety pixels across cannot carry a
// twenty-band barcode without aliasing into chevrons.
uniform float uBandScale;

varying vec3 vLocal;
varying vec3 vWorld;

float heightField(vec3 p) {
  float w1 = fbm3(p * 1.75 + uSeed + 3.0, uWarpOctaves);
  float w2 = fbm3(p * 2.15 + uSeed + 11.0, uWarpOctaves);
  vec3 warped = p + (uTurbulence * 0.55) * vec3(w1 - 0.5, w2 - 0.5, (w1 - w2));
  float base = fbm3(warped * 2.25 + uSeed * 0.17, uOctaves);
  // A finer octave breaks coastlines into bays and islands rather than blobs.
  float detail = fbm3(warped * 11.0 + uSeed * 0.31, 3);
  return clamp(base + (detail - 0.5) * 0.055, 0.0, 1.0);
}

// Latitude bands with turbulent shear: the gas-giant recipe. Returns 0..1.
float bandField(vec3 p) {
  float warp = fbm3(p * vec3(1.2, 2.8, 1.2) + uSeed * 0.7, 2);
  // Latitude, not the sine of it: bands are laid out in latitude, and using p.y gives a
  // handful of fat stripes instead of a belt-and-zone system.
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float shear = lat + 0.085 * (warp - 0.5) + 0.035 * sin(lat * 5.0 + uSeed);
  // Three band scales, gently sheared: a giant's belts are broad zones with thin edges,
  // not a barcode.
  float k = uBandScale;
  float fine = 0.5 + 0.5 * sin(shear * 21.0 * k + 0.85 * sin(shear * 6.0 * k)) * (0.74 + 0.18 * sin(shear * 46.0 * k + 1.7));
  float storm = smoothstep(0.62, 0.92, fbm3(p * 2.6 + 21.0 + uSeed, 3));
  return clamp(0.22 + fine * 0.52 + storm * 0.20, 0.0, 1.0);
}

// One storm: an oval rim around a slightly darker interior, in latitude/longitude.
// The rim mask is 0..1 and is tinted by the caller.
float stormRim(vec3 p, float lat0, float lon0, float wLat, float wLon) {
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float lon = atan(p.z, p.x);
  float dlon = lon - lon0;
  dlon = dlon - 6.283185 * floor(dlon / 6.283185 + 0.5);
  dlon *= cos(clamp(lat, -1.5, 1.5));
  float dlat = (lat - lat0) / wLat;
  float dlonn = dlon / wLon;
  float inner = exp(-(dlat * dlat + dlonn * dlonn));
  float shell = exp(-(pow(dlat / 1.55, 2.0) + pow(dlonn / 1.45, 2.0)));
  return clamp((shell - inner * 0.55) * 2.2, 0.0, 1.0);
}

vec3 palette(float h) {
  vec3 c = mix(uDeep, uLow, smoothstep(0.06, 0.38, h));
  c = mix(c, uMid, smoothstep(0.35, 0.62, h));
  c = mix(c, uHigh, smoothstep(0.60, 0.90, h));
  return c;
}

void main() {
  vec3 p = normalize(vLocal);
  vec3 N = normalize(vWorld - uCenter);
  vec3 L = normalize(uStarDir);
  vec3 V = normalize(cameraPosition - vWorld);

  float h = heightField(p);
  float band = bandField(p);
  float relief = mix(h, band, uBandiness * 0.88);
  // A gas giant's belts have edges. A gentle S-curve on the field gives the palette
  // somewhere to change tone without turning into stripes.
  relief = clamp(0.5 + (relief - 0.5) * (1.0 + 0.45 * float(uGiant)), 0.0, 1.0);

  // --- land / sea ---------------------------------------------------------
  float seaLevel = mix(0.30, 0.72, uCoverage);
  float land = smoothstep(seaLevel - 0.012, seaLevel + 0.035, h);
  land = mix(land, 1.0, float(uGiant));

  vec3 surf;
  if (uGiant == 1) {
    surf = palette(relief);
    // A gas giant is pastel, not poster paint: pull 40% of the chroma out of the palette
    // and keep only a whisper of belt-edge contrast.
    float luma = dot(surf, vec3(0.299, 0.587, 0.114));
    surf = mix(vec3(luma), surf, 0.60);
    // fract() is discontinuous, and a discontinuity in a shading term at low resolution
    // is a chevron; the smooth sine is the same modulation without the seam.
    surf *= 0.93 + 0.14 * smoothstep(0.42, 0.58, 0.5 + 0.5 * sin(relief * 37.7));
  } else {
    surf = palette(relief);
    vec3 shallow = mix(uWater * 1.35, uLow * 0.55, 0.22);
    vec3 deepWater = mix(uDeep * 0.75, uWater * 0.62, 0.55);
    float depth = clamp((seaLevel - h) / max(seaLevel, 0.001), 0.0, 1.0);
    vec3 sea = mix(shallow, deepWater, smoothstep(0.06, 0.55, depth));
    // The bright shelf must hug the coast: a wide one turns every ocean into a pool.
    float shelf = exp(-(seaLevel - h) * 26.0);
    sea = mix(sea, uWater * 1.75 + vec3(0.008, 0.015, 0.025), shelf * 0.55);
    float foam = exp(-abs(h - seaLevel) * 130.0) * 0.3 * uHasWater;
    sea += vec3(0.5, 0.58, 0.66) * foam;
    surf = mix(sea, surf, land);
  }
  float landTint = fbm3(p * 6.5 + uSeed + 3.0, 3);
  surf = mix(surf, uHigh * 0.9, smoothstep(0.60, 0.88, h) * 0.40 * land);
  surf = mix(surf, uLow, smoothstep(0.44, 0.30, h) * 0.30 * land);
  surf *= mix(1.0, 0.72 + 0.52 * landTint, land);
  surf *= 1.0 - uFine * 0.12 * (1.0 - vnoise(p * 24.0 + uSeed));

  // --- storm ovals (giants only) ------------------------------------------
  if (uGiant == 1) {
    float s1 = stormRim(p, 0.38 + uSeed * 0.05, uSeed * 1.7, 0.055, 0.16);
    float s2 = stormRim(p, -0.29 + uSeed * 0.03, uSeed * 2.9 + 1.2, 0.045, 0.13);
    float s3 = stormRim(p, 0.10 + uSeed * 0.02, uSeed * 4.3 + 2.4, 0.032, 0.09);
    surf = mix(surf, surf * vec3(1.22, 0.90, 0.78), clamp(s1 * 0.85, 0.0, 1.0));
    surf = mix(surf, surf * vec3(0.86, 0.92, 1.10), clamp(s2 * 0.55, 0.0, 1.0));
    surf = mix(surf, surf * vec3(1.15, 0.95, 0.86), clamp(s3 * 0.45, 0.0, 1.0));
  }

  // --- ice caps -----------------------------------------------------------
  float capNoise = (fbm3(p * 4.5 + 4.0 + uSeed, 3) - 0.5) * 0.16;
  float cap = smoothstep(uIceLine + capNoise, uIceLine + 0.05 + capNoise, abs(p.y));
  cap *= uIceStrength;
  surf = mix(surf, uIce, cap);

  // --- relief shading (single height sample, screen-space bump) ----------
  vec3 dpdx = dFdx(vWorld);
  vec3 dpdy = dFdy(vWorld);
  vec3 r1 = cross(dpdy, N);
  vec3 r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dFdx(relief) * r1 + dFdy(relief) * r2);
  // Water is smooth: only land gets the full relief bump, or the seafloor turns the
  // ocean into marbled paint. A whisper of bump keeps the water from looking like glass.
  vec3 Nb = normalize(abs(det) * N - grad * (uRoughness * uFine * (0.08 + 0.92 * land)));
  float diffuse = max(dot(Nb, L), 0.0);
  // The terminator is a band of twilight, not a knife edge — but it still has to be a
  // *terminator*: too wide a fade flattens the phase into a flat disc.
  float day = smoothstep(-0.16, 0.24, dot(N, L));
  diffuse *= day;

  // --- ring shadow on the surface ----------------------------------------
  // Analytic, with a penumbra: the shadow's edges are softened over a third of the ring
  // annulus so it reads as light filtered through dust, never as a painted black bar.
  float ringShade = 1.0;
  if (uRingOuter > 0.0) {
    float denom = dot(L, uRingNormal);
    // Grazing light makes the projected shadow degenerate; skip it rather than paint
    // a false band across the planet.
    if (abs(denom) > 0.04) {
      float t = dot(uCenter - vWorld, uRingNormal) / denom;
      if (t > 0.0 && t < 1e9) {
        vec3 hit = vWorld + L * t;
        vec3 rel = hit - uCenter - uRingNormal * dot(hit - uCenter, uRingNormal);
        float rr = length(rel);
        float span = max(uRingOuter - uRingInner, 1e-5);
        float rt = (rr - uRingInner) / span;
        float soft = smoothstep(0.0, 0.30, abs(denom));
        float penumbra = smoothstep(0.0, 0.06, rt) * (1.0 - smoothstep(0.94, 1.05, rt));
        float density = ringDensity(clamp(rt, 0.0, 1.0));
        ringShade = 1.0 - 0.42 * soft * uRingOpacity * density * penumbra;
        // A narrow extra dimming right at the dense inner ring, which is what a real
        // ring shadow looks like on a cloud deck.
        ringShade *= 1.0 - 0.22 * soft * uRingOpacity * smoothstep(0.10, 0.25, density) * penumbra;
      }
    }
  }

  // --- lighting ----------------------------------------------------------
  vec3 lit = surf * uStarColor * (diffuse * 1.45 + 0.022) * uStarIntensity * ringShade;

  // Terminator scattering: a warm fringe just before nightfall.
  float term = smoothstep(-0.20, 0.02, dot(N, L)) * (1.0 - smoothstep(0.02, 0.32, dot(N, L)));
  lit += surf * uStarColor * vec3(1.0, 0.55, 0.28) * term * 0.24 * uAtmoAmount * uStarIntensity;

  // --- liquid specular ----------------------------------------------------
  vec3 Hv = normalize(L + V);
  float sparkle = 0.55 + 0.45 * vnoise(p * 52.0 + uSeed + 7.0);
  float gloss = pow(max(dot(Nb, Hv), 0.0), 260.0) * (1.0 - land) * uHasWater * sparkle;
  float sheen = pow(max(dot(Nb, Hv), 0.0), 24.0) * (1.0 - land) * uHasWater * 0.045;
  lit += uStarColor * (gloss * 1.5 + sheen) * uStarIntensity * (0.35 + 0.65 * day);

  // Ice and cloud tops always show a little specular.
  float iceGlint = pow(max(dot(Nb, Hv), 0.0), 70.0) * cap * 0.45;
  lit += uStarColor * iceGlint * uStarIntensity * day;

  // --- night side: cities, lava ------------------------------------------
  // Strictly the night side: at the terminator the city glow fades out, and it never
  // reaches the lit limb (flare on the day side was a reported defect).
  float night = smoothstep(0.04, -0.20, dot(N, L));
  if (uNightLights > 0.001) {
    // Three tight scales: a continent-sized region of settlement, a country-sized
    // cluster, and the individual lights. Anything smoother reads as gold paint.
    float region = smoothstep(0.52, 0.82, fbm3(p * 9.0 + 5.0, 3));
    float cluster = smoothstep(0.60, 0.86, fbm3(p * 26.0 + 9.0, 3));
    float spark = smoothstep(0.68, 0.92, fbm3(p * 64.0 + 3.0, 2));
    float cities = region * cluster * spark * land * uNightLights * night;
    lit += vec3(1.0, 0.72, 0.38) * cities * 2.6;
    // A faint amber wash under the clusters: the glow of a city seen from orbit.
    lit += vec3(0.55, 0.32, 0.12) * region * cluster * land * uNightLights * night * 0.10;
  }
  if (uKind == 4) {
    float crack = 1.0 - abs(fbm3(p * 4.6 + uSeed, 4) * 2.0 - 1.0);
    float lava = smoothstep(0.74, 0.96, crack);
    lit += vec3(1.0, 0.30, 0.06) * lava * (0.6 + night * 1.1) * 2.4;
  }

  // --- atmosphere veil on the sunlit limb ---------------------------------
  float limb = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  lit += uAtmoColor * limb * uAtmoAmount * (0.25 + 0.75 * day) * 0.5;

  gl_FragColor = vec4(lit, 1.0);
}
`;

const CLOUD_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormalWorld;
void main() {
  vLocal = normalize(position);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorld = worldPos.xyz;
  vNormalWorld = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const CLOUD_FRAG = /* glsl */ `
${GLSL_NOISE}
uniform float uSeed;
uniform float uCloudiness;
uniform float uBanded;
uniform float uTime;
uniform vec3 uCloudColor;
uniform vec3 uStarColor;
uniform vec3 uStarDir;
uniform float uStarIntensity;
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormalWorld;
void main() {
  vec3 p = normalize(vLocal);
  float drift = uTime * 0.0035;
  // Two scales, both stretched along the flow: a broad weather-system mask and fine
  // streaks inside it. The old version thresholded one blobby field, which painted
  // continents of cloud instead of wisps.
  vec3 flow = p * vec3(4.4, 2.6, 4.4) + vec3(drift, 0.0, drift * 0.4) + uSeed * 0.21;
  vec3 warp = vec3(
    vnoise(p * 2.6 + 5.0),
    vnoise(p * 2.2 + 9.0),
    vnoise(p * 3.1 + 13.0)
  ) - 0.5;
  float system = fbm3(flow * 1.0 + warp * 0.55, 4);
  // The streaks are stretched along the flow: that anisotropy is what reads as wind,
  // and it is the difference between a wisp and a torn-paper shard.
  vec3 detailCoord = flow * vec3(3.6, 1.5, 3.6) + warp * 1.25 + 17.0;
  float streaks = fbm3(detailCoord, 3);
  // Latitude bands organise the streaks: trade winds, not noise.
  float band = 0.5 + 0.5 * sin(p.y * 15.0 + fbm3(p * 1.7 + 3.0, 2) * 6.0);
  float c = system * 0.52 + streaks * 0.36 + band * 0.12 * uBanded;
  float threshold = mix(0.62, 0.36, uCloudiness);
  // A narrow window is what makes an edge wispy instead of a blob edge.
  float cover = smoothstep(threshold - 0.02, threshold + 0.105, c);
  cover *= 0.45 + 0.55 * smoothstep(threshold - 0.10, threshold + 0.10, system);
  if (cover < 0.003) discard;

  vec3 N = normalize(vNormalWorld);
  vec3 L = normalize(uStarDir);
  vec3 V = normalize(cameraPosition - vWorld);
  float day = smoothstep(-0.30, 0.50, dot(N, L));
  float limb = pow(1.0 - abs(dot(N, V)), 2.2);
  float thickness = 0.45 + 0.55 * smoothstep(threshold, threshold + 0.22, c);
  vec3 col = uCloudColor * uStarColor * (0.02 + day * 1.05) * uStarIntensity;
  col *= 0.86 + 0.14 * thickness;
  float alpha = cover * (0.26 + 0.34 * thickness) * (0.40 + 0.60 * day) * (1.0 + 0.30 * limb);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.92));
}
`;

const ATMO_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalWorld;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorld = worldPos.xyz;
  vNormalWorld = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uStarDir;
uniform float uOpacity;
uniform float uPower;
uniform float uIntensity;
varying vec3 vWorld;
varying vec3 vNormalWorld;
void main() {
  vec3 N = normalize(vNormalWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uStarDir);
  float fres = pow(1.0 - abs(dot(N, V)), uPower);
  float lit = smoothstep(-0.45, 0.55, dot(N, L));
  // Forward scattering: the star seen through the atmosphere behind the limb.
  float forward = pow(max(dot(-V, L), 0.0), 5.0);
  vec3 col = uColor * fres * (0.10 + 1.35 * lit + 0.55 * forward) * uOpacity * uIntensity;
  gl_FragColor = vec4(col, 1.0);
}
`;

const RING_VERT = /* glsl */ `
attribute float aT;
varying float vT;
varying vec3 vWorld;
varying vec3 vNormalWorld;
void main() {
  vT = aT;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorld = worldPos.xyz;
  vNormalWorld = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const RING_FRAG = /* glsl */ `
${GLSL_NOISE}
${GLSL_RINGS}
uniform vec3 uRingColor;
uniform float uOpacity;
uniform vec3 uStarDir;
uniform vec3 uStarColor;
uniform float uStarIntensity;
uniform vec3 uCenter;
uniform float uPlanetRadius;
varying float vT;
varying vec3 vWorld;
varying vec3 vNormalWorld;
void main() {
  float density = ringDensity(vT);
  // A ring does not end on a line: it thins out over its outer tenth and has a soft
  // inner edge, which is half of what stops it reading as a solid ribbon.
  float edge = smoothstep(0.0, 0.045, vT) * (1.0 - smoothstep(0.90, 1.0, vT));
  float alpha = uOpacity * (0.08 + 0.92 * density) * edge * 0.82;
  if (alpha < 0.003) discard;

  vec3 N = normalize(vNormalWorld);
  vec3 L = normalize(uStarDir);
  vec3 V = normalize(cameraPosition - vWorld);
  // Particles scatter: bright when lit, and brighter still looking through them into
  // the star (forward scattering).
  float lit = 0.42 + 0.58 * abs(dot(N, L));
  float forward = pow(max(dot(-V, L), 0.0), 3.0);
  // Desaturate the data colour toward neutral ice: rings are pale, whatever tint the
  // generator picked for the debris.
  vec3 tint = mix(uRingColor, vec3(0.94, 0.92, 0.88), 0.72);
  vec3 tinted = mix(tint * vec3(1.06, 1.00, 0.90), tint * vec3(0.93, 0.97, 1.04), smoothstep(0.15, 0.95, vT));
  vec3 col = tinted * uStarColor * (0.30 + 0.70 * density) * lit * uStarIntensity;
  col += uStarColor * forward * density * 0.35;

  // The planet's shadow, cast across the ring plane: an analytic sphere shadow with a
  // penumbra, so the rings darken through the shadow instead of snapping to black.
  vec3 toPlanet = uCenter - vWorld;
  float along = dot(toPlanet, L);
  if (along > 0.0) {
    float closest = length(vWorld + L * along - uCenter);
    float shade = smoothstep(uPlanetRadius * 0.90, uPlanetRadius * 1.36, closest);
    col *= mix(0.42, 1.0, shade);
  }

  gl_FragColor = vec4(col, alpha);
}
`;

export type WorldDetail = 'system' | 'moon' | 'planet';

export interface WorldOptions {
  readonly surface: SurfaceSpec;
  /** Drawn radius, in the current view's units. */
  readonly radius: number;
  readonly detail: WorldDetail;
  readonly atmosphere: Atmosphere | null;
  readonly rings: RingSystem | null;
  readonly coverage: number;
  readonly planetRadiusKm: number;
  readonly temperatureK: number | null;
  readonly id: string;
  readonly clouds: boolean;
  /** Extra emissive cities override; defaults to the SurfaceSpec value. */
  readonly nightLights?: number;
  /**
   * How far the host star's colour is white-balanced toward neutral for this world,
   * 0..1. The system view uses 0 (a red star really does light its planets red); the
   * planet view uses ~0.5, because a portrait of a world should show the world's own
   * palette, exactly as a camera's white balance would.
   */
  readonly lightBalance?: number;
}

/** Uniform objects, keyed by the GLSL uniform names the surface shader declares. */
interface ColorUniforms {
  uDeep: { value: THREE.Color };
  uLow: { value: THREE.Color };
  uMid: { value: THREE.Color };
  uHigh: { value: THREE.Color };
  uIce: { value: THREE.Color };
  uWater: { value: THREE.Color };
}

function rgb(c: Rgb): THREE.Color {
  return new THREE.Color(c[0], c[1], c[2]);
}

function iceSettings(kind: PlanetKind, temperatureK: number | null): { line: number; strength: number } {
  if (kind === 'ice') return { line: 0.34, strength: 1.0 };
  if (kind === 'lava') return { line: 1.3, strength: 0.0 };
  if (kind === 'gas' || kind === 'icegiant') return { line: 0.85, strength: kind === 'icegiant' ? 0.5 : 0.0 };
  const temp = temperatureK ?? 280;
  if (kind === 'ocean' || kind === 'terrestrial') {
    if (temp > 340) return { line: 1.3, strength: 0 };
    return { line: 0.62 + Math.min(Math.max((temp - 200) / 160, 0), 1) * 0.30, strength: 1 };
  }
  if (kind === 'desert') return temp < 250 ? { line: 0.68, strength: 0.6 } : { line: 1.3, strength: 0 };
  return temp < 240 ? { line: 0.62, strength: 0.7 } : { line: 1.3, strength: 0 };
}

/** An annulus in the XZ plane with a normalised radial attribute for the shader. */
function ringGeometry(inner: number, outer: number, segments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const ts: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const cx = Math.cos(a);
    const sz = Math.sin(a);
    positions.push(cx * inner, 0, sz * inner, cx * outer, 0, sz * outer);
    normals.push(0, 1, 0, 0, 1, 0);
    ts.push(0, 1);
    if (i < segments) {
      const b = i * 2;
      indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * A world's render rig. Owners position `group`; the rig handles its own spin,
 * uniforms and disposal. Lighting is updated once per frame.
 */
export class WorldVisual {
  readonly group: THREE.Group;
  readonly surface: THREE.Mesh;
  readonly clouds: THREE.Mesh | null;
  readonly atmosphere: THREE.Mesh | null;
  readonly rings: THREE.Mesh | null;
  readonly radius: number;
  private readonly tilt: THREE.Group;
  private readonly surfaceMaterial: THREE.ShaderMaterial;
  private readonly cloudMaterial: THREE.ShaderMaterial | null;
  private readonly atmosphereMaterial: THREE.ShaderMaterial | null;
  private readonly ringMaterial: THREE.ShaderMaterial | null;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly ringInner: number;
  private readonly ringOuter: number;
  private readonly ringNormal = new THREE.Vector3(0, 1, 0);
  private readonly lightBalance: number;
  private readonly balancedLight = new THREE.Color(1, 1, 1);
  private readonly worldQuat = new THREE.Quaternion();
  readonly tiltRadians: number;
  /** Drawn scale applied on top of the given radius (1 = as generated). */
  private drawnScale = 1;

  constructor(options: WorldOptions) {
    const { surface, radius, detail, atmosphere, rings } = options;
    const kindCode = KIND_CODE[surface.kind];
    const giant = surface.kind === 'gas' || surface.kind === 'icegiant';
    const planetDetail = detail === 'planet';
    const moonDetail = detail === 'moon';
    const seed = (surface.seed >>> 0) / 4294967296;
    const seedOffset = seed * 977;
    const hash = hashString(options.id);
    this.tiltRadians = 0.16 + ((hash % 1000) / 1000) * 0.34;

    this.group = new THREE.Group();
    this.tilt = new THREE.Group();
    this.tilt.rotation.z = this.tiltRadians;
    this.group.add(this.tilt);

    const ice = iceSettings(surface.kind, options.temperatureK);
    const coverage = Math.min(Math.max(options.coverage, 0), 1);
    const colors: ColorUniforms = {
      uDeep: { value: rgb(surface.colors.deep) },
      uLow: { value: rgb(surface.colors.low) },
      uMid: { value: rgb(surface.colors.mid) },
      uHigh: { value: rgb(surface.colors.high) },
      uIce: { value: rgb(surface.colors.ice) },
      uWater: { value: surface.colors.water ? rgb(surface.colors.water) : rgb(surface.colors.deep) },
    };
    const atmosphereColor = atmosphere ? rgb(atmosphere.color) : new THREE.Color(0.2, 0.4, 0.8);
    const atmosphereAmount = atmosphere ? Math.min(Math.max(atmosphere.opacity, 0), 1) : 0;

    this.radius = radius;
    this.lightBalance = Math.min(Math.max(options.lightBalance ?? 0, 0), 1);
    // `fine` scales the high-frequency detail (and the screen-space relief bump) with
    // how many pixels the world actually occupies: a 20-pixel globe cannot show 24-cycle
    // noise, it can only alias into a QR code.
    const fine = planetDetail ? 1 : moonDetail ? 0.55 : 0.16;
    const surfaceSegments = planetDetail ? [160, 80] : moonDetail ? [96, 56] : [64, 40];
    const cloudSegments = planetDetail ? [96, 54] : moonDetail ? [64, 36] : [28, 18];
    const atmoSegments = planetDetail ? [96, 54] : moonDetail ? [64, 36] : [32, 20];

    const surfaceGeometry = new THREE.SphereGeometry(radius, surfaceSegments[0]!, surfaceSegments[1]!);
    this.geometries.push(surfaceGeometry);
    this.surfaceMaterial = new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      uniforms: {
        uSeed: { value: seedOffset },
        uKind: { value: kindCode },
        uGiant: { value: giant ? 1 : 0 },
        uTurbulence: { value: surface.turbulence },
        uBandiness: { value: giant ? Math.max(surface.bandiness, 0.75) : surface.bandiness },
        uRoughness: { value: surface.roughness },
        uFine: { value: fine },
        uBandScale: { value: planetDetail ? 1 : moonDetail ? 0.8 : 0.42 },
        uCoverage: { value: coverage },
        uIceLine: { value: ice.line },
        uIceStrength: { value: ice.strength },
        uNightLights: { value: options.nightLights ?? surface.nightLights },
        uOctaves: { value: planetDetail ? 5 : moonDetail ? 4 : 3 },
        uWarpOctaves: { value: planetDetail ? 3 : moonDetail ? 3 : 2 },
        ...colors,
        uHasWater: { value: surface.colors.water ? 1 : 0 },
        uStarDir: { value: new THREE.Vector3(1, 0, 0) },
        uStarColor: { value: new THREE.Color(1, 1, 1) },
        uStarIntensity: { value: 1 },
        uCenter: { value: new THREE.Vector3() },
        uAtmoColor: { value: atmosphereColor },
        uAtmoAmount: { value: atmosphereAmount },
        uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
        uRingInner: { value: 0 },
        uRingOuter: { value: 0 },
        uRingOpacity: { value: 0 },
      },
    });
    this.materials.push(this.surfaceMaterial);
    this.surface = new THREE.Mesh(surfaceGeometry, this.surfaceMaterial);
    this.surface.renderOrder = 0;
    this.tilt.add(this.surface);

    // Gas and ice giants have no separate cloud shell: their bands ARE the cloud deck,
    // and a second white shell over them reads as plastic wrap. Rocky worlds get one.
    this.cloudMaterial = options.clouds && !giant
      ? new THREE.ShaderMaterial({
          vertexShader: CLOUD_VERT,
          fragmentShader: CLOUD_FRAG,
          uniforms: {
            uSeed: { value: seedOffset },
            uCloudiness: { value: surface.cloudiness },
            uBanded: { value: giant ? 1 : 0 },
            uTime: { value: 0 },
            uCloudColor: { value: rgb(surface.cloudColor) },
            uStarColor: { value: new THREE.Color(1, 1, 1) },
            uStarDir: { value: new THREE.Vector3(1, 0, 0) },
            uStarIntensity: { value: 1 },
          },
          transparent: true,
          depthWrite: false,
          side: THREE.FrontSide,
          blending: THREE.NormalBlending,
        })
      : null;
    if (this.cloudMaterial) {
      this.materials.push(this.cloudMaterial);
      const cloudGeometry = new THREE.SphereGeometry(radius * 1.012, cloudSegments[0]!, cloudSegments[1]!);
      this.geometries.push(cloudGeometry);
      this.clouds = new THREE.Mesh(cloudGeometry, this.cloudMaterial);
      this.clouds.renderOrder = 2;
      this.tilt.add(this.clouds);
    } else {
      this.clouds = null;
    }

    this.atmosphereMaterial = atmosphere
      ? new THREE.ShaderMaterial({
          vertexShader: ATMO_VERT,
          fragmentShader: ATMO_FRAG,
          uniforms: {
            uColor: { value: atmosphereColor },
            uStarDir: { value: new THREE.Vector3(1, 0, 0) },
            uOpacity: { value: Math.min(Math.max(atmosphere.opacity, 0.05), 1) },
            uPower: { value: planetDetail ? 4.3 : moonDetail ? 3.8 : 3.4 },
            uIntensity: { value: planetDetail ? 0.8 : 0.8 },
          },
          transparent: true,
          depthWrite: false,
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
        })
      : null;
    if (this.atmosphereMaterial) {
      this.materials.push(this.atmosphereMaterial);
      const atmoGeometry = new THREE.SphereGeometry(radius * (planetDetail ? 1.028 : 1.055), atmoSegments[0]!, atmoSegments[1]!);
      this.geometries.push(atmoGeometry);
      this.atmosphere = new THREE.Mesh(atmoGeometry, this.atmosphereMaterial);
      this.atmosphere.renderOrder = 3;
      this.tilt.add(this.atmosphere);
    } else {
      this.atmosphere = null;
    }

    if (rings) {
      const drawn = drawnRingRadii(
        rings.innerRadiusKm / Math.max(options.planetRadiusKm, 1),
        rings.outerRadiusKm / Math.max(options.planetRadiusKm, 1),
      );
      this.ringInner = drawn.inner * radius;
      this.ringOuter = drawn.outer * radius;
      const ringGeo = ringGeometry(this.ringInner, this.ringOuter, 192);
      this.geometries.push(ringGeo);
      this.ringMaterial = new THREE.ShaderMaterial({
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        uniforms: {
          uRingColor: { value: rgb(rings.color) },
          uOpacity: { value: Math.min(Math.max(rings.opacity, 0), 1) },
          uStarDir: { value: new THREE.Vector3(1, 0, 0) },
          uStarColor: { value: new THREE.Color(1, 1, 1) },
          uStarIntensity: { value: 1 },
          uCenter: { value: new THREE.Vector3() },
          uPlanetRadius: { value: radius },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
      });
      this.materials.push(this.ringMaterial);
      this.rings = new THREE.Mesh(ringGeo, this.ringMaterial);
      this.rings.renderOrder = 4;
      this.tilt.add(this.rings);
      this.surfaceMaterial.uniforms.uRingOpacity!.value = Math.min(Math.max(rings.opacity, 0), 1);
      this.surfaceMaterial.uniforms.uRingInner!.value = this.ringInner;
      this.surfaceMaterial.uniforms.uRingOuter!.value = this.ringOuter;
    } else {
      this.rings = null;
      this.ringInner = 0;
      this.ringOuter = 0;
      this.ringMaterial = null;
    }
  }

  /**
   * Scale the drawn world, in place, without moving it.
   *
   * The system view needs a minimum *on-screen* size for a world (a real one is a
   * fraction of a pixel at a camera that fits the orbits); the ring uniforms are in world
   * units, so they have to follow the scale or the ring shadow lands in the wrong place.
   */
  setScale(scale: number): void {
    if (!(scale > 0) || !Number.isFinite(scale)) return;
    if (scale === this.drawnScale) return;
    this.drawnScale = scale;
    this.group.scale.setScalar(scale);
    if (this.ringMaterial) {
      this.ringMaterial.uniforms.uPlanetRadius!.value = this.radius * scale;
      this.surfaceMaterial.uniforms.uRingInner!.value = this.ringInner * scale;
      this.surfaceMaterial.uniforms.uRingOuter!.value = this.ringOuter * scale;
    }
  }

  /** The scale currently applied (1 if never set). */
  get scale(): number {
    return this.drawnScale;
  }

  /** Set the spin phase of the world, in radians (negative = retrograde). */
  setSpin(angle: number): void {
    this.surface.rotation.y = angle;
    if (this.clouds) this.clouds.rotation.y = angle * 1.045 + 0.5;
  }

  /**
   * Per-frame lighting. `center` is the world position of the world's centre, `starDir`
   * points from the world toward the host star, both in world space.
   */
  update(
    center: THREE.Vector3,
    starDir: THREE.Vector3,
    starColor: THREE.Color,
    starIntensity: number,
    time: number,
  ): void {
    this.group.updateWorldMatrix(false, true);
    this.tilt.getWorldQuaternion(this.worldQuat);
    this.ringNormal.set(0, 1, 0).applyQuaternion(this.worldQuat).normalize();

    // White balance: mix the star's tint toward neutral before it lights the world.
    this.balancedLight.copy(starColor).lerp(WHITE, this.lightBalance);
    const light = this.balancedLight;

    const su = this.surfaceMaterial.uniforms;
    (su.uStarDir!.value as THREE.Vector3).copy(starDir).normalize();
    (su.uStarColor!.value as THREE.Color).copy(light);
    su.uStarIntensity!.value = starIntensity;
    (su.uCenter!.value as THREE.Vector3).copy(center);
    (su.uRingNormal!.value as THREE.Vector3).copy(this.ringNormal);

    if (this.cloudMaterial) {
      const cu = this.cloudMaterial.uniforms;
      (cu.uStarDir!.value as THREE.Vector3).copy(starDir).normalize();
      (cu.uStarColor!.value as THREE.Color).copy(light);
      cu.uStarIntensity!.value = starIntensity;
      cu.uTime!.value = time % 1000;
    }

    if (this.atmosphereMaterial) {
      const au = this.atmosphereMaterial.uniforms;
      (au.uStarDir!.value as THREE.Vector3).copy(starDir).normalize();
    }

    if (this.ringMaterial) {
      const ru = this.ringMaterial.uniforms;
      (ru.uStarDir!.value as THREE.Vector3).copy(starDir).normalize();
      (ru.uStarColor!.value as THREE.Color).copy(light);
      ru.uStarIntensity!.value = starIntensity;
      (ru.uCenter!.value as THREE.Vector3).copy(center);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }
}
