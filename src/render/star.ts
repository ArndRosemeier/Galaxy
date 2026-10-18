/**
 * Stars — one visual for the photosphere and its corona, shared by every view.
 *
 * In the system view the star is the light source and the thing the whole frame is
 * built around: an emissive sphere with limb darkening and slow granulation, plus two
 * camera-facing corona shells (a tight one and a broad one) that the HDR bloom turns
 * into glare. The same shell factory is used for the distant host star in the planet
 * view, so the star you see in the sky is the same star you flew in from.
 *
 * Black holes get the honest treatment the data model implies (`SpectralClass`'s `BH`
 * is "no surface"): a black disc with a photon-ring rim and an accretion glow. There is
 * no attempt to fake lensing geometry.
 */

import * as THREE from 'three';
import type { SpectralClass, Star } from '../sim/types';
import { GLSL_NOISE } from './glsl';

const STAR_VERT = /* glsl */ `
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

const STAR_FRAG = /* glsl */ `
${GLSL_NOISE}
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform int uDark;
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormalWorld;
void main() {
  vec3 p = normalize(vLocal);
  vec3 N = normalize(vNormalWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float mu = clamp(dot(N, V), 0.0, 1.0);

  if (uDark == 1) {
    // Photon ring: the last light that can orbit before the horizon.
    float ring = pow(1.0 - mu, 9.0);
    vec3 col = uColor * ring * 2.6 + uColor * 0.025;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  float granulation = fbm3(p * 7.0 + vec3(uTime * 0.012, 0.0, -uTime * 0.009) + 2.0, 4);
  float spots = smoothstep(0.70, 0.88, fbm3(p * 2.3 + 8.0, 3));
  float limb = pow(mu, 0.42) * 0.78 + 0.22;
  vec3 col = uColor * (0.78 + 0.55 * granulation) * limb * (1.0 - 0.32 * spots) * uIntensity;
  // Chromosphere: a hot fringe where the photosphere turns away.
  col += uColor * pow(1.0 - mu, 5.0) * 0.8;
  gl_FragColor = vec4(col, 1.0);
}
`;

const CORONA_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mvPosition.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const CORONA_FRAG = /* glsl */ `
${GLSL_NOISE}
uniform vec3 uColor;
uniform float uIntensity;
uniform float uSeed;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  float angle = atan(c.y, c.x);

  // A tight core plus a broad halo; ray structure keeps it from looking like a CSS
  // radial gradient. The noise is evaluated once per pixel on an angular coordinate.
  float rays = 0.72 + 0.28 * sin(angle * 17.0 + uSeed) * sin(angle * 7.0 + uSeed * 0.7);
  rays *= 0.85 + 0.30 * vnoise(vec3(angle * 2.2 + uSeed, uTime * 0.03, 0.0));
  float core = exp(-r * 5.4) * 0.95;
  float halo = exp(-r * 1.55) * 0.28;
  float a = (core + halo) * rays * smoothstep(1.0, 0.72, r);
  gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
}
`;

const CORONA_GEOMETRY = new THREE.PlaneGeometry(2, 2);

function coronaMaterial(color: THREE.Color, size: number, intensity: number, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: CORONA_VERT,
    fragmentShader: CORONA_FRAG,
    uniforms: {
      uColor: { value: color },
      uIntensity: { value: intensity },
      uSeed: { value: seed },
      uTime: { value: 0 },
      uSize: { value: size },
    },
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

function isCompact(spectral: SpectralClass): boolean {
  return spectral === 'BH' || spectral === 'NS' || spectral === 'WD';
}

/** A star at the origin of its own group, light included. */
export class StarVisual {
  readonly group = new THREE.Group();
  readonly surface: THREE.Mesh;
  readonly light: THREE.PointLight;
  private readonly surfaceGeometry: THREE.SphereGeometry;
  private readonly surfaceMaterial: THREE.ShaderMaterial;
  private readonly coronaMaterials: THREE.ShaderMaterial[] = [];
  private readonly coronaMeshes: THREE.Mesh[] = [];
  private readonly seed: number;
  private readonly compact: boolean;

  constructor(star: Star, radius: number, detail: 'system' | 'planet' = 'system') {
    this.seed = (star.temperatureK % 97) / 17;
    const color = new THREE.Color(star.color[0], star.color[1], star.color[2]);
    const dark = star.spectral === 'BH' ? 1 : 0;
    this.compact = isCompact(star.spectral);
    const segments = detail === 'planet' ? [48, 32] : [56, 36];

    this.surfaceGeometry = new THREE.SphereGeometry(radius, segments[0]!, segments[1]!);
    this.surfaceMaterial = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: {
        uColor: { value: color },
        uIntensity: { value: this.compact ? 3.6 : 3.1 },
        uTime: { value: 0 },
        uDark: { value: dark },
      },
    });
    this.surface = new THREE.Mesh(this.surfaceGeometry, this.surfaceMaterial);
    this.group.add(this.surface);

    const layers: Array<[number, number]> = this.compact
      ? [[radius * 3.4, 0.8], [radius * 8.0, 0.26]]
      : [[radius * 4.8, 0.95], [radius * 10.5, 0.24]];
    for (const [size, intensity] of layers) {
      const material = coronaMaterial(color, size, intensity, this.seed + size);
      const mesh = new THREE.Mesh(CORONA_GEOMETRY, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.coronaMaterials.push(material);
      this.coronaMeshes.push(mesh);
      this.group.add(mesh);
    }

    this.light = new THREE.PointLight(color, 2.6, 0, 0);
    this.light.decay = 0;
    this.group.add(this.light);
  }

  update(timeSeconds: number): void {
    this.surfaceMaterial.uniforms.uTime!.value = timeSeconds;
    for (const material of this.coronaMaterials) material.uniforms.uTime!.value = timeSeconds;
  }

  dispose(): void {
    this.surfaceGeometry.dispose();
    this.surfaceMaterial.dispose();
    for (const material of this.coronaMaterials) material.dispose();
    this.group.removeFromParent();
  }
}

/**
 * A distant star billboard for the sky of the planet view. One draw call, additive,
 * scaled in world units at `position`.
 */
export function createStarGlow(
  color: THREE.Color,
  size: number,
  intensity = 1.6,
  seed = 0,
): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const material = coronaMaterial(color, size, intensity, seed);
  const mesh = new THREE.Mesh(CORONA_GEOMETRY, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -20;
  return { mesh, material };
}
