/**
 * The galaxy view — the first ten seconds.
 *
 * What the frame must say instantly: a bright nucleus with a smooth cusp, logarithmic
 * arms, dark dust lanes, a warm bulge, cool young light in the arms, and stars that
 * read as *points*. The arms are not invented here: they are the actual
 * `SystemStub.position` values, splatted into a small density map and turned into a
 * soft emission field by a shader. The glow cannot disagree with the stars, because it
 * is a smoothed picture of them.
 *
 * ## What is data and what is decoration
 *  - **Data** (`src/sim`): the systems' positions, colours and brightness. Every
 *    pickable star sprite uses `SystemStub.color`, unchanged in hue, and its true
 *    brightness.
 *  - **Decoration** (this file, seeded): the faint field of unresolved stars and the
 *    H-II knots that fill the arms out, the dust filaments, and the background
 *    starfield. They never move independently of the data and they are never
 *    pickable — they are the long exposure, not new systems.
 *
 * ## Draw calls (budget ≤ 8, including the 4-call post chain)
 *   background starfield (1) · galaxy emission plane (1) · star + field + knots (1) ·
 *   markers (1). Points: a few tens of thousand, far below the 400k budget.
 *
 * ## Why the sprites are not perspective-scaled
 * A star is a point source: its apparent size is the instrument's point-spread
 * function, not its distance. Sizing the sprites in CSS pixels is therefore both the
 * cheaper and the truer choice — zooming the camera in changes what is around the star,
 * never the star into a disc. (The previous version scaled sprites by distance, which
 * is how ten-pixel white discs happened.)
 */

import * as THREE from 'three';
import type { Galaxy, SystemStub } from '../sim/types';
import { mulberry32, hashString } from './rand';
import { GLSL_NOISE } from './glsl';
import { createStarfield, type SkyField } from './sky';
import { GALAXY, chroma, linear } from './palette';

const DENSITY_SIZE = 720;

const DISC_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * The emission plane. Everything here is *light*: the nuclear cusp, the bulge, the arm
 * ridges, the young blue light in them, a little pink star formation, then extinction by
 * dust drawn on top, and finally the galaxy's own faint halo, which is what keeps the
 * sky off pure black.
 */
const DISC_FRAG = /* glsl */ `
${GLSL_NOISE}
uniform sampler2D uDensity;
uniform float uRadius;
uniform float uCoreDensity;
uniform vec3 uNucleusColor;
uniform vec3 uBulgeColor;
uniform vec3 uArmColor;
uniform vec3 uArmEdgeColor;
uniform vec3 uKnotColor;
uniform vec3 uDustColor;
uniform vec3 uHaloColor;
varying vec2 vP;

void main() {
  float r = length(vP) / uRadius;
  if (r > 2.35) discard;
  vec3 fp = vec3(vP.x / uRadius, vP.y / uRadius, 1.31);

  // The galaxy's own halo: a broad, extremely faint gradient. Deliberately not
  // noise-driven, so it can never read as a cloud — it only keeps the background from
  // being a flat void, which is what a photograph of anything looks like.
  float haloShape = exp(-r * 0.95) * (1.0 - smoothstep(0.9, 2.2, r));
  haloShape = max(haloShape, 0.0);
  vec3 halo = uHaloColor * haloShape * 0.016;
  halo += uArmEdgeColor * exp(-r * 2.6) * 0.005 * (1.0 - smoothstep(1.0, 1.6, r));

  // Outside the disc there is nothing but the halo. Cheap path: most of the frame.
  if (r > 1.20) {
    gl_FragColor = vec4(halo, 1.0);
    return;
  }

  vec2 uv = vP / (2.0 * uRadius) + 0.5;
  vec4 density = texture2D(uDensity, uv);
  float armGate = density.r;
  float glowGate = density.g;
  float bulgeTex = density.b;
  float dustGate = density.a;

  // Noise fades out of the nucleus. A cusp is smooth; a noisy cusp is the torn hole the
  // first version of this shader drew.
  float calm = smoothstep(0.012, 0.15, r);
  // Only LOW frequencies belong in the emission. A galaxy's granularity is resolved
  // stars, and those are drawn as sprites in their own draw call; high-frequency noise
  // here would paint ten-pixel soft blobs over them — "snow", the reported defect.
  float cloud = fbm3(fp * vec3(4.2, 5.0, 1.5) + 9.0, 4);
  float mid = fbm3(fp * vec3(11.0, 13.0, 2.6) + 6.0, 3);
  float haze = fbm3(fp * vec3(26.0, 31.0, 4.0) + 4.0, 2);

  // --- nucleus and bulge: closed-form, smooth, warm -------------------------
  float nucleus = exp(-pow(r / 0.018, 1.10));
  float bulge = exp(-pow(r / 0.088, 1.32));
  vec3 colour = uNucleusColor * nucleus * 3.0;
  colour += uBulgeColor * bulge * (0.42 + 0.50 * uCoreDensity);
  colour += uBulgeColor * bulgeTex * 0.09 * smoothstep(0.26, 0.02, r);

  // --- the disc's unresolved light -----------------------------------------
  // A galaxy is a disc, not four strokes: this is what keeps the sky between the arms
  // faintly luminous instead of black.
  vec3 discTint = mix(uBulgeColor, uArmColor, smoothstep(0.06, 0.32, r));
  float discGlow = exp(-r * 3.6) * 0.050 + exp(-r * 2.1) * 0.012;
  colour += discTint * discGlow * (0.50 + 0.80 * cloud) * (0.55 + 0.80 * glowGate);

  // --- arms: a broad band with a soft edge, brightest where it is young -----
  vec3 armTint = mix(mix(uBulgeColor, uArmColor, smoothstep(0.05, 0.20, r)), uArmEdgeColor, smoothstep(0.45, 0.95, r));
  float armEnv = smoothstep(0.10, 0.92, armGate);
  // The arm's own brightness is segmented at a hundred pixels and at fifty: chains of
  // bright complexes with quieter links between them. This is the scale a galaxy's
  // arm structure actually lives at — finer than this and the arm turns to fuzz.
  float seg = smoothstep(0.34, 0.66, cloud);
  float seg2 = smoothstep(0.36, 0.68, mid);
  float armTexture = (0.28 + 1.25 * seg) * (0.60 + 0.60 * seg2) * (0.86 + 0.20 * haze);
  colour += armTint * armEnv * armTexture * 1.45 * calm;
  colour += uArmColor * glowGate * 0.10 * (0.35 + 1.05 * cloud) * calm;

  // --- H-II regions: sparse pink pigment where two clump scales agree ------
  float hii = smoothstep(0.60, 0.86, mid) * smoothstep(0.62, 0.88, haze);
  hii *= smoothstep(0.06, 0.30, glowGate) * smoothstep(0.16, 0.30, r);
  colour += uKnotColor * hii * 0.45;

  // --- extinction ----------------------------------------------------------
  // A dust lane is not a brown fog laid over a galaxy; it is the galaxy's own light not
  // arriving. So dust multiplies the emission down, and adds back almost nothing.
  // The filaments are smooth and multi-scale: a hard threshold on fine noise paints
  // blocks, and blocks were what the first attempt at this looked like.
  float filament = fbm3(fp * vec3(7.5, 9.5, 2.2) + 23.0, 3) * 0.62
                 + fbm3(fp * vec3(21.0, 26.0, 3.6) + 11.0, 2) * 0.38;
  float dust = dustGate * (0.10 + 1.75 * filament * filament);
  dust *= 1.0 - smoothstep(0.80, 1.05, r);
  dust = clamp(dust, 0.0, 0.94);
  colour *= 1.0 - 0.97 * dust;
  colour += uDustColor * dust * 0.05;

  // A gentle outer taper, so the disc does not end on a hard circle.
  colour *= 1.0 - smoothstep(0.80, 1.14, r);

  gl_FragColor = vec4(colour + halo, 1.0);
}
`;

/**
 * Star sprites. `aSize` is in CSS pixels on purpose (see the file header); `aHalo` is
 * how much of the sprite is glow, so a bright star gets a soft halo and a faint one is
 * a single clean point.
 */
const STAR_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aBright;
attribute float aHalo;
uniform float uDpr;
varying vec3 vColor;
varying float vBright;
varying float vHalo;
void main() {
  vColor = aColor;
  vBright = aBright;
  vHalo = aHalo;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = max(aSize, 1.0) * uDpr;
}
`;

const STAR_FRAG = /* glsl */ `
uniform float uGain;
varying vec3 vColor;
varying float vBright;
varying float vHalo;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  // A tight core and a gaussian skirt: two exponentials is all a point source is.
  float core = exp(-d * d * 26.0);
  float skirt = exp(-d * 4.2) * (1.0 - core);
  float profile = core + skirt * (0.06 + 0.6 * vHalo);
  // Soft edge, so a two-pixel sprite is round instead of square.
  profile *= smoothstep(1.0, 0.80, d);
  gl_FragColor = vec4(vColor * profile * vBright * uGain, 1.0);
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
  const sharpWidth = 0.034 + armSpread * 0.022;
  return {
    sharpWidth,
    glowWidth: sharpWidth * 2.0,
    dustWidth: 0.014 + armSpread * 0.010,
    dustOffset: sharpWidth * 0.85,
  };
}

/** Fold an angle difference into [-sector/2, sector/2]. */
function foldToSector(value: number, sector: number): number {
  return value - Math.round(value / sector) * sector;
}

/** The 99.5th percentile of a buffer, sampled (cheap, robust against one bright splat). */
function topValue(buffer: Float32Array, fraction: number): number {
  const step = Math.max(1, Math.floor(buffer.length / 40_000));
  const sample: number[] = [];
  for (let i = 0; i < buffer.length; i += step) sample.push(buffer[i]!);
  sample.sort((a, b) => a - b);
  const index = Math.min(sample.length - 1, Math.floor(sample.length * fraction));
  return Math.max(sample[index] ?? 0, 1e-5);
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
 * Channels: R = arm gate · G = arm glow gate · B = bulge · A = dust gate. These are the
 * gates only — broad, smooth cross-sections. `DISC_FRAG` supplies the clumping and the
 * dust filaments from its own noise fields, so the arm's contrast is tunable in one
 * place instead of being baked into an 8-bit texture.
 *
 * Two things in here exist purely to keep the core honest: the arm envelope starts well
 * outside the nucleus, so nothing arm-shaped ever reaches the cusp; and there is no
 * circumnuclear ring at all. An earlier version painted a noisy one there, and that ring
 * is exactly what scalloped the nucleus in the frame the owner rejected.
 */
function buildDensityTexture(
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

  const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max);

  // The fbm fields above have a narrow natural range; structure needs the full 0..1.
  const stretch = (value: number, lo: number, hi: number): number =>
    Math.min(Math.max((value - lo) / (hi - lo), 0), 1);

  const smooth = (edge0: number, edge1: number, x: number): number => {
    const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
    return t * t * (3 - 2 * t);
  };

  for (let y = 0; y < size; y += 1) {
    const dy = (y / (size - 1) - 0.5) * 2;
    for (let x = 0; x < size; x += 1) {
      const dx = (x / (size - 1) - 0.5) * 2;
      const r = Math.hypot(dx, dy);
      if (r > 1.16) continue;
      const theta = Math.atan2(dy, dx);
      // Shortest angular distance to the nearest arm centreline, then to physical
      // distance across the arm by multiplying by the radius.
      const folded = theta - spiral.phase - spiral.k * Math.log(Math.max(r, 0.024));
      const wrapped = foldToSector(folded, sector);
      const signed = wrapped * Math.max(r, 0.04);
      const across = Math.abs(signed);
      // Arms start OUTSIDE the nucleus and die at the rim. Nothing arm-shaped reaches
      // the cusp: that is the whole difference between a nucleus and a torn hole.
      const envelope = smooth(0.11, 0.30, r) * (1 - smooth(0.70, 0.98, r));
      // The arm's width breathes along its length; a constant width is what made an
      // earlier version read as a painted ribbon.
      const widthMod = 0.62 + 0.78 * valueNoise(theta * 2.6 + 11, r * 7.3 + 5);
      // A real arm is asymmetric: a sharp inner edge where the density wave piles up,
      // feathering outward. A symmetric gaussian is what reads as a painted tube.
      const asym = clamp(0.55 - signed / (sharpWidth * 2.4), 0.06, 1.45);
      // Large-scale segmenting: arms are chains of bright segments with dimmer links.
      const segment = fbm2(x * 0.010 + 31, y * 0.010 + 7, 3);
      const brk = fbm2(x * 0.026 + 17, y * 0.026 + 41, 2);
      const mod = 0.05 + 1.55 * Math.pow(stretch(segment, 0.34, 0.66), 1.5) * (0.30 + 0.95 * stretch(brk, 0.34, 0.66));
      const arm = Math.exp(-Math.pow(across / (sharpWidth * widthMod), 2)) * envelope * asym * mod;
      const soft = Math.exp(-Math.pow(across / (glowWidth * widthMod), 2)) * envelope * (0.4 + 0.8 * segment);

      // The dust lane sits on the inner edge of the arm, where extinction actually is,
      // and is broader than the ridge it cuts.
      const lane = Math.exp(-Math.pow((signed - dustOffset) / dustWidth, 2));
      const laneWide = Math.exp(-Math.pow((signed - dustOffset * 1.6) / (dustWidth * 2.0), 2)) * 0.5;
      // Spurs of dust between the arms: the thing that stops the disc reading as four
      // painted strokes on a clean background. Low frequency on purpose — fine noise
      // here paints black confetti.
      const spur = smooth(0.52, 0.80, segment) * smooth(0.30, 0.66, brk) * 0.85 * smooth(0.12, 0.32, r);

      sharp[y * size + x]! += arm * confidence;
      glow[y * size + x]! += soft * confidence;
      bulge[y * size + x]! += Math.exp(-Math.pow(r / 0.14, 1.10)) * (0.75 + coreDensity * 0.7);
      dust[y * size + x]! += ((lane + laneWide) * envelope * 0.85 + spur * (1 - envelope * 0.5)) * confidence;
    }
  }

  const data = new Uint8Array(size * size * 4);
  const maxSharp = topValue(sharp, 0.999);
  const maxGlow = topValue(glow, 0.999);
  const maxBulge = topValue(bulge, 0.9995);
  const maxDust = topValue(dust, 0.998);
  const grade = (value: number, max: number): number =>
    Math.round(Math.min(1, Math.pow(value / max, 0.62)) * 255);
  for (let i = 0; i < size * size; i += 1) {
    data[i * 4] = grade(sharp[i]!, maxSharp);
    data[i * 4 + 1] = grade(glow[i]!, maxGlow);
    data[i * 4 + 2] = Math.round(Math.min(1, Math.sqrt(bulge[i]! / maxBulge)) * 255);
    data[i * 4 + 3] = grade(dust[i]!, maxDust);
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

    // Background sky: seeded, static, and faint. It is decoration, so it is seeded from
    // the galaxy seed and never touches the generated systems.
    this.sky = createStarfield({
      count: 3600 + Math.min(galaxy.systems.length * 5, 2200),
      radius: this.radius * 9,
      seed: hashString(galaxy.params.seed) ^ 0x51ed27,
      band: 0.34,
      intensity: 0.34,
      sizeRange: [0.6, 1.9],
      tint: GALAXY.sky,
    });
    this.scene.add(this.sky.points);

    this.style = armStyle(galaxy.params.armSpread);
    this.spiral = fitArms(galaxy.systems, this.radius, galaxy.params.arms, galaxy.params.armTwist);
    this.density = buildDensityTexture(
      galaxy.params.arms,
      galaxy.params.coreDensity,
      this.style,
      this.spiral,
    );
    // The plane is much larger than the disc: the far field is the galaxy's faint halo,
    // painted in the same draw call (the galaxy budget has no room for a background
    // pass, and it does not need one).
    this.discGeometry = new THREE.CircleGeometry(this.radius * 2.4, 160);
    this.discMaterial = new THREE.ShaderMaterial({
      vertexShader: DISC_VERT,
      fragmentShader: DISC_FRAG,
      uniforms: {
        uDensity: { value: this.density },
        uRadius: { value: this.radius },
        uCoreDensity: { value: galaxy.params.coreDensity },
        uNucleusColor: { value: linear(GALAXY.nucleus) },
        uBulgeColor: { value: linear(GALAXY.bulge) },
        uArmColor: { value: linear(GALAXY.arm) },
        uArmEdgeColor: { value: linear(GALAXY.armEdge) },
        uKnotColor: { value: linear(GALAXY.hii) },
        uDustColor: { value: linear(GALAXY.dust) },
        uHaloColor: { value: linear(GALAXY.halo) },
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

    this.starGeometry = this.buildSprites();
    this.starMaterial = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: {
        uDpr: { value: 1 },
        uGain: { value: 1.0 },
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

  /**
   * One Points object holds three populations, because the galaxy's budget is three
   * scene draws and this is the third:
   *  - every real system, in its own generated colour, one to three pixels wide;
   *  - a seeded field of unresolved stars that gives the arms their granularity;
   *  - sparse pink H-II knots in the arms.
   */
  private buildSprites(): THREE.BufferGeometry {
    const galaxy = this.galaxy;
    const systems = galaxy.systems;
    const confidence = Math.min(Math.max((this.spiral.concentration - 0.12) / 0.5, 0), 1);
    const sector = (Math.PI * 2) / Math.max(galaxy.params.arms, 1);
    // The field is what gives the arms their grain. A galaxy photograph is a smooth glow
    // plus resolved points, and points are the only thing that reads as stars: shader
    // noise at this scale paints soft blobs instead. 40k points for a 180-system galaxy
    // is a quarter of a percent of the 400k budget.
    const fieldCount = Math.round(Math.min(Math.max(systems.length * 210, 18_000), 70_000));
    const knotCount = Math.round(Math.min(Math.max(systems.length * 2.4, 240), 1200));
    const total = systems.length + fieldCount + knotCount;

    const positions = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const sizes = new Float32Array(total);
    const bright = new Float32Array(total);
    const halo = new Float32Array(total);

    // Which real systems get a visible halo: the brightest 2%, as a photograph would
    // show them. The rest are clean points.
    const ranked = systems
      .map((stub, index) => ({ brightness: stub.brightness, index }))
      .sort((a, b) => b.brightness - a.brightness);
    const haloCut = Math.max(1, Math.round(systems.length * 0.02));
    const haloRank = new Map<number, number>();
    ranked.forEach((entry, rank) => haloRank.set(entry.index, rank));

    const jitter = mulberry32(hashString(`${galaxy.params.seed}:sprites`));
    systems.forEach((stub, i) => {
      this.stars.push({ stub, position: new THREE.Vector3(stub.position.x, stub.position.y, stub.position.z) });
      positions[i * 3] = stub.position.x;
      positions[i * 3 + 1] = stub.position.y;
      positions[i * 3 + 2] = stub.position.z;
      const colour = chroma(stub.color);
      colors[i * 3] = colour[0];
      colors[i * 3 + 1] = colour[1];
      colors[i * 3 + 2] = colour[2];
      const rank = haloRank.get(i) ?? systems.length;
      const isHalo = rank < haloCut;
      // A point source: 1.2–2.6 px, and the brightest few percent a little wider with a
      // skirt. Nothing here may ever reach the size where a star reads as a disc.
      sizes[i] = isHalo ? 2.8 + jitter() * 1.6 : 1.2 + jitter() * 1.1;
      halo[i] = isHalo ? 1 : 0.10 + jitter() * 0.18;
      bright[i] = (isHalo ? 1.0 : 0.45) + stub.brightness * 0.95;
    });

    // The field: unresolved stars, sampled on the fitted arms. They are dimmer than any
    // real system, so a `SystemStub` is always the brighter thing at its own position.
    const rng = mulberry32(hashString(`${galaxy.params.seed}:field`));
    const gauss = (): number => (rng() + rng() + rng() - 1.5) / 1.5;
    let field = 0;
    let guard = 0;
    while (field < fieldCount && guard < fieldCount * 3) {
      guard += 1;
      // Radial profile: the disc's surface brightness falls off outward.
      const r = 0.055 + 0.965 * Math.pow(rng(), 0.62);
      const arm = Math.floor(rng() * galaxy.params.arms);
      const spreadArc = (0.010 + galaxy.params.armSpread * 0.020) * gauss();
      const arc = Math.abs(spreadArc);
      // Leave the dust lane empty, or the lane reads as a painted stripe rather than a
      // gap in the light.
      if (
        confidence > 0.2 &&
        arc > this.style.dustOffset - this.style.dustWidth &&
        arc < this.style.dustOffset + this.style.dustWidth &&
        rng() < 0.82
      ) {
        continue;
      }
      // A quarter of the field is inter-arm disc: a galaxy is a disc, not four ribbons.
      const interarm = rng() < 0.18;
      const i = systems.length + field;
      field += 1;
      const theta = interarm
        ? rng() * Math.PI * 2
        : this.spiral.phase + arm * sector + this.spiral.k * Math.log(Math.max(r, 0.02)) + spreadArc / Math.max(r, 0.07);
      const radius = this.radius * (r + (rng() - 0.5) * 0.012);
      positions[i * 3] = Math.cos(theta) * radius;
      positions[i * 3 + 1] = (rng() - 0.5) * this.radius * 0.009 * (1 - r * 0.6);
      positions[i * 3 + 2] = Math.sin(theta) * radius;

      if (interarm) {
        // Old, dim, warm: the disc's background population.
        const warm = chroma(rng() < 0.5 ? GALAXY.bulge : GALAXY.disc);
        colors[i * 3] = warm[0];
        colors[i * 3 + 1] = warm[1];
        colors[i * 3 + 2] = warm[2];
      } else {
        // Young and blue-white, cooler toward the rim.
        const young = chroma(rng() < 0.30 ? GALAXY.arm : GALAXY.armEdge);
        colors[i * 3] = young[0];
        colors[i * 3 + 1] = young[1];
        colors[i * 3 + 2] = young[2];
      }
      sizes[i] = 0.95 + rng() * 0.85;
      halo[i] = 0.04 + rng() * 0.10;
      // A few percent of the field is genuinely bright: the young supergiants that make
      // a galaxy's arms glitter instead of glowing evenly.
      const flare = rng() < 0.03;
      bright[i] = (0.14 + Math.pow(rng(), 2.4) * 0.42) * (0.55 + 0.45 * Math.max(confidence, 0.6));
      if (flare) {
        bright[i] = bright[i]! * 2.4;
        sizes[i] = 1.6 + rng() * 1.0;
        halo[i] = 0.55;
      }
      if (interarm) bright[i] = bright[i]! * 0.55;
    }

    // H-II knots: pink star-forming clusters. Sparse on purpose — a galaxy speckled
    // evenly with pink reads as confetti.
    for (let k = 0; k < knotCount; k += 1) {
      const i = systems.length + fieldCount + k;
      const r = 0.14 + rng() * 0.78;
      const arm = Math.floor(rng() * galaxy.params.arms);
      const side = rng() < 0.5 ? -1 : 1;
      const spreadArc = side * (0.002 + rng() * 0.014);
      const theta = this.spiral.phase + arm * sector + this.spiral.k * Math.log(Math.max(r, 0.02)) + spreadArc / Math.max(r, 0.07);
      const radius = this.radius * (r + (rng() - 0.5) * 0.008);
      positions[i * 3] = Math.cos(theta) * radius;
      positions[i * 3 + 1] = (rng() - 0.5) * this.radius * 0.007;
      positions[i * 3 + 2] = Math.sin(theta) * radius;
      const pink = chroma(GALAXY.hii);
      const warm = 0.88 + rng() * 0.12;
      colors[i * 3] = pink[0] * warm;
      colors[i * 3 + 1] = pink[1] * warm;
      colors[i * 3 + 2] = pink[2] * warm;
      sizes[i] = 2.0 + rng() * 3.0;
      halo[i] = 1.0;
      bright[i] = (0.55 + rng() * 1.05) * (0.5 + 0.5 * Math.max(confidence, 0.5));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    geometry.setAttribute('aHalo', new THREE.BufferAttribute(halo, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 2);
    return geometry;
  }

  /** Position of a stub in galaxy units, or null when it is not part of this galaxy. */
  systemPosition(id: string): THREE.Vector3 | null {
    const found = this.stars.find((s) => s.stub.id === id);
    return found ? found.position : null;
  }

  setDpr(dpr: number): void {
    this.sky.setDpr(dpr);
    this.starMaterial.uniforms.uDpr!.value = dpr;
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
