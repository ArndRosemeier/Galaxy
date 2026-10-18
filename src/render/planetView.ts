/**
 * The planet view — a world, not a textured sphere.
 *
 * Everything is shaded from `SurfaceSpec` on the GPU (see `world.ts` for the surface,
 * cloud, atmosphere and ring shaders). This module's job is the *stage*: put the world
 * at the origin at radius 1, pick a camera that shows a gibbous phase with the
 * terminator visible, place the host star in the sky in the direction the system's
 * geometry actually gives it, and hang the moons where `moonPositionKm` says they are
 * (direction preserved; distance compressed so they read as sky objects rather than
 * disappear into the black).
 *
 * Draw calls (budget ≤ 40): surface 1 · clouds 1 · atmosphere 1 · rings 1 · moons ≤ 3 ·
 * star glare 1 · sky 1 · markers 1 · post 4 ≈ 14 for a ringed ocean world with moons.
 */

import * as THREE from 'three';
import type { Planet, StarSystem } from '../sim/types';
import { moonPositionKm, positionAtAU } from '../sim/orbit';
import type { CameraPose } from './camera';
import { closePose } from './camera';
import { screenRadiusPx } from './pick';
import type { PickTarget, WorldPickable } from './api';
import { drawnRingRadii, planetViewMoonDistance, planetViewMoonRadius } from './scales';
import { WorldVisual } from './world';
import { createStarGlow } from './star';
import { createStarfield, type SkyField } from './sky';
import { TAU, hashString } from './rand';

/** How far the camera sits from the world on arrival, in planet radii, when unscaled. */
const PORTAL_DISTANCE = 1.85;
/** The phase angle of the default portrait: a gibbous three-quarter light. */
const PHASE_DEG = 60;
/** Preferred opening angle of a ring plane, degrees. */
const RING_OPENING_DEG = 27;

interface SkyMoon {
  readonly moonId: string;
  readonly name: string;
  readonly visual: WorldVisual;
  readonly rank: number;
  readonly count: number;
  readonly position: THREE.Vector3;
  readonly radius: number;
}

export class PlanetView {
  readonly scene = new THREE.Scene();
  readonly planet: Planet;
  readonly host: StarSystem;
  readonly starColor: THREE.Color;
  readonly starDirection = new THREE.Vector3(1, 0, 0);
  /** Outer ring radius in world radii, or 1 when there are no rings. */
  readonly ringOuter: number;
  private readonly ringNormal = new THREE.Vector3(0, 1, 0);
  private cameraDir: THREE.Vector3 | null = null;
  private starDirectionLocked = false;
  private readonly visual: WorldVisual;
  private readonly moons: SkyMoon[] = [];
  private readonly sky: SkyField;
  private readonly starGlow: THREE.Mesh;
  private readonly starGlowMaterial: THREE.ShaderMaterial;
  private readonly starGlowColor: THREE.Color;

  constructor(planet: Planet, host: StarSystem, timeDays: number, dpr: number) {
    this.planet = planet;
    this.host = host;
    this.scene.background = new THREE.Color(0x000000);
    this.starColor = new THREE.Color(host.star.color[0], host.star.color[1], host.star.color[2]);
    this.ringOuter = planet.rings
      ? drawnRingRadii(
          planet.rings.innerRadiusKm / Math.max(planet.radiusKm, 1),
          planet.rings.outerRadiusKm / Math.max(planet.radiusKm, 1),
        ).outer
      : 1;
    // The ring plane is tilted with the world (the same roll the surface rig applies), so
    // the camera's opening angle is measured against the tilted normal.
    const tilt = 0.16 + ((hashString(planet.id) % 1000) / 1000) * 0.34;
    this.ringNormal.set(-Math.sin(tilt), Math.cos(tilt), 0).normalize();

    this.sky = createStarfield({
      count: 2600,
      radius: 900,
      seed: planet.surface.seed ^ 0x7be1a3,
      band: 0.34,
      intensity: 0.62,
      sizeRange: [0.6, 2.1],
    });
    this.scene.add(this.sky.points);

    this.visual = new WorldVisual({
      surface: planet.surface,
      radius: 1,
      detail: 'planet',
      atmosphere: planet.atmosphere,
      rings: planet.rings,
      coverage: planet.hydrosphere ? planet.hydrosphere.coverage : 0,
      planetRadiusKm: planet.radiusKm,
      temperatureK: planet.temperatureK,
      id: planet.id,
      clouds: true,
      lightBalance: 0.82,
    });
    this.scene.add(this.visual.group);

    const sortedMoons = [...planet.moons].sort((a, b) => a.orbit.radiusKm - b.orbit.radiusKm).slice(0, 3);
    sortedMoons.forEach((moon, rank) => {
      const radius = planetViewMoonRadius(moon.radiusKm, planet.radiusKm);
      const visual = new WorldVisual({
        surface: moon.surface,
        radius,
        detail: 'moon',
        atmosphere: moon.atmosphere,
        rings: null,
        coverage: moon.surface.colors.water ? 0.5 : 0,
        planetRadiusKm: moon.radiusKm,
        temperatureK: null,
        id: moon.id,
        clouds: false,
        lightBalance: 0.82,
      });
      this.scene.add(visual.group);
      this.moons.push({
        moonId: moon.id,
        name: moon.name,
        visual,
        rank,
        count: sortedMoons.length,
        position: new THREE.Vector3(),
        radius,
      });
    });

    this.starGlowColor = this.starColor.clone();
    const glow = createStarGlow(this.starGlowColor, 62, 2.0, 7.3);
    this.starGlow = glow.mesh;
    this.starGlowMaterial = glow.material;
    this.scene.add(this.starGlow);

    this.setTime(timeDays);
    this.setDpr(dpr);
  }

  /**
   * Advance the world's clock.
   *
   * The star's **direction** is captured once and then held: a planet view is a
   * portrait, and letting the phase sweep as the simulation clock runs turns a composed
   * gibbous world into a randomly lit one a few seconds later. (The surface still
   * spins and the moons still orbit — the world is alive; only the light is held.)
   */
  setTime(days: number): void {
    if (!this.starDirectionLocked) {
      const orbitPosition = positionAtAU(this.planet.orbit, days);
      this.starDirection.set(-orbitPosition.x, -orbitPosition.y, -orbitPosition.z);
      if (this.starDirection.lengthSq() < 1e-12) this.starDirection.set(1, 0, 0);
      this.starDirection.normalize();
      if (days !== 0 || this.starDirection.lengthSq() > 0.5) this.starDirectionLocked = true;
    }

    const dayHours = this.planet.dayHours;
    this.visual.setSpin(dayHours !== 0 ? (TAU * days * 24) / dayHours : 0);

    for (const moon of this.moons) {
      const km = moonPositionKm(
        this.planet.moons.find((m) => m.id === moon.moonId)!.orbit,
        days,
      );
      const distance = planetViewMoonDistance(moon.rank, moon.count, Boolean(this.planet.rings));
      const length = Math.hypot(km.x, km.y, km.z) || 1;
      moon.position.set((km.x / length) * distance, (km.y / length) * distance, (km.z / length) * distance);
      moon.visual.group.position.copy(moon.position);
      moon.visual.setSpin(days * 0.35 + moon.rank * 1.7);
    }

    (this.starGlow.position as THREE.Vector3).copy(this.starDirection).multiplyScalar(760);
    // The glare's world size is fixed; the bloom does the rest.
    this.starGlowMaterial.uniforms.uSize!.value = 62;
    this.starGlowMaterial.uniforms.uColor!.value.copy(this.starGlowColor);
  }

  updateFrame(timeSeconds: number): void {
    this.visual.update(new THREE.Vector3(0, 0, 0), this.starDirection, this.starColor, 1.3, timeSeconds);
    for (const moon of this.moons) {
      moon.visual.update(moon.position, this.starDirection, this.starColor, 1.15, timeSeconds);
    }
    this.starGlowMaterial.uniforms.uTime!.value = timeSeconds;
  }

  /**
   * Camera pose that frames the world **and its rings**, with the terminator visible.
   *
   * The fit is an ellipse: the ring's projection is `outer` across and
   * `outer · sin(opening)` up the screen. Nothing is allowed to be cut off — the
   * previous frame's rings ran off both sides with a hard bar of shadow across the
   * planet, which is what "over-dominant scale" meant.
   */
  defaultPose(aspect: number, fovDeg: number): CameraPose {
    return closePose(
      new THREE.Vector3(0, 0, 0),
      this.cameraDirection(aspect, fovDeg),
      this.framingDistance(aspect, fovDeg),
      0.01,
      4000,
    );
  }

  /** Arrival frame after the flash: closer, so the pull-back itself reads as motion. */
  portalPose(): CameraPose {
    return closePose(new THREE.Vector3(0, 0, 0), this.cameraDirection(), PORTAL_DISTANCE, 0.01, 4000);
  }

  private framingDistance(aspect: number, fovDeg: number): number {
    const fovY = (fovDeg * Math.PI) / 180;
    const tanY = Math.tan(fovY / 2);
    const direction = this.cameraDirection(aspect, fovDeg);
    const opening = Math.acos(Math.min(Math.max(direction.dot(this.ringNormal), -1), 1));
    const outer = this.ringOuter;
    const halfWidth = Math.max(1, outer) * 1.12;
    const halfHeight = Math.max(1, outer * Math.sin(opening)) * 1.14;
    const distanceH = halfWidth / (tanY * Math.max(aspect, 1e-4));
    const distanceV = halfHeight / tanY;
    return Math.max(distanceH, distanceV) * 1.04;
  }

  /**
   * Camera direction on the cone of directions `PHASE_DEG` from the star — the classic
   * gibbous three-quarter light.
   *
   * The azimuth around the star direction is free, and it is what sets the *ring
   * opening* and which moon is in shot. We scan it: ringed worlds prefer an opening near
   * 27° (open enough to see structure, closed enough to read as rings), and among the
   * candidates that satisfy that, one with a moon in the sky wins.
   */
  private cameraDirection(aspect = 16 / 9, fovDeg = 50): THREE.Vector3 {
    if (this.cameraDir) return this.cameraDir;
    const star = this.starDirection;
    const up = new THREE.Vector3(0, 1, 0);
    let side = new THREE.Vector3().crossVectors(star, up);
    if (side.lengthSq() < 1e-8) side = new THREE.Vector3(1, 0, 0);
    side.normalize();
    const lift = new THREE.Vector3().crossVectors(side, star).normalize();
    const phaseAngle = (PHASE_DEG * Math.PI) / 180;
    const toDirection = (phi: number): THREE.Vector3 =>
      star
        .clone()
        .multiplyScalar(Math.cos(phaseAngle))
        .addScaledVector(side, Math.cos(phi) * Math.sin(phaseAngle))
        .addScaledVector(lift, Math.sin(phi) * Math.sin(phaseAngle))
        .normalize();

    const targetOpening = (RING_OPENING_DEG * Math.PI) / 180;
    const ringed = this.planet.rings !== null;
    const distance = this.framingDistanceForScan(aspect, fovDeg);
    const camera = new THREE.PerspectiveCamera(fovDeg, aspect, 0.01, 100);
    const heightPx = 900;
    const projected = new THREE.Vector3();
    const planetRadiusNdc = (screenRadiusPx(camera, new THREE.Vector3(), 1, heightPx) / heightPx) * 2;

    let best: { direction: THREE.Vector3; score: number } | null = null;
    for (let step = 0; step < 180; step += 1) {
      const direction = toDirection((step / 180) * Math.PI * 2);
      // Keep the camera above the world's equator: a below-plane view of a ringed world
      // hides its rings behind the planet.
      if (direction.y < 0.10) continue;
      let score = 0;
      if (ringed) {
        const opening = Math.acos(Math.min(Math.max(direction.dot(this.ringNormal), -1), 1));
        score -= Math.abs(opening - targetOpening) * 2.2;
      }
      if (this.moons.length > 0) {
        camera.position.copy(direction).multiplyScalar(distance);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);
        let moonBest = -1;
        for (const moon of this.moons) {
          projected.copy(moon.position).project(camera);
          if (Math.abs(projected.x) > 0.9 || Math.abs(projected.y) > 0.9 || projected.z > 1) continue;
          const moonSizeNdc = (screenRadiusPx(camera, moon.position, moon.radius, heightPx) / heightPx) * 2;
          if (moonSizeNdc > 0.22) continue;
          const fromCentre = Math.hypot(projected.x, projected.y);
          if (fromCentre < planetRadiusNdc * 0.8 + moonSizeNdc) continue;
          moonBest = Math.max(moonBest, Math.max(0, projected.y) * 0.6 + Math.min(fromCentre, 0.85) * 0.4);
        }
        if (moonBest > 0) score += 0.9 * moonBest;
      }
      if (!best || score > best.score) best = { direction, score };
    }

    this.cameraDir = best
      ? best.direction
      : star
          .clone()
          .multiplyScalar(Math.cos(phaseAngle))
          .addScaledVector(side, Math.sin(phaseAngle))
          .setY(0.31)
          .normalize();
    return this.cameraDir;
  }

  /** Distance used only to score moon visibility while scanning for a direction. */
  private framingDistanceForScan(aspect: number, fovDeg: number): number {
    const fovY = (fovDeg * Math.PI) / 180;
    const tanY = Math.tan(fovY / 2);
    return Math.max(1, this.ringOuter) * 1.15 / (tanY * Math.max(Math.min(aspect, 1.0), 1e-4));
  }

  setDpr(dpr: number): void {
    this.sky.setDpr(dpr);
  }

  positionOf(target: PickTarget): THREE.Vector3 | null {
    if (target.kind === 'planet' && target.id === this.planet.id) return new THREE.Vector3(0, 0, 0);
    if (target.kind === 'moon') {
      const moon = this.moons.find((m) => m.moonId === target.id);
      return moon ? moon.position.clone() : null;
    }
    return null;
  }

  /** The world itself, its moons, and nothing else: the star is not selectable. */
  pickables(): WorldPickable[] {
    const list: WorldPickable[] = [
      { target: { kind: 'planet', id: this.planet.id }, position: new THREE.Vector3(0, 0, 0), radius: 1 },
    ];
    for (const moon of this.moons) {
      list.push({
        target: { kind: 'moon', id: moon.moonId },
        position: moon.position,
        radius: moon.radius,
      });
    }
    return list;
  }

  dispose(): void {
    this.visual.dispose();
    for (const moon of this.moons) moon.visual.dispose();
    this.starGlowMaterial.dispose();
    this.starGlow.removeFromParent();
    this.sky.dispose();
    this.scene.clear();
  }
}
