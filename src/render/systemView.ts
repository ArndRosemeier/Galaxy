/**
 * The system view — flying in.
 *
 * The star is the composition's anchor: an emissive photosphere with a two-shell corona
 * and a real point light, given a floor in *screen* size so it is always the brightest
 * object in the frame (a true star is a fraction of a pixel at a camera that fits a
 * system). The camera fits the **planetary system**, not the belts: a belt can extend
 * three or four times past the outermost planet, and framing it is what made the early
 * frame a ring of boulders with a lost star in the middle.
 *
 * The planets ride the ORBITS THE GENERATOR WROTE: every moving body's position comes
 * from `positionAtAU` or `moonPositionKm` (`src/sim/orbit.ts`), never from a re-derived
 * ellipse. The renderer only exaggerates how big the bodies are *drawn* (see
 * `scales.ts`), never where they are, and it never moves a body to make room.
 *
 * Belts are **point sprites**, one draw call each, capped at `MAX_BELT_BODIES` and sized
 * in pixels: a belt body is 10-1000 km, which is nothing at system scale, so the belt
 * reads as dust. Bodies beyond the planetary frame fade out, so a belt that runs past
 * the edge dissolves instead of ending in a line.
 *
 * Draw calls (budget ≤ 120): star 3 · planets 2-4 each · moons 1-2 each · orbit lines
 * one per planet · belt 1 each · sky 1 · markers 1 · post 4. A six-planet system with
 * two belts lands around 60.
 */

import * as THREE from 'three';
import type { AsteroidBelt, Moon, Planet, StarSystem } from '../sim/types';
import { moonPositionKm, orbitalPeriodDays, positionAtAU } from '../sim/orbit';
import type { CameraPose } from './camera';
import { directionFromAngles } from './camera';
import type { PickTarget, WorldPickable } from './api';
import { screenRadiusPx } from './pick';
import {
  BELT_BODY_MAX_PX,
  BELT_BODY_MIN_PX,
  MAX_BELT_BODIES,
  MAX_PLANET_SCALE,
  MIN_PLANET_RADIUS_PX,
  MIN_STAR_CORONA_PX,
  MIN_STAR_PHOTOSPHERE_PX,
  SYSTEM_FRAME_MARGIN,
  clampVisualRadii,
  exaggeratedRadiusAU,
  moonOrbitVisualAU,
  moonVisualRadiusAU,
  starVisualRadiusAU,
} from './scales';
import { WorldVisual } from './world';
import { StarVisual } from './star';
import { createStarfield, type SkyField } from './sky';
import { AFFORDANCE, linear } from './palette';
import { mulberry32, TAU } from './rand';

const ORBIT_SEGMENTS = 160;

/** Upper bound on a drawn planet's screen radius: a world, not a wall. */
const MAX_PLANET_RADIUS_PX = 26;

const BELT_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
uniform float uDpr;
uniform float uFade0;
uniform float uFade1;
uniform float uInner;
uniform float uOuter;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;
  float radiusAU = length(position.xz);
  float fade = 1.0 - smoothstep(uFade0, uFade1, radiusAU);
  // Soft inner and outer edges, with the concentration in the middle: a belt is a band
  // of debris, not an even sprinkle that happens to stop at two radii.
  float rt = clamp((radiusAU - uInner) / max(uOuter - uInner, 1e-6), 0.0, 1.0);
  float band = smoothstep(0.0, 0.14, rt) * (1.0 - smoothstep(0.80, 1.0, rt)) * (0.45 + 0.75 * sin(3.14159 * rt));
  vColor = aColor;
  vAlpha = aAlpha * fade * band;
  gl_PointSize = aSize * uDpr;
  if (vAlpha < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const BELT_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 3.2) * 0.75 + exp(-d * d * 14.0) * 0.30;
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`;

interface MoonRecord {
  readonly moon: Moon;
  readonly visual: WorldVisual;
  readonly orbitAU: number;
  readonly radiusAU: number;
  readonly position: THREE.Vector3;
}

interface PlanetRecord {
  readonly planet: Planet;
  readonly visual: WorldVisual;
  readonly radiusAU: number;
  readonly orbitLine: THREE.LineLoop;
  readonly orbitMaterial: THREE.LineBasicMaterial;
  readonly position: THREE.Vector3;
  readonly moons: MoonRecord[];
}

interface BeltRecord {
  readonly belt: AsteroidBelt;
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  readonly meanMotion: number;
}

function emptyOrbitGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ORBIT_SEGMENTS * 3), 3));
  return geometry;
}

export class SystemView {
  readonly scene = new THREE.Scene();
  readonly system: StarSystem;
  readonly starColor: THREE.Color;
  readonly starRadius: number;
  /** Radius of the planetary system (outermost planet's aphelion, with margin). */
  readonly frameAU: number;
  /** Radius of everything in the system, belts included. Used for far planes and limits. */
  readonly outerAU: number;
  readonly starPosition = new THREE.Vector3(0, 0, 0);
  private readonly star: StarVisual;
  private readonly sky: SkyField;
  private readonly planets: PlanetRecord[] = [];
  private readonly belts: BeltRecord[] = [];
  private readonly geometryDisposals: THREE.BufferGeometry[] = [];
  private readonly materialDisposals: THREE.Material[] = [];

  constructor(system: StarSystem, timeDays: number, dpr: number) {
    this.system = system;
    this.scene.background = new THREE.Color(0x000000);
    this.starColor = new THREE.Color(system.star.color[0], system.star.color[1], system.star.color[2]);

    const innerOrbit = Math.min(
      ...system.planets.map((p) => p.orbit.semiMajorAU),
      ...system.belts.map((b) => b.innerAU),
      Number.POSITIVE_INFINITY,
    );
    const innermost = Number.isFinite(innerOrbit) ? innerOrbit : 1;
    this.starRadius = starVisualRadiusAU(system.star.radiusSun, innermost);

    const visualRadii = clampVisualRadii(
      system.planets.map((p) => ({
        semiMajorAU: p.orbit.semiMajorAU,
        radiusAU: exaggeratedRadiusAU(p.radiusKm),
      })),
    );

    const planetOuter = Math.max(
      0,
      ...system.planets.map((p) => p.orbit.semiMajorAU * (1 + p.orbit.eccentricity)),
    );
    const beltOuter = Math.max(0, ...system.belts.map((b) => b.outerAU));
    // The frame is the planetary system. A belt is allowed to run off it — that is what
    // the fade is for — but it is never allowed to define the composition.
    this.frameAU = Math.max(planetOuter * SYSTEM_FRAME_MARGIN, innermost * 2.4, this.starRadius * 6);
    this.outerAU = Math.max(planetOuter, beltOuter, this.frameAU) * 1.08;

    this.star = new StarVisual(system.star, this.starRadius);
    this.scene.add(this.star.group);

    this.sky = createStarfield({
      count: 2200,
      radius: this.outerAU * 14,
      seed: system.seed ^ 0x2f7a1b,
      band: 0.3,
      intensity: 0.5,
      sizeRange: [0.6, 2.0],
      tint: [0.55, 0.62, 0.78],
    });
    this.scene.add(this.sky.points);

    system.planets.forEach((planet, index) => {
      const radiusAU = visualRadii[index] ?? exaggeratedRadiusAU(planet.radiusKm);
      const visual = new WorldVisual({
        surface: planet.surface,
        radius: radiusAU,
        detail: 'system',
        atmosphere: planet.atmosphere,
        rings: planet.rings,
        coverage: planet.hydrosphere ? planet.hydrosphere.coverage : 0,
        planetRadiusKm: planet.radiusKm,
        temperatureK: planet.temperatureK,
        id: planet.id,
        clouds: true,
      });
      this.scene.add(visual.group);

      const orbitGeometry = emptyOrbitGeometry();
      this.geometryDisposals.push(orbitGeometry);
      const orbitMaterial = new THREE.LineBasicMaterial({
        color: linear(AFFORDANCE.orbit),
        transparent: true,
        opacity: 0.30,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.materialDisposals.push(orbitMaterial);
      const orbitLine = new THREE.LineLoop(orbitGeometry, orbitMaterial);
      orbitLine.frustumCulled = false;
      this.scene.add(orbitLine);

      const moons: MoonRecord[] = [];
      const sortedMoons = [...planet.moons].sort((a, b) => a.orbit.radiusKm - b.orbit.radiusKm);
      sortedMoons.forEach((moon, rank) => {
        const orbitAU = moonOrbitVisualAU(radiusAU, rank, sortedMoons.length);
        const moonRadiusAU = moonVisualRadiusAU(moon.radiusKm, orbitAU);
        const moonVisual = new WorldVisual({
          surface: moon.surface,
          radius: moonRadiusAU,
          detail: 'system',
          atmosphere: moon.atmosphere,
          rings: null,
          coverage: moon.surface.colors.water ? 0.5 : 0,
          planetRadiusKm: moon.radiusKm,
          temperatureK: null,
          id: moon.id,
          clouds: false,
        });
        this.scene.add(moonVisual.group);
        moons.push({ moon, visual: moonVisual, orbitAU, radiusAU: moonRadiusAU, position: new THREE.Vector3() });
      });

      const record: PlanetRecord = {
        planet,
        visual,
        radiusAU,
        orbitLine,
        orbitMaterial,
        position: new THREE.Vector3(),
        moons,
      };
      this.planets.push(record);

      const positions = orbitGeometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < ORBIT_SEGMENTS; k += 1) {
        const t = (k / ORBIT_SEGMENTS) * planet.orbit.periodDays;
        const p = positionAtAU(planet.orbit, t);
        positions.setXYZ(k, p.x, p.y, p.z);
      }
      positions.needsUpdate = true;
      orbitGeometry.computeBoundingSphere();
    });

    for (const belt of system.belts) {
      const record = this.buildBelt(belt);
      if (record) this.belts.push(record);
    }

    this.setTime(timeDays);
    this.setDpr(dpr);
  }

  /**
   * A belt of minor bodies as one cloud of point sprites.
   *
   * The bodies keep their generated radial distribution, inclination scatter and count;
   * what changes from the data is only the *drawn* size — a fixed 1-3 pixels, because a
   * belt body that scales with the frame becomes a boulder.
   */
  private buildBelt(belt: AsteroidBelt): BeltRecord | null {
    const span = belt.outerAU - belt.innerAU;
    if (!(span > 0)) return null;
    const density = Math.min(Math.max(belt.density, 0), 1);
    const count = Math.min(Math.floor(belt.count * (0.55 + 0.7 * density)), MAX_BELT_BODIES);
    if (count <= 0) return null;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const rng = mulberry32(belt.seed ^ 0x6d2b79f5);
    const inclination = (belt.inclinationDeg * Math.PI) / 180;

    for (let i = 0; i < count; i += 1) {
      // Triangular radial distribution: belts are denser in the middle than at the edges.
      const t = (rng() + rng()) * 0.5;
      const radius = belt.innerAU + span * t;
      const angle = rng() * TAU;
      const spread = (rng() - 0.5) * Math.sin(inclination) * radius * 0.9;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = spread;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      // Low-contrast grey-brown. A belt is debris seen in reflected starlight, not a
      // collection of rock-coloured boulders.
      const shade = 0.42 + rng() * 0.5;
      colors[i * 3] = 0.50 * shade;
      colors[i * 3 + 1] = 0.46 * shade;
      colors[i * 3 + 2] = 0.42 * shade;
      sizes[i] = BELT_BODY_MIN_PX + rng() * (BELT_BODY_MAX_PX - BELT_BODY_MIN_PX);
      alphas[i] = 0.16 + rng() * 0.34;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), belt.outerAU);

    const material = new THREE.ShaderMaterial({
      vertexShader: BELT_VERT,
      fragmentShader: BELT_FRAG,
      uniforms: {
        uDpr: { value: 1 },
        // Fade the belt out across the planetary frame's edge, so a belt that extends
        // past the frame dissolves into dust instead of ending on a hard line.
        uFade0: { value: this.frameAU * 0.92 },
        uFade1: { value: this.frameAU * 1.50 },
        uInner: { value: belt.innerAU },
        uOuter: { value: belt.outerAU },
      },
      blending: THREE.NormalBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 1;
    points.name = `belt-${belt.id}`;
    this.scene.add(points);

    const meanRadiusAU = (belt.innerAU + belt.outerAU) / 2;
    const meanMotion = TAU / orbitalPeriodDays(meanRadiusAU, this.system.star.massSun);
    return { belt, points, material, meanMotion };
  }

  /**
   * Camera pose that fits the planetary system.
   *
   * Not a bounding-sphere fit: a system is a flat disc seen at an angle, so a sphere fit
   * leaves two thirds of the frame empty. The disc is fitted into the projected ellipse
   * (radius across, `sin(elevation) * radius` up the screen), then given a perspective
   * margin because the near side of the disc is closer than the far side. That is what
   * makes the system fill the frame instead of floating in it.
   */
  defaultPose(aspect: number, fovDeg: number): CameraPose {
    const elevation = 0.52;
    const fovY = (fovDeg * Math.PI) / 180;
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * Math.max(aspect, 1e-4));
    const radius = this.frameAU;
    // Horizontal: the disc's left/right rims are at the target's depth.
    const distanceH = (radius * 1.03) / Math.tan(fovX / 2);
    // Vertical: the NEAR rim is closer to the camera than the star, so its projection is
    // magnified. Solve for the distance at which its screen angle still fits the frame.
    const distanceV = (radius * Math.sin(elevation)) / Math.tan(fovY / 2) + radius * Math.cos(elevation);
    const distance = Math.max(distanceH, distanceV * 0.90);
    return {
      position: directionFromAngles(elevation, 0.62).multiplyScalar(distance),
      target: this.starPosition.clone(),
      near: Math.max(this.starRadius * 0.001, 1e-6),
      far: this.outerAU * 140,
    };
  }

  /** Pose close to the star, used as the arrival frame of a galaxy → system flight. */
  starPortalPose(direction: THREE.Vector3): CameraPose {
    return {
      position: direction.clone().normalize().multiplyScalar(this.starRadius * 3.1),
      target: this.starPosition.clone(),
      near: Math.max(this.starRadius * 0.01, 1e-6),
      far: this.outerAU * 120,
    };
  }

  setTime(days: number): void {
    for (const record of this.planets) {
      const p = positionAtAU(record.planet.orbit, days);
      record.position.set(p.x, p.y, p.z);
      record.visual.group.position.copy(record.position);
      const dayHours = record.planet.dayHours;
      const spin = dayHours !== 0 ? (TAU * days * 24) / dayHours : 0;
      record.visual.setSpin(spin);

      // A moon's drawn orbit was laid out against the planet's *generated* radius, so it
      // follows the planet's screen-size scale or the moon ends up inside the planet.
      const moonScale = record.visual.scale;
      for (const moonRecord of record.moons) {
        const km = moonPositionKm(moonRecord.moon.orbit, days);
        const scale = moonRecord.orbitAU / Math.max(moonRecord.moon.orbit.radiusKm, 1);
        moonRecord.position
          .set(km.x * scale, km.y * scale, km.z * scale)
          .multiplyScalar(moonScale)
          .add(record.position);
        moonRecord.visual.group.position.copy(moonRecord.position);
        // Tidally locked: the same face watches the planet.
        moonRecord.visual.setSpin(Math.atan2(km.x, km.z));
      }
    }

    for (const belt of this.belts) {
      // A belt is thousands of tiny Keplerian bodies; rotating the whole ring at the
      // mean motion is the honest cheap version (no per-body state, one draw call).
      belt.points.rotation.y = belt.meanMotion * days;
    }
  }

  /**
   * Per-frame look updates: the star's screen-size floor, every world's screen-size
   * floor and lighting. The camera is passed in because a minimum *pixel* size is
   * meaningless without knowing the projection.
   */
  updateFrame(timeSeconds: number, camera: THREE.PerspectiveCamera, heightPx: number): void {
    this.star.update(timeSeconds);

    const worldPerPixel = this.worldPerPixel(camera, heightPx, this.starPosition);
    this.star.setScreenSize(worldPerPixel, MIN_STAR_PHOTOSPHERE_PX, MIN_STAR_CORONA_PX);

    const starDir = new THREE.Vector3();
    for (const record of this.planets) {
      // Screen-size floor for the world: findable, and never larger than a wall. The
      // scale is computed from the *generated* radius every frame (never from the last
      // frame's scale), or the size would oscillate.
      const pxBase = screenRadiusPx(camera, record.position, record.radiusAU, heightPx);
      if (pxBase > 0) {
        const wanted = Math.min(Math.max(pxBase, MIN_PLANET_RADIUS_PX), MAX_PLANET_RADIUS_PX);
        const scale = Math.min(Math.max(wanted / pxBase, 1 / MAX_PLANET_SCALE), MAX_PLANET_SCALE);
        if (Math.abs(scale - record.visual.scale) > 0.002) record.visual.setScale(scale);
      }
      starDir.copy(record.position).multiplyScalar(-1).normalize();
      record.visual.update(record.position, starDir, this.starColor, 1.2, timeSeconds);
      for (const moonRecord of record.moons) {
        starDir.copy(moonRecord.position).multiplyScalar(-1).normalize();
        moonRecord.visual.update(moonRecord.position, starDir, this.starColor, 0.9, timeSeconds);
      }
    }
  }

  /** World units per CSS pixel at `at`, for the current camera. */
  private worldPerPixel(camera: THREE.PerspectiveCamera, heightPx: number, at: THREE.Vector3): number {
    const distance = Math.max(camera.position.distanceTo(at), 1e-9);
    const fov = (camera.fov * Math.PI) / 180;
    return (2 * distance * Math.tan(fov / 2)) / Math.max(heightPx, 1);
  }

  setDpr(dpr: number): void {
    this.sky.setDpr(dpr);
    for (const belt of this.belts) belt.material.uniforms.uDpr!.value = dpr;
  }

  /** The orbit line of the selected planet is the only line allowed to speak loudly. */
  setSelected(target: PickTarget | null): void {
    for (const record of this.planets) {
      const isSelected = target?.kind === 'planet' && target.id === record.planet.id;
      record.orbitMaterial.opacity = isSelected ? 0.72 : 0.30;
      const tint = isSelected ? AFFORDANCE.orbitFocus : AFFORDANCE.orbit;
      record.orbitMaterial.color.setRGB(tint[0], tint[1], tint[2]);
    }
  }

  positionOf(target: PickTarget): THREE.Vector3 | null {
    if (target.kind === 'planet') {
      const record = this.planets.find((p) => p.planet.id === target.id);
      return record ? record.position.clone() : null;
    }
    if (target.kind === 'moon') {
      for (const record of this.planets) {
        const moon = record.moons.find((m) => m.moon.id === target.id);
        if (moon) return moon.position.clone();
      }
      return null;
    }
    return null;
  }

  planetVisual(id: string): { position: THREE.Vector3; radiusAU: number } | null {
    const record = this.planets.find((p) => p.planet.id === id);
    return record ? { position: record.position.clone(), radiusAU: record.radiusAU * record.visual.scale } : null;
  }

  pickables(): WorldPickable[] {
    const list: WorldPickable[] = [];
    for (const record of this.planets) {
      list.push({
        target: { kind: 'planet', id: record.planet.id },
        position: record.position,
        radius: record.radiusAU * record.visual.scale,
      });
      for (const moon of record.moons) {
        list.push({
          target: { kind: 'moon', id: moon.moon.id },
          position: moon.position,
          radius: moon.radiusAU * record.visual.scale,
        });
      }
    }
    return list;
  }

  dispose(): void {
    for (const record of this.planets) {
      record.visual.dispose();
      record.moons.forEach((moon) => moon.visual.dispose());
    }
    for (const belt of this.belts) {
      belt.points.geometry.dispose();
      belt.material.dispose();
      belt.points.removeFromParent();
    }
    for (const geometry of this.geometryDisposals) geometry.dispose();
    for (const material of this.materialDisposals) material.dispose();
    this.star.dispose();
    this.sky.dispose();
    this.scene.clear();
  }
}
