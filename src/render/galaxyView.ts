/**
 * The galaxy view — the first ten seconds.
 *
 * What the frame must say instantly: a bright core, logarithmic arms, dark dust lanes,
 * and hundreds of individually coloured stars. The arms are not invented here: they
 * are the *actual* `SystemStub.position` values, splatted into a small density map and
 * turned into a soft emission field by a shader. That is the whole trick — the glow
 * cannot disagree with the stars, because it is a smoothed picture of them.
 *
 * Draw calls (budget ≤ 8, including the 4-call post chain):
 *   background starfield (1) · galaxy emission plane (1) · star sprites (1) · markers (1)
 *
 * Points (budget ≤ 400 000): a few hundred stars + a few thousand background stars.
 */

import * as THREE from 'three';
import type { Galaxy, SystemStub } from '../sim/types';
import { mulberry32, hashString } from './rand';
import { GLSL_NOISE } from './glsl';
import { createStarfield, type SkyField } from './sky';

const DENSITY_SIZE = 640;

const DISC_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DISC_FRAG = /* glsl */ `
${GLSL_NOISE}
uniform sampler2D uDensity;
uniform float uRadius;
uniform float uCoreDensity;
uniform vec3 uCoreColor;
uniform vec3 uArmColor;
uniform vec3 uHazeColor;
uniform vec3 uDustColor;
varying vec2 vP;

vec2 rotate2(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

void main() {
  float r = length(vP) / uRadius;
  if (r > 1.2) discard;

  vec2 uv = vP / (2.0 * uRadius) + 0.5;
  vec4 density = texture2D(uDensity, uv);
  float arms = density.r;
  float armGlow = density.g;
  float bulge = density.b;
  float dustMap = density.a;

  vec3 fp = vec3(vP.x / uRadius, vP.y / uRadius, 1.31);
  float filament = fbm3(fp * vec3(11.0, 14.0, 2.6) + 3.0, 4);
  float dust = smoothstep(0.06, 0.80, dustMap) * (0.30 + 0.95 * filament);
  dust *= smoothstep(0.03, 0.12, r) * (1.0 - smoothstep(0.74, 1.02, r));

  // Core: an exponential bulge plus the splatted light of the inner stars.
  float coreGlow = exp(-pow(max(r, 0.0), 1.18) * 11.0) * (0.5 + 0.8 * uCoreDensity);
  coreGlow += bulge * 0.36;

  vec3 inner = uCoreColor;
  vec3 outer = uArmColor;
  vec3 tint = mix(inner, outer, smoothstep(0.03, 0.62, r));

  // Fine clumping is what separates a nebula from an airbrushed gradient.
  float cloud = fbm3(fp * vec3(5.0, 6.2, 1.7) + 9.0, 4);
  float midClump = fbm3(fp * vec3(16.0, 20.0, 3.0) + 6.0, 3);
  float clump = fbm3(fp * vec3(34.0, 41.0, 5.0) + 4.0, 3);
  float grain = fbm3(fp * vec3(78.0, 92.0, 9.0) + 2.0, 2);
  float armsAmt = smoothstep(0.02, 0.52, arms) * (0.55 + 0.95 * cloud) * (0.82 + 0.32 * clump);
  vec3 color = inner * coreGlow;
  color += tint * (armsAmt * 0.34 + armGlow * 0.17);
  color += uHazeColor * armGlow * clump * 0.10;
  // Unresolved disc light between the arms: a galaxy is a disc, not four painted
  // strokes. This is what keeps the inter-arm sky faintly luminous instead of black.
  color += uArmColor * (0.05 + 0.045 * armGlow) * exp(-r * 1.8) * (0.55 + 0.7 * cloud);
  // Star-forming regions: rare pink knots where a slow clump, a fine clump and an arm
  // all agree. Sparse on purpose — a galaxy speckled evenly with pink reads as confetti.
  float hii = smoothstep(0.70, 0.90, midClump) * smoothstep(0.72, 0.94, grain) * smoothstep(0.25, 0.5, armGlow);
  color += vec3(1.0, 0.40, 0.52) * hii * 0.30;
  color += uCoreColor * exp(-r * r * 2600.0) * 3.4;
  color += uArmColor * armGlow * 0.014;

  // Extinction. Dust is drawn by removing light: a lane is not a brown fog on top of a
  // galaxy, it is the galaxy's own light not reaching the camera.
  color *= 1.0 - clamp(dust, 0.0, 1.0) * 0.78;
  color += uDustColor * dust * 0.12;

  // A gentle outer taper, so the disc does not end on a hard circle.
  color *= 1.0 - smoothstep(0.82, 1.14, r);

  gl_FragColor = vec4(color, 1.0);
}
`;

const STAR_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aBrightness;
uniform float uPixelScale;
varying vec3 vColor;
varying float vBrightness;
void main() {
  vColor = aColor;
  vBrightness = aBrightness;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float distance = max(-mvPosition.z, 0.001);
  float size = aSize * uPixelScale / distance;
  gl_PointSize = clamp(size, 1.5, 100.0);
}
`;

const STAR_FRAG = /* glsl */ `
uniform float uGain;
varying vec3 vColor;
varying float vBrightness;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * 26.0);
  float halo = exp(-d * 5.0) * 0.13 * (1.0 - core);
  float spike = smoothstep(0.6, 0.95, vBrightness) * 0.12;
  spike *= exp(-abs(c.x) * 70.0) * smoothstep(0.5, 0.05, abs(c.y));
  spike += exp(-abs(c.y) * 70.0) * smoothstep(0.5, 0.05, abs(c.x)) * smoothstep(0.6, 0.95, vBrightness) * 0.12;
  vec3 color = vColor * (core * 2.2 + halo * 1.0 + spike) + vec3(0.06) * core * core;
  gl_FragColor = vec4(color * uGain * vBrightness, 1.0);
}
`;

export interface GalaxyStar {
  readonly stub: SystemStub;
  readonly position: THREE.Vector3;
}

/**
 * Fit the arm geometry to the star sample.
 *
 * The galaxy's stars are the only truth we have about where its arms are. The
 * generator lays them on a logarithmic spiral, but the renderer is not allowed to
 * assume the generator's exact formula. So we recover it: for each candidate winding
 * rate k, fold every star's angle by `arms` around `theta - k ln r` and measure how
 * sharply the sample concentrates. The winning k and phase describe the arms that the
 * stars actually form. If nothing concentrates (a generator that does not use arms),
 * the renderer falls back to the parameters it *was* given and paints a faint disc,
 * never a false spiral.
 */
function fitArms(
  systems: readonly SystemStub[],
  galaxyRadius: number,
  arms: number,
  fallbackTwist: number,
): { k: number; phase: number; concentration: number } {
  let best = { k: fallbackTwist, phase: 0, concentration: 0 };
  let bestScore = -1;
  for (let k = -3; k <= 3.0001; k += 0.05) {
    let re = 0;
    let im = 0;
    let weight = 0;
    for (const system of systems) {
      const r = Math.hypot(system.position.x, system.position.z) / galaxyRadius;
      if (r < 0.03 || r > 1.05) continue;
      const w = 0.35 + system.brightness;
      const a = Math.atan2(system.position.z, system.position.x) - k * Math.log(Math.max(r, 0.02));
      re += w * Math.cos(arms * a);
      im += w * Math.sin(arms * a);
      weight += w;
    }
    if (weight <= 0) continue;
    const score = Math.hypot(re, im) / weight;
    if (score > bestScore) {
      bestScore = score;
      best = { k, phase: Math.atan2(im, re) / arms, concentration: score };
    }
  }
  return best;
}

/**
 * The arm cross-section constants, in galaxy-radius units. One definition, used by both
 * the painted density map and the seeded sparkle points that fill the arms, so the dust
 * lane and the points that avoid it cannot drift apart.
 */
interface ArmStyle {
  readonly sharpWidth: number;
  readonly glowWidth: number;
  readonly dustWidth: number;
  readonly dustOffset: number;
}

function armStyle(armSpread: number): ArmStyle {
  const sharpWidth = 0.030 + armSpread * 0.020;
  return {
    sharpWidth,
    glowWidth: sharpWidth * 2.4,
    dustWidth: 0.010 + armSpread * 0.008,
    dustOffset: sharpWidth * 0.85,
  };
}

/** Fold an angle difference into [-sector/2, sector/2]. */
function foldToSector(value: number, sector: number): number {
  return value - Math.round(value / sector) * sector;
}

/**
 * Build the 8-bit RGBA density map: the galaxy's *unresolved light*.
 *
 * A galaxy is not a scatter of points: it is arms, and arms are continuous. With a
 * few hundred stars, a per-star splat gives polka dots (the first version of this file
 * did exactly that, and the screenshot proved it). This function therefore paints the
 * arms on the fitted spiral, adds the actual stars as small bright knots inside them,
 * and keeps a broad haze from the star sample. The result is still a picture *of the
 * stars we were given* — no star positions are invented — but the light between them
 * is filled in like a long exposure.
 *
 * Channels: R = sharp arms · G = soft arm glow · B = bulge · A = dust lanes.
 *
 * The dust lane is painted as a narrow band on the inner edge of each arm, which is
 * where extinction actually sits. It is a lookup table for the shader's extinction
 * term, not a second copy of the arm geometry.
 */
function buildDensityTexture(
  systems: readonly SystemStub[],
  galaxyRadius: number,
  arms: number,
  coreDensity: number,
  style: ArmStyle,
  spiral: { k: number; phase: number; concentration: number },
): THREE.DataTexture {
  const size = DENSITY_SIZE;
  const sharp = new Float32Array(size * size);
  const glow = new Float32Array(size * size);
  const bulge = new Float32Array(size * size);
  const dust = new Float32Array(size * size);

  // A weak fit means the star sample does not contain arms we can trust; keep the glow
  // faint rather than inventing structure.
  const confidence = Math.min(Math.max((spiral.concentration - 0.12) / 0.5, 0), 1);
  const { sharpWidth, glowWidth, dustWidth, dustOffset } = style;
  const sector = (Math.PI * 2) / Math.max(arms, 1);

  // A small deterministic value-noise for the dust's patchiness. Seeded decoration, not
  // content: it breaks a painted lane into filaments and clumps.
  const hash = (x: number, y: number): number => {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };
  const valueNoise = (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
  const fbm2 = (x: number, y: number, octaves: number): number => {
    let amplitude = 0.5;
    let sum = 0;
    let norm = 0;
    let px = x;
    let py = y;
    for (let i = 0; i < octaves; i += 1) {
      sum += amplitude * valueNoise(px, py);
      norm += amplitude;
      px = px * 2.03 + 17.1;
      py = py * 2.03 + 9.7;
      amplitude *= 0.5;
    }
    return sum / Math.max(norm, 1e-5);
  };

  const smooth = (edge0: number, edge1: number, x: number): number => {
    const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
    return t * t * (3 - 2 * t);
  };

  for (let y = 0; y < size; y += 1) {
    const dy = (y / (size - 1) - 0.5) * 2;
    for (let x = 0; x < size; x += 1) {
      const dx = (x / (size - 1) - 0.5) * 2;
      const r = Math.hypot(dx, dy);
      if (r > 1.18) continue;
      const theta = Math.atan2(dy, dx);
      // Shortest angular distance to the nearest arm centreline, then to physical
      // distance across the arm by multiplying by the radius.
      const folded = theta - spiral.phase - spiral.k * Math.log(Math.max(r, 0.024));
      const wrapped = foldToSector(folded, sector);
      const signed = wrapped * Math.max(r, 0.04);
      const across = Math.abs(signed);
      const envelope = smooth(0.02, 0.18, r) * (1 - smooth(0.68, 0.98, r));
      const widthMod = 0.68 + 0.62 * valueNoise(theta * 3.1 + 11, r * 9.3 + 5);
      const arm = Math.exp(-Math.pow(across / (sharpWidth * widthMod), 2)) * envelope;
      const soft = Math.exp(-Math.pow(across / (glowWidth * widthMod), 2)) * envelope;

      // Three scales of cloud structure: the broad patches that make an arm bright in
      // places, the mid-scale breaks, and the fine grain. This is the difference between
      // a painted ribbon and something that looks like gas.
      const cloud = fbm2(x * 0.028 + 11, y * 0.028 + 5, 3);
      const mid = fbm2(x * 0.085 + 3, y * 0.085 + 23, 2);
      const grain = fbm2(x * 0.20 + 7, y * 0.20 + 13, 2);
      const patch = 0.28 + 1.30 * cloud * cloud * (0.45 + 0.8 * mid) * (0.82 + 0.38 * grain);

      const lane = Math.exp(-Math.pow((signed - dustOffset) / dustWidth, 2));
      const laneWide = Math.exp(-Math.pow((signed - dustOffset * 1.75) / (dustWidth * 1.6), 2)) * 0.6;
      const laneMask = lane + laneWide;
      const dustClump = laneMask * (0.22 + 1.5 * cloud) * (0.35 + 1.0 * mid) * (0.55 + 0.7 * grain);
      const dustPatch = arm * smooth(0.55, 0.85, grain) * 0.5;

      sharp[y * size + x]! += arm * patch * confidence;
      glow[y * size + x]! += (soft * (0.35 + 0.9 * cloud) + arm * 0.16) * confidence;
      bulge[y * size + x]! += Math.exp(-r * r * 70) * (0.7 + coreDensity * 0.8);
      dust[y * size + x]! += (dustClump * envelope + dustPatch) * confidence;

      // A circumnuclear dust ring: the dark loop that makes a bright core read as a
      // galaxy core rather than a lamp.
      const ringR = 0.135 + 0.012 * Math.sin(theta * 5 + 1.7);
      const ring = Math.exp(-Math.pow((r - ringR) / 0.026, 2)) * (0.55 + 0.45 * valueNoise(theta * 4 + 2, r * 20));
      dust[y * size + x]! += ring * 0.9;
    }
  }

  // Resolved stars: small bright knots inside the arms, and the broad haze of the
  // sample. These come from the actual positions, so the star sprites and the glow
  // can never drift apart.
  const splat = (buffer: Float32Array, u: number, v: number, sigma: number, weight: number): void => {
    const px = u * (size - 1);
    const py = v * (size - 1);
    const reach = Math.ceil(sigma * 3);
    const x0 = Math.max(0, Math.floor(px) - reach);
    const x1 = Math.min(size - 1, Math.floor(px) + reach);
    const y0 = Math.max(0, Math.floor(py) - reach);
    const y1 = Math.min(size - 1, Math.floor(py) + reach);
    const denom = 2 * sigma * sigma;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const ddx = x - px;
        const ddy = y - py;
        const falloff = Math.exp(-(ddx * ddx + ddy * ddy) / denom);
        if (falloff > 0.0006) buffer[y * size + x]! += falloff * weight;
      }
    }
  };

  for (const system of systems) {
    const u = system.position.x / galaxyRadius * 0.5 + 0.5;
    const v = system.position.z / galaxyRadius * 0.5 + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) continue;
    const weight = 0.4 + system.brightness * 1.2;
    splat(sharp, u, v, 1.3, weight * 0.55);
  }

  const maxOf = (buffer: Float32Array): number => {
    let max = 0;
    for (let i = 0; i < buffer.length; i += 1) max = Math.max(max, buffer[i]!);
    return Math.max(max, 1e-5);
  };
  const maxSharp = maxOf(sharp);
  const maxGlow = maxOf(glow);
  const maxBulge = maxOf(bulge);
  const maxDust = maxOf(dust);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    // sqrt grades the sparse peaks into an arm; linear values make 24 stars look like dots.
    data[i * 4] = Math.round(Math.min(1, Math.sqrt(sharp[i]! / maxSharp)) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, Math.sqrt(glow[i]! / maxGlow)) * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, Math.sqrt(bulge[i]! / maxBulge)) * 255);
    data[i * 4 + 3] = Math.round(Math.min(1, Math.sqrt(dust[i]! / maxDust)) * 255);
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  texture.name = 'galaxy-density';
  return texture;
}

export class GalaxyView {
  readonly scene = new THREE.Scene();
  readonly galaxy: Galaxy;
  readonly stars: GalaxyStar[] = [];
  readonly radius: number;
  private readonly sky: SkyField;
  private readonly disc: THREE.Mesh;
  private readonly discGeometry: THREE.CircleGeometry;
  private readonly discMaterial: THREE.ShaderMaterial;
  private readonly density: THREE.DataTexture;
  private readonly starGeometry: THREE.BufferGeometry;
  private readonly starMaterial: THREE.ShaderMaterial;
  private readonly starPoints: THREE.Points;
  private readonly spiral: { k: number; phase: number; concentration: number };
  private readonly style: ArmStyle;

  constructor(galaxy: Galaxy) {
    this.galaxy = galaxy;
    this.radius = galaxy.params.galaxyRadius;
    this.scene.background = new THREE.Color(0x000000);

    this.sky = createStarfield({
      count: 4200 + Math.min(galaxy.systems.length * 6, 2600),
      radius: this.radius * 9,
      seed: hashString(galaxy.params.seed) ^ 0x51ed27,
      band: 0.42,
      intensity: 0.7,
      sizeRange: [0.6, 2.2],
    });
    this.scene.add(this.sky.points);

    this.style = armStyle(galaxy.params.armSpread);
    this.spiral = fitArms(galaxy.systems, this.radius, galaxy.params.arms, galaxy.params.armTwist);
    this.density = buildDensityTexture(
      galaxy.systems,
      this.radius,
      galaxy.params.arms,
      galaxy.params.coreDensity,
      this.style,
      this.spiral,
    );
    this.discGeometry = new THREE.CircleGeometry(this.radius * 1.32, 200);
    this.discMaterial = new THREE.ShaderMaterial({
      vertexShader: DISC_VERT,
      fragmentShader: DISC_FRAG,
      uniforms: {
        uDensity: { value: this.density },
        uRadius: { value: this.radius },
        uCoreDensity: { value: galaxy.params.coreDensity },
        uCoreColor: { value: new THREE.Color(1.0, 0.78, 0.48) },
        uArmColor: { value: new THREE.Color(0.55, 0.68, 1.0) },
        uHazeColor: { value: new THREE.Color(0.42, 0.30, 0.72) },
        uDustColor: { value: new THREE.Color(0.26, 0.15, 0.09) },
      },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.disc = new THREE.Mesh(this.discGeometry, this.discMaterial);
    this.disc.rotation.x = Math.PI / 2;
    this.disc.position.y = -0.002 * this.radius;
    this.disc.renderOrder = -50;
    this.disc.frustumCulled = false;
    this.scene.add(this.disc);

    // Real systems are pickable; the seeded sparkle points are unresolved starlight and
    // star-forming knots painted along the arms the sample itself describes. They share
    // the stars' draw call, because the galaxy view's budget of 8 is for everything.
    const sparkleCount = 4800;
    const total = galaxy.systems.length + sparkleCount;
    const positions = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const sizes = new Float32Array(total);
    const brightness = new Float32Array(total);
    const rng = mulberry32(hashString(`${galaxy.params.seed}:stars`));
    const confidence = Math.min(Math.max((this.spiral.concentration - 0.12) / 0.5, 0), 1);
    const sector = (Math.PI * 2) / Math.max(galaxy.params.arms, 1);

    galaxy.systems.forEach((stub, i) => {
      this.stars.push({ stub, position: new THREE.Vector3(stub.position.x, stub.position.y, stub.position.z) });
      positions[i * 3] = stub.position.x;
      positions[i * 3 + 1] = stub.position.y;
      positions[i * 3 + 2] = stub.position.z;
      colors[i * 3] = stub.color[0];
      colors[i * 3 + 1] = stub.color[1];
      colors[i * 3 + 2] = stub.color[2];
      // The size carries brightness, but a little seeded variation keeps a row of equal
      // spectral classes from looking stamped.
      const jitter = 0.7 + Math.pow(rng(), 2.2) * 1.7;
      sizes[i] = this.radius * (0.0010 + 0.0031 * Math.pow(stub.brightness, 1.4)) * jitter;
      brightness[i] = 0.9 + stub.brightness * 2.4;
    });

    const galaxyRng = mulberry32(hashString(`${galaxy.params.seed}:sparkle`));
    const gauss = (): number => (galaxyRng() + galaxyRng() + galaxyRng() - 1.5) / 1.5;
    let sparkle = 0;
    let guard = 0;
    while (sparkle < sparkleCount && guard < sparkleCount * 3) {
      guard += 1;
      const r = 0.07 + 0.92 * Math.pow(galaxyRng(), 0.72);
      const arm = Math.floor(galaxyRng() * galaxy.params.arms);
      const spreadArc = (0.012 + galaxy.params.armSpread * 0.02) * gauss();
      const arc = Math.abs(spreadArc);
      const dustAvoid =
        confidence > 0.2 &&
        arc > this.style.dustOffset - this.style.dustWidth &&
        arc < this.style.dustOffset + this.style.dustWidth;
      if (dustAvoid && galaxyRng() < 0.72) {
        // A gap in the sparkle inside the dust lane is what makes the lane read as a
        // lane rather than a painted stripe.
        continue;
      }
      const i = galaxy.systems.length + sparkle;
      sparkle += 1;
      const theta =
        this.spiral.phase + arm * sector + this.spiral.k * Math.log(Math.max(r, 0.02)) + spreadArc / Math.max(r, 0.06);
      const radius = this.radius * (r + (galaxyRng() - 0.5) * 0.012);
      positions[i * 3] = Math.cos(theta) * radius;
      positions[i * 3 + 1] = (galaxyRng() - 0.5) * this.radius * 0.006 * (1 - r * 0.7);
      positions[i * 3 + 2] = Math.sin(theta) * radius;

      const knot = galaxyRng() < 0.055;
      if (knot) {
        // Pink H-II knots: a few bright star-forming clumps along the arms.
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 0.38 + galaxyRng() * 0.18;
        colors[i * 3 + 2] = 0.55 + galaxyRng() * 0.2;
        sizes[i] = this.radius * (0.0008 + galaxyRng() * 0.0012);
        brightness[i] = 0.22 + galaxyRng() * 0.22;
      } else {
        const warm = galaxyRng();
        colors[i * 3] = 0.72 + warm * 0.28;
        colors[i * 3 + 1] = 0.76 + warm * 0.2;
        colors[i * 3 + 2] = 0.92 + galaxyRng() * 0.08;
        sizes[i] = this.radius * (0.0004 + galaxyRng() * 0.0011);
        brightness[i] = 0.03 + Math.pow(galaxyRng(), 2.6) * 0.22;
      }
      // Fade the sparkle population where the arm fit is weak.
      brightness[i] = brightness[i]! * (0.3 + 0.7 * Math.max(confidence, 0.3));
    }

    this.starGeometry = new THREE.BufferGeometry();
    this.starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starGeometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.starGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.starGeometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
    this.starGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 2);
    this.starMaterial = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: {
        uPixelScale: { value: 900 },
        uGain: { value: 1.25 },
      },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.starPoints = new THREE.Points(this.starGeometry, this.starMaterial);
    this.starPoints.frustumCulled = false;
    this.starPoints.renderOrder = 10;
    this.starPoints.name = 'galaxy-stars';
    this.scene.add(this.starPoints);
  }

  /** Position of a stub in galaxy units, or null when it is not part of this galaxy. */
  systemPosition(id: string): THREE.Vector3 | null {
    const found = this.stars.find((s) => s.stub.id === id);
    return found ? found.position : null;
  }


  setDpr(dpr: number): void {
    this.sky.setDpr(dpr);
  }

  /** Recompute the perspective sprite scale after a resize or camera FOV change. */
  setViewport(heightPx: number, fovYDeg: number): void {
    const fov = (fovYDeg * Math.PI) / 180;
    this.starMaterial.uniforms.uPixelScale!.value = heightPx / (2 * Math.tan(fov / 2));
  }

  dispose(): void {
    this.sky.dispose();
    this.discGeometry.dispose();
    this.discMaterial.dispose();
    this.density.dispose();
    this.starGeometry.dispose();
    this.starMaterial.dispose();
    this.scene.clear();
  }
}
