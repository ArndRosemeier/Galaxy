/**
 * The system view — flying in.
 *
 * The star is the composition's anchor: an emissive photosphere with a two-shell
 * corona, and a real point light for the instanced belt. The planets ride the ORBITS
 * THE GENERATOR WROTE: every moving body's position comes from `positionAtAU` or
 * `moonPositionKm` (`src/sim/orbit.ts`), never from a re-derived ellipse. The renderer
 * only exaggerates how big the bodies are *drawn* (see `scales.ts`), never where they
 * are.
 *
 * Belts are one instanced mesh per belt, capped at 3 000 bodies × 20 triangles = the
 * 60 000-triangle budget. Their vertical scatter and radial distribution are seeded
 * from `AsteroidBelt.seed`, so a system reproduces exactly.
 *
 * Draw calls (budget ≤ 120): star 3 · planets 21 · moons 8 · orbit lines 8 · belt 1 ·
 * sky 1 · markers 1 · post 4 ≈ 47 for the fixture system.
 */

import * as THREE from 'three';
import type { AsteroidBelt, Moon, Planet, StarSystem } from '../sim/types';
import { moonPositionKm, orbitalPeriodDays, positionAtAU } from '../sim/orbit';
import type { CameraPose } from './camera';
import { directionFromAngles } from './camera';
import type { PickTarget, WorldPickable } from './api';
import {
  BELT_BODY_RADIUS_FRACTION,
  MAX_BELT_BODIES,
  clampVisualRadii,
  exaggeratedRadiusAU,
  moonOrbitVisualAU,
  moonVisualRadiusAU,
  starVisualRadiusAU,
} from './scales';
import { WorldVisual } from './world';
import { StarVisual } from './star';
import { createStarfield, type SkyField } from './sky';
import { mulberry32, TAU } from './rand';

const ORBIT_SEGMENTS = 160;

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
  readonly mesh: THREE.InstancedMesh;
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

    this.star = new StarVisual(system.star, this.starRadius);
    this.scene.add(this.star.group);

    const aphelion = Math.max(
      ...system.planets.map((p) => p.orbit.semiMajorAU * (1 + p.orbit.eccentricity)),
      ...system.belts.map((b) => b.outerAU),
      innermost * 1.2,
    );
    this.outerAU = Math.max(aphelion * 1.08, this.starRadius * 12);

    this.sky = createStarfield({
      count: 2200,
      radius: this.outerAU * 14,
      seed: system.seed ^ 0x2f7a1b,
      band: 0.3,
      intensity: 0.5,
      sizeRange: [0.6, 2.0],
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
        color: new THREE.Color(0.42, 0.56, 0.95),
        transparent: true,
        opacity: 0.18,
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

  private buildBelt(belt: AsteroidBelt): BeltRecord | null {
    const span = belt.outerAU - belt.innerAU;
    if (!(span > 0)) return null;
    const proportion = Math.min(Math.max(belt.density, 0), 1);
    const count = Math.min(Math.floor(belt.count * (0.45 + proportion * 0.9)), MAX_BELT_BODIES);
    if (count <= 0) return null;

    const baseGeometry = new THREE.IcosahedronGeometry(1, 0);
    const material = new THREE.MeshLambertMaterial({ color: 0x8b8175, flatShading: true });
    const mesh = new THREE.InstancedMesh(baseGeometry, material, count);
    mesh.frustumCulled = false;

    const rng = mulberry32(belt.seed ^ 0x6d2b79f5);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const inclination = (belt.inclinationDeg * Math.PI) / 180;
    const bodyRadius = Math.max(span * BELT_BODY_RADIUS_FRACTION, 0.0011);
    for (let i = 0; i < count; i += 1) {
      // Triangular radial distribution: belts are denser in the middle than at the edges.
      const t = (rng() + rng()) * 0.5;
      const radius = belt.innerAU + span * t;
      const angle = rng() * TAU;
      const spread = (rng() - 0.5) * Math.sin(inclination) * radius * 1.4;
      dummy.position.set(Math.cos(angle) * radius, spread, Math.sin(angle) * radius);
      const size = bodyRadius * (0.35 + rng() * 1.5);
      dummy.scale.setScalar(size);
      dummy.rotation.set(rng() * TAU, rng() * TAU, rng() * TAU);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const shade = 0.3 + rng() * 0.32;
      const warm = 0.82 + rng() * 0.3;
      color.setRGB(shade * warm, shade * 0.92, shade * 0.8);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.geometryDisposals.push(baseGeometry);
    this.materialDisposals.push(material);
    this.scene.add(mesh);

    const meanRadiusAU = (belt.innerAU + belt.outerAU) / 2;
    const meanMotion = TAU / orbitalPeriodDays(meanRadiusAU, this.system.star.massSun);
    return { belt, mesh, meanMotion };
  }

  /**
   * Camera pose that fits the whole system.
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
    const radius = this.outerAU;
    // Horizontal: the disc's left/right rims are at the target's depth.
    const distanceH = (radius * 1.06) / Math.tan(fovX / 2);
    // Vertical: the NEAR rim is closer to the camera than the star, so its projection is
    // magnified. Solve for the distance at which its screen angle still fits the frame.
    const distanceV = (radius * Math.sin(elevation)) / Math.tan(fovY / 2) + radius * Math.cos(elevation);
    const distance = Math.max(distanceH, distanceV * 1.04);
    return {
      position: directionFromAngles(elevation, 0.62).multiplyScalar(distance),
      target: this.starPosition.clone(),
      near: Math.max(this.starRadius * 0.02, 1e-5),
      far: this.outerAU * 140,
    };
  }

  /** Pose close to the star, used as the arrival frame of a galaxy → system flight. */
  starPortalPose(direction: THREE.Vector3): CameraPose {
    return {
      position: direction.clone().normalize().multiplyScalar(this.starRadius * 3.1),
      target: this.starPosition.clone(),
      near: Math.max(this.starRadius * 0.02, 1e-5),
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

      for (const moonRecord of record.moons) {
        const km = moonPositionKm(moonRecord.moon.orbit, days);
        const scale = moonRecord.orbitAU / Math.max(moonRecord.moon.orbit.radiusKm, 1);
        moonRecord.position.set(km.x * scale, km.y * scale, km.z * scale).add(record.position);
        moonRecord.visual.group.position.copy(moonRecord.position);
        // Tidally locked: the same face watches the planet.
        moonRecord.visual.setSpin(Math.atan2(km.x, km.z));
      }
    }

    for (const belt of this.belts) {
      // A belt is thousands of tiny Keplerian bodies; rotating the whole ring at the
      // mean motion is the honest cheap version (no per-body state, one draw call).
      belt.mesh.rotation.y = belt.meanMotion * days;
    }
  }

  /** Per-frame look updates: star animation and every world's lighting. */
  updateFrame(timeSeconds: number): void {
    this.star.update(timeSeconds);
    const starDir = new THREE.Vector3();
    for (const record of this.planets) {
      starDir.copy(record.position).multiplyScalar(-1).normalize();
      record.visual.update(record.position, starDir, this.starColor, 1.2, timeSeconds);
      for (const moonRecord of record.moons) {
        starDir.copy(moonRecord.position).multiplyScalar(-1).normalize();
        moonRecord.visual.update(moonRecord.position, starDir, this.starColor, 0.9, timeSeconds);
      }
    }
  }

  setDpr(dpr: number): void {
    this.sky.setDpr(dpr);
  }

  /** The orbit line of the selected planet is the only line allowed to speak loudly. */
  setSelected(target: PickTarget | null): void {
    for (const record of this.planets) {
      const isSelected = target?.kind === 'planet' && target.id === record.planet.id;
      record.orbitMaterial.opacity = isSelected ? 0.55 : 0.18;
      record.orbitMaterial.color.setRGB(isSelected ? 1.0 : 0.42, isSelected ? 0.78 : 0.56, isSelected ? 0.4 : 0.95);
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
    return record ? { position: record.position.clone(), radiusAU: record.radiusAU } : null;
  }

  pickables(): WorldPickable[] {
    const list: WorldPickable[] = [];
    for (const record of this.planets) {
      list.push({
        target: { kind: 'planet', id: record.planet.id },
        position: record.position,
        radius: record.radiusAU,
      });
      for (const moon of record.moons) {
        list.push({
          target: { kind: 'moon', id: moon.moon.id },
          position: moon.position,
          radius: moon.radiusAU,
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
    for (const belt of this.belts) belt.mesh.removeFromParent();
    for (const geometry of this.geometryDisposals) geometry.dispose();
    for (const material of this.materialDisposals) material.dispose();
    this.star.dispose();
    this.sky.dispose();
    this.scene.clear();
  }
}
