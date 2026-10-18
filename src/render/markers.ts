/**
 * Selection and hover affordances.
 *
 * One `Points` object, two vertices: the hover ring and the selection ring. Drawing
 * them as point sprites at a constant CSS size means the affordance is exactly as
 * visible when the camera is 6 galaxy radii out as when it is 4 planet radii out, and
 * costs ONE draw call in every view (the galaxy view's budget is 8, so this matters).
 *
 * The marker is not content: it only says "the thing under this position is the thing
 * you are pointing at / have selected". `src/ui` owns panels and labels.
 */

import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aKind;
uniform float uDpr;
uniform float uHoverSize;
uniform float uSelectSize;
varying float vKind;
void main() {
  vKind = aKind;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = (aKind > 0.5 ? uSelectSize : uHoverSize) * uDpr;
}
`;

const FRAG = /* glsl */ `
varying float vKind;
uniform vec3 uHoverColor;
uniform vec3 uSelectColor;
void main() {
  if (vKind < -0.5) discard;
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;

  if (vKind < 0.5) {
    // Hover: a fine circle plus a soft centre, cool and quiet.
    float ring = exp(-pow((d - 0.42) * 14.0, 2.0)) * 0.55;
    float core = exp(-d * d * 40.0) * 0.35;
    float a = ring + core;
    gl_FragColor = vec4(uHoverColor * a, 1.0);
  } else {
    // Selection: a bright ring, four ticks, and a faint centre dot.
    float ring = exp(-pow((d - 0.78) * 22.0, 2.0));
    float ticks = 0.0;
    ticks += exp(-abs(c.x) * 90.0) * smoothstep(0.92, 0.55, abs(c.y));
    ticks += exp(-abs(c.y) * 90.0) * smoothstep(0.92, 0.55, abs(c.x));
    float dotCore = exp(-d * d * 26.0) * 0.3;
    float a = ring * 0.95 + ticks * 0.5 + dotCore;
    gl_FragColor = vec4(uSelectColor * a, 1.0);
  }
}
`;

export class Markers {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.positions = new Float32Array(6);
    const kinds = new Float32Array([-1, -1]);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uDpr: { value: 1 },
        uHoverSize: { value: 26 },
        uSelectSize: { value: 40 },
        uHoverColor: { value: new THREE.Color(0.55, 0.86, 1.0) },
        uSelectColor: { value: new THREE.Color(1.0, 0.78, 0.42) },
      },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1000;
    this.points.name = 'markers';
  }

  setDpr(dpr: number): void {
    this.material.uniforms.uDpr!.value = dpr;
  }

  private write(index: number, point: THREE.Vector3 | null): void {
    const kind = this.geometry.getAttribute('aKind') as THREE.BufferAttribute;
    if (point) {
      this.positions[index * 3] = point.x;
      this.positions[index * 3 + 1] = point.y;
      this.positions[index * 3 + 2] = point.z;
      kind.setX(index, index === 0 ? 0 : 1);
    } else {
      kind.setX(index, -1);
    }
    kind.needsUpdate = true;
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Slot 0 is hover, slot 1 is selection. `null` hides that slot. */
  set(hover: THREE.Vector3 | null, selection: THREE.Vector3 | null): void {
    this.write(0, hover);
    this.write(1, selection);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
