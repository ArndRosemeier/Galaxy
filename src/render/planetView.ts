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
import { planetViewMoonDistance, planetViewMoonRadius } from './scales';
import { WorldVisual } from './world';
import { createStarGlow } from './star';
import { createStarfield, type SkyField } from './sky';
import { TAU } from './rand';

const PLANET_VIEW_DISTANCE = 3.2;
const RINGED_VIEW_DISTANCE = 4.3;
const PORTAL_DISTANCE = 1.85;

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
    });
    this.scene.add(this.visual.group);

    const sortedMoons = [...planet.moons].sort((a, b) => a.orbit.radiusKm - b.orbit.radiusKm).slice(0, 3);
    sortedMoons.forEach((moon, rank) => {
      const radius = planetViewMoonRadius(moon.radiusKm, planet.radiusKm);
      const visual = new WorldVisual({
        surface: moon.surface,
        radius,
        detail: 'system',
        atmosphere: moon.atmosphere,
        rings: null,
        coverage: moon.surface.colors.water ? 0.5 : 0,
        planetRadiusKm: moon.radiusKm,
        temperatureK: null,
        id: moon.id,
        clouds: false,
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

  setTime(days: number): void {
    const orbitPosition = positionAtAU(this.planet.orbit, days);
    this.starDirection.set(-orbitPosition.x, -orbitPosition.y, -orbitPosition.z);
    if (this.starDirection.lengthSq() < 1e-12) this.starDirection.set(1, 0, 0);
    this.starDirection.normalize();

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

  /** Camera pose that lets the world fill the frame with a visible terminator. */
  defaultPose(aspect: number, fovDeg: number): CameraPose {
    return closePose(
      new THREE.Vector3(0, 0, 0),
      this.cameraDirection(aspect, fovDeg),
      this.planet.rings ? RINGED_VIEW_DISTANCE : PLANET_VIEW_DISTANCE,
      0.01,
      4000,
    );
  }

  /** Arrival frame after the flash: closer, so the pull-back itself reads as motion. */
  portalPose(): CameraPose {
    return closePose(new THREE.Vector3(0, 0, 0), this.cameraDirection(), PORTAL_DISTANCE, 0.01, 4000);
  }

  /**
   * Camera direction on the sphere of directions ~62° from the star: the classic
   * gibbous three-quarter light, with the rings open.
   *
   * Among those directions we look for one that also frames a moon in the sky: the
   * moons ride `moonPositionKm`, so at any given time one of them may be behind the
   * planet or outside the frame. Rotating the camera around the star-light direction
   * costs nothing visually (the phase is unchanged) and is what makes "a moon or two
   * visible as sky objects" a property of the default frame instead of luck. If no
   * moon can be framed without a silly composition, the default direction is used.
   */
  private cameraDirection(aspect = 16 / 9, fovDeg = 50): THREE.Vector3 {
    const star = this.starDirection;
    const up = new THREE.Vector3(0, 1, 0);
    let side = new THREE.Vector3().crossVectors(star, up);
    if (side.lengthSq() < 1e-8) side = new THREE.Vector3(1, 0, 0);
    side.normalize();
    const lift = new THREE.Vector3().crossVectors(side, star).normalize();
    const phaseAngle = (62 * Math.PI) / 180;
    const toDirection = (phi: number): THREE.Vector3 =>
      star
        .clone()
        .multiplyScalar(Math.cos(phaseAngle))
        .addScaledVector(side, Math.cos(phi) * Math.sin(phaseAngle))
        .addScaledVector(lift, Math.sin(phi) * Math.sin(phaseAngle))
        .normalize();

    const distance = this.planet.rings ? RINGED_VIEW_DISTANCE : PLANET_VIEW_DISTANCE;
    if (this.moons.length > 0) {
      const camera = new THREE.PerspectiveCamera(fovDeg, aspect, 0.01, 100);
      camera.position.set(0, 0, distance);
      camera.updateMatrixWorld(true);
      const heightPx = 900;
      const planetRadiusNdc = (screenRadiusPx(camera, new THREE.Vector3(), 1, heightPx) / heightPx) * 2;
      const projected = new THREE.Vector3();
      let best: { direction: THREE.Vector3; score: number } | null = null;
      for (let step = 0; step < 120; step += 1) {
        const direction = toDirection((step / 120) * Math.PI * 2);
        if (direction.y < 0.08 || direction.y > 0.62) continue;
        camera.position.copy(direction).multiplyScalar(distance);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);
        let score = -1;
        for (const moon of this.moons) {
          projected.copy(moon.position).project(camera);
          const ndcX = projected.x;
          const ndcY = projected.y;
          if (Math.abs(ndcX) > 0.9 || Math.abs(ndcY) > 0.9 || projected.z > 1) continue;
          const moonSizeNdc = (screenRadiusPx(camera, moon.position, moon.radius, heightPx) / heightPx) * 2;
          if (moonSizeNdc > 0.22) continue;
          const fromCentre = Math.hypot(ndcX, ndcY);
          if (fromCentre < planetRadiusNdc * 0.74 + moonSizeNdc) continue;
          // Prefer a moon high in the sky, a little off the planet's limb.
          const sky = Math.max(0, ndcY) * 0.6 + Math.min(fromCentre, 0.85) * 0.4;
          score = Math.max(score, sky);
        }
        if (score > (best?.score ?? 0.02)) best = { direction, score };
      }
      if (best) return best.direction;
    }

    // Fallback: the side of the star with a little elevation.
    const fallback = star
      .clone()
      .multiplyScalar(Math.cos(phaseAngle))
      .addScaledVector(side, Math.sin(phaseAngle));
    fallback.y += 0.31;
    return fallback.normalize();
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
