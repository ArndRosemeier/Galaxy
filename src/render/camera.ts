/**
 * The camera rig — one perspective camera, one user-control surface, one flight model.
 *
 * `docs/ARCHITECTURE.md` names this file as the only home for camera motion. Every
 * move in the app is a *pose to pose* transition: `setView` asks for a named overview
 * pose, `focusSystem`/`focusPlanet` ask for a closer pose, and a view change is two
 * glides with a scene swap in the middle (the renderer's composite covers that swap
 * with a short flash). Nothing else moves the camera.
 *
 * Damping belongs to `OrbitControls`; flights bypass it (controls are disabled while a
 * flight runs) and hand the final pose back, so `update()` never fights itself.
 * `prefers-reduced-motion` turns every flight into a jump: motion is a preference, not
 * a feature to override.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraPose {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly near: number;
  readonly far: number;
}

export type Easing = 'linear' | 'in' | 'out' | 'inout';

function ease(kind: Easing, t: number): number {
  switch (kind) {
    case 'in':
      return t * t * t;
    case 'out':
      return 1 - Math.pow(1 - t, 3);
    case 'inout':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    default:
      return t;
  }
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private flight:
    | {
        from: CameraPose;
        to: CameraPose;
        startedAt: number;
        durationMs: number;
        easing: Easing;
        onDone?: () => void;
        holdControls: boolean;
      }
    | null = null;
  private reducedMotionQuery: MediaQueryList | null = null;
  private readonly disposeListeners: () => void;

  constructor(canvas: HTMLCanvasElement, fovDeg = 50) {
    this.camera = new THREE.PerspectiveCamera(fovDeg, 1, 0.5, 20_000);
    this.camera.position.set(0, 1000, 2500);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.9;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.06;
    this.controls.maxPolarAngle = Math.PI - 0.06;
    this.controls.minDistance = 0.01;
    this.controls.maxDistance = 1e6;
    this.controls.zoomToCursor = false;
    this.controls.enabled = false;

    const onChange = (): void => {
      this.reducedMotion = this.reducedMotionQuery?.matches ?? false;
    };
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotionQuery.addEventListener('change', onChange);
      this.reducedMotion = this.reducedMotionQuery.matches;
      this.disposeListeners = (): void => this.reducedMotionQuery?.removeEventListener('change', onChange);
    } else {
      this.reducedMotion = false;
      this.disposeListeners = (): void => {};
    }
  }

  reducedMotion = false;

  get flying(): boolean {
    return this.flight !== null;
  }

  getPose(): CameraPose {
    return {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      near: this.camera.near,
      far: this.camera.far,
    };
  }

  /** Copy a pose onto the camera and controls immediately. */
  setPose(pose: CameraPose, enableControls = true): void {
    this.flight = null;
    this.camera.position.copy(pose.position);
    this.camera.near = pose.near;
    this.camera.far = pose.far;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(pose.target);
    this.controls.enabled = enableControls;
    if (enableControls) this.controls.update();
    this.camera.lookAt(pose.target);
  }

  /**
   * Fly from wherever the camera is now to `pose`. Reduced motion jumps.
   * `holdControls` keeps the user's controls locked after the flight lands — used by
   * the first half of a view transition, where a second glide follows immediately.
   */
  glideTo(
    pose: CameraPose,
    durationMs: number,
    easing: Easing = 'inout',
    onDone?: () => void,
    holdControls = false,
  ): void {
    if (this.reducedMotion || durationMs <= 0) {
      this.setPose(pose, !holdControls);
      onDone?.();
      return;
    }
    this.controls.enabled = false;
    this.flight = {
      from: this.getPose(),
      to: {
        position: pose.position.clone(),
        target: pose.target.clone(),
        near: pose.near,
        far: pose.far,
      },
      startedAt: performance.now(),
      durationMs,
      easing,
      onDone,
      holdControls,
    };
  }

  /** Apply orbit-control limits for the view being entered. */
  setLimits(minDistance: number, maxDistance: number, minPolar: number, maxPolar: number): void {
    this.controls.minDistance = minDistance;
    this.controls.maxDistance = maxDistance;
    this.controls.minPolarAngle = minPolar;
    this.controls.maxPolarAngle = maxPolar;
  }

  /** Vertical field of view, degrees. A view may want a longer lens than another. */
  setFov(fovDeg: number): void {
    if (!(fovDeg > 0)) return;
    if (this.camera.fov === fovDeg) return;
    this.camera.fov = fovDeg;
    this.camera.updateProjectionMatrix();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = Math.max(aspect, 1e-4);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Advance the rig one frame. Returns true while a flight is running (the caller can
   * use that to keep the frame moving). Damping updates the controls otherwise.
   */
  update(now: number): boolean {
    if (this.flight) {
      const f = this.flight;
      const raw = Math.min(Math.max((now - f.startedAt) / f.durationMs, 0), 1);
      const t = ease(f.easing, raw);
      this.camera.position.lerpVectors(f.from.position, f.to.position, t);
      this.controls.target.lerpVectors(f.from.target, f.to.target, t);
      // Near/far interpolate in log space so depth precision never collapses mid-flight.
      this.camera.near = Math.exp(Math.log(f.from.near) + (Math.log(f.to.near) - Math.log(f.from.near)) * t);
      this.camera.far = Math.exp(Math.log(f.from.far) + (Math.log(f.to.far) - Math.log(f.from.far)) * t);
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.controls.target);
      if (raw >= 1) {
        this.flight = null;
        if (!f.holdControls) {
          this.controls.enabled = true;
          this.controls.update();
        }
        f.onDone?.();
        return false;
      }
      return true;
    }
    if (this.controls.enabled) this.controls.update();
    return false;
  }

  dispose(): void {
    this.flight = null;
    this.controls.dispose();
    this.disposeListeners();
  }
}

// ---------------------------------------------------------------------------
// Named poses, shared by the view modules
// ---------------------------------------------------------------------------

/** Unit vector for an elevation above the XZ plane and an azimuth around +Y. */
export function directionFromAngles(elevationRad: number, azimuthRad: number): THREE.Vector3 {
  const horizontal = Math.cos(elevationRad);
  return new THREE.Vector3(
    Math.sin(azimuthRad) * horizontal,
    Math.sin(elevationRad),
    Math.cos(azimuthRad) * horizontal,
  ).normalize();
}

/** Camera pose looking at `target` from `direction * distance`. */
export function closePose(
  target: THREE.Vector3,
  direction: THREE.Vector3,
  distance: number,
  near: number,
  far: number,
): CameraPose {
  return {
    position: target.clone().addScaledVector(direction.clone().normalize(), distance),
    target: target.clone(),
    near,
    far,
  };
}

