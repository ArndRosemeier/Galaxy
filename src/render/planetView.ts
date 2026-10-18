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
import {
  RING_DRAWN_MAX,
  RING_DRAWN_MIN,
  planetViewMoonDistance,
  planetViewMoonRadius,
} from './scales';
import { WorldVisual } from './world';
import { createStarGlow } from './star';
import { createStarfield, type SkyField } from './sky';
import { TAU, hashString } from './rand';

/** How far the camera sits from the world on arrival, in planet radii, when unscaled. */
const PORTAL_DISTANCE = 1.85;
/** The phase angle of the default portrait: a gibbous three-quarter light. */
const PHASE_DEG = 60;
/**
 * Preferred opening of a ring plane ABOVE THE LINE OF SIGHT, degrees — the conventional
 * sense: 0 is edge-on, 90 is face-on. The camera direction is measured from the ring
 * *normal*, which is 90° minus this; the earlier code compared the normal angle directly
 * against 27°, i.e. it aimed for a ring 63° above the line of sight. That is a
 * face-on record, and it is why the rings filled the frame as concentric bands. At 27°
 * above the plane the ring reads as an ellipse and the planet stays the subject.
 */
const RING_OPENING_DEG = 27;
/**
 * Planet diameter as a fraction of the **shorter** viewport dimension on arrival.
 *
 * The world is the subject of its own view: a world that fills 84% of a 600 px frame
 * leaves no air and pushes its rings out of shot, and one that fills 23% of a 900 px
 * frame is a marble. 60% is the measured middle of the owner's 55-65% band. This is a
 * fraction of the *shorter* side, so a phone's portrait frame is sized by its width and
 * a laptop's by its height — the same composition, not a width-only rule that crops a
 * tall frame and a height-only rule that shrinks a wide one.
 */
const FRAME_FILL = 0.6;
/**
 * The whole subject (world + drawn rings) must stay inside this fraction of the
 * half-frame: 0.9 leaves a 10% margin on the tightest side (5% of the frame dimension).
 * The ring cap is chosen against THIS limit, not guessed: a ring that would exceed it
 * is compressed until it fits.
 */
const FRAME_LIMIT_NDC = 0.9;
/**
 * The drawn planet reaches 1.0 R and its atmosphere shell 1.028 R, so the sphere that
 * has to fit is a touch larger than the surface. Fitting the visible edge (not the
 * surface) is what "never cropped" means.
 */
const PLANET_DRAWN_EXTENT = 1.03;
/** Samples used to find a ring circle's projected extent. */
const RING_FIT_SAMPLES = 96;

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
  /** Whether the world has a drawn ring annulus. */
  readonly hasRings: boolean;
  /** The generator's true ring outer radius in planet radii (never larger than this). */
  private readonly ringTrueOuter: number;
  /** True ring-plane edge direction (the ring's local +X, tilted with the world). */
  private readonly ringEdge = new THREE.Vector3();
  private readonly ringUp = new THREE.Vector3(0, 0, 1);
  private readonly ringNormal = new THREE.Vector3(0, 1, 0);
  private cameraDir: THREE.Vector3 | null = null;
  private starDirectionLocked = false;
  private readonly visual: WorldVisual;
  private readonly moons: SkyMoon[] = [];
  private readonly sky: SkyField;
  private readonly starGlow: THREE.Mesh;
  private readonly starGlowMaterial: THREE.ShaderMaterial;
  private readonly starGlowColor: THREE.Color;
  private readonly fitCamera = new THREE.PerspectiveCamera(46, 1, 0.01, 100);
  private readonly ringPoint = new THREE.Vector3();

  constructor(planet: Planet, host: StarSystem, timeDays: number, dpr: number) {
    this.planet = planet;
    this.host = host;
    this.scene.background = new THREE.Color(0x000000);
    this.starColor = new THREE.Color(host.star.color[0], host.star.color[1], host.star.color[2]);
    this.hasRings = planet.rings !== null;
    this.ringTrueOuter = planet.rings
      ? planet.rings.outerRadiusKm / Math.max(planet.radiusKm, 1)
      : 0;
    // The ring plane is tilted with the world (the same roll the surface rig applies), so
    // the camera's opening angle is measured against the tilted normal.
    const tilt = 0.16 + ((hashString(planet.id) % 1000) / 1000) * 0.34;
    this.ringNormal.set(-Math.sin(tilt), Math.cos(tilt), 0).normalize();
    this.ringEdge.set(Math.cos(tilt), Math.sin(tilt), 0);

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
   * Camera pose that frames the world **and its drawn rings**, with the terminator
   * visible.
   *
   * The planet is always the subject: it is centred and sized at `FRAME_FILL` of the
   * SHORTER viewport dimension, using the actual viewport aspect. The ring annulus is
   * then fitted around it: its drawn outer radius is compressed from the 2.6 R cap
   * until the projected circle (sampled, so the near rim's perspective magnification
   * counts) stays inside `FRAME_LIMIT_NDC`. That is what guarantees that a 900×600
   * frame, a 390×844 phone and an ultrawide 2560×1080 all show the whole subject,
   * centred, with no crop — the old width/height rule fitted the ring ellipse
   * analytically and ignored the near rim, so it cropped exactly where the ring was
   * closest to the camera.
   */
  defaultPose(aspect: number, fovDeg: number): CameraPose {
    const direction = this.cameraDirection();
    const distance = this.framingDistance(aspect, fovDeg);
    this.fitRings(aspect, fovDeg, direction, distance);
    return closePose(new THREE.Vector3(0, 0, 0), direction, distance, 0.01, 4000);
  }

  /** Arrival frame after the flash: closer, so the pull-back itself reads as motion. */
  portalPose(): CameraPose {
    return closePose(new THREE.Vector3(0, 0, 0), this.cameraDirection(), PORTAL_DISTANCE, 0.01, 4000);
  }

  /**
   * Distance at which the world's drawn sphere fills `FRAME_FILL` of the shorter
   * viewport dimension.
   *
   * For a sphere of radius R the silhouette's angular radius satisfies sin θ = R / d;
   * with the vertical half-field V, a circle of angular radius θ spans
   * `tanθ / tanV` of the half-height. On a portrait frame the shorter dimension is the
   * width, so the horizontal half-field is what has to be filled instead:
   * `tan θ = FRAME_FILL · tanV · min(1, aspect)`.
   */
  private framingDistance(aspect: number, fovDeg: number): number {
    const tanY = Math.tan((fovDeg * Math.PI) / 180 / 2);
    const shorter = Math.min(Math.max(aspect, 1e-4), 1);
    const targetTan = FRAME_FILL * shorter * tanY;
    const sinTheta = targetTan / Math.hypot(1, targetTan);
    return PLANET_DRAWN_EXTENT / sinTheta;
  }

  /**
   * Compress the drawn rings until their projected circle fits the frame.
   *
   * The ring is a circle in the world's tilted equatorial plane; its screen projection
   * is an ellipse whose near rim is closer to the camera and therefore magnified. An
   * analytic `outer * sin(opening)` fit misses that magnification by up to 40% and is
   * exactly how rings ended up running off the top of a 900×600 frame. Sampling the
   * circle's projection and bisecting the drawn radius against the frame limit makes
   * cropping impossible. The ring cap is a pure view setting: `WorldVisual` remaps
   * the annulus in its vertex shader, and the ring shadow follows the same radii.
   */
  private fitRings(aspect: number, fovDeg: number, direction: THREE.Vector3, distance: number): void {
    if (!this.hasRings) return;
    const camera = this.fitCamera;
    camera.fov = fovDeg;
    camera.aspect = aspect;
    camera.near = 0.01;
    camera.far = 4000;
    camera.position.copy(direction).multiplyScalar(distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const fit = (outer: number): number => {
      let max = 0;
      for (let i = 0; i < RING_FIT_SAMPLES; i += 1) {
        const angle = (i / RING_FIT_SAMPLES) * TAU;
        const cos = Math.cos(angle) * outer;
        const sin = Math.sin(angle) * outer;
        this.ringPoint
          .copy(this.ringEdge)
          .multiplyScalar(cos)
          .addScaledVector(this.ringUp, sin)
          .project(camera);
        max = Math.max(max, Math.abs(this.ringPoint.x), Math.abs(this.ringPoint.y));
      }
      return max;
    };

    let cap = Math.min(RING_DRAWN_MAX, this.ringTrueOuter);
    if (fit(cap) > FRAME_LIMIT_NDC) {
      let lo = Math.min(RING_DRAWN_MIN, cap);
      let hi = cap;
      for (let i = 0; i < 24; i += 1) {
        const mid = (lo + hi) / 2;
        if (fit(mid) <= FRAME_LIMIT_NDC) lo = mid;
        else hi = mid;
      }
      cap = lo;
    }
    this.visual.setRingCap(cap);
  }

  /**
   * Camera direction on the cone of directions `PHASE_DEG` from the star — the classic
   * gibbous three-quarter light.
   *
   * The azimuth around the star direction is free, and it is what sets the *ring
   * opening* and which moon is in shot. We scan it: ringed worlds prefer the ring plane
   * 27° above the line of sight (open enough to read as rings, closed enough to keep the
   * planet the subject), and among the candidates that satisfy that, one with a moon in
   * the sky wins.
   */
  private cameraDirection(): THREE.Vector3 {
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

    const targetOpening = Math.PI / 2 - (RING_OPENING_DEG * Math.PI) / 180;
    const ringed = this.hasRings;
    // The scan is scored on a neutral square frame: the direction is a property of the
    // world and its star, not of the viewport, and scoring it with a viewport would make
    // a resize rotate the world. The actual fit happens in `fitRings`.
    const distance = this.framingDistanceForScan();
    const camera = new THREE.PerspectiveCamera(46, 1, 0.01, 100);
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const heightPx = 900;
    const projected = new THREE.Vector3();
    const planetRadiusNdc =
      (screenRadiusPx(camera, new THREE.Vector3(), PLANET_DRAWN_EXTENT, heightPx) / heightPx) * 2;

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
  private framingDistanceForScan(): number {
    const tanY = Math.tan((46 * Math.PI) / 180 / 2);
    const ringMax = this.hasRings ? RING_DRAWN_MAX : 1;
    return Math.max(1, ringMax) * 1.15 / tanY;
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
