/**
 * Picking maths — the ONE place a page pixel becomes a world target.
 *
 * Two shapes of target exist and both are handled here:
 *  - galaxy stars are point sprites; a click hits one if it lands within the sprite's
 *    screen radius plus a generous touch margin;
 *  - planets and moons are spheres; a click hits one if the camera ray passes through
 *    its drawn sphere, treated as at least ~12 px wide so a distant world is still
 *    reachable on a phone.
 *
 * Positions always come from the same objects the renderer draws, so "what is under
 * the cursor" and "what is on screen" cannot disagree.
 */

import * as THREE from 'three';

const ndc = new THREE.Vector2();
const projected = new THREE.Vector3();
const scratch = new THREE.Vector3();

/** Page/client pixels plus the canvas rect to normalised device coordinates. */
export function pointerToNdc(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
  out: THREE.Vector2 = ndc,
): THREE.Vector2 {
  out.set(((x - rect.left) / Math.max(rect.width, 1)) * 2 - 1, -((y - rect.top) / Math.max(rect.height, 1)) * 2 + 1);
  return out;
}

/** Whether a world point is in front of the camera and within the clip volume. */
export function projectToScreen(
  camera: THREE.Camera,
  world: THREE.Vector3,
  width: number,
  height: number,
  out: THREE.Vector2 = ndc,
): { x: number; y: number; visible: boolean } {
  projected.copy(world).project(camera);
  out.set(projected.x, projected.y);
  const visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.35 && Math.abs(projected.y) < 1.35;
  return {
    x: ((out.x + 1) / 2) * width,
    y: ((1 - out.y) / 2) * height,
    visible,
  };
}

/** Screen radius in CSS pixels of a sphere of `radiusWorld` at `world`. */
export function screenRadiusPx(
  camera: THREE.PerspectiveCamera,
  world: THREE.Vector3,
  radiusWorld: number,
  height: number,
): number {
  const distance = camera.position.distanceTo(world);
  if (distance <= radiusWorld) return height;
  const fov = (camera.fov * Math.PI) / 180;
  return (radiusWorld / distance) * (height / 2) / Math.tan(fov / 2);
}

export interface ScreenTarget<T> {
  readonly target: T;
  readonly position: THREE.Vector3;
  /** True drawn screen radius (CSS px), or a sprite radius for point-like targets. */
  readonly radiusPx: number;
}

/**
 * Pick the target whose projected disc is closest to the cursor, among those the cursor
 * is inside (with `slackPx` added for touch). Ties resolve to the nearer camera target,
 * which is the intuitive one when a moon sits in front of its planet.
 */
export function pickNearestOnScreen<T>(
  camera: THREE.PerspectiveCamera,
  x: number,
  y: number,
  width: number,
  height: number,
  targets: readonly ScreenTarget<T>[],
  slackPx: number,
): T | null {
  const point = new THREE.Vector2();
  let best: T | null = null;
  let bestScore = Infinity;
  for (const item of targets) {
    const screen = projectToScreen(camera, item.position, width, height, point);
    if (!screen.visible) continue;
    const dx = screen.x - x;
    const dy = screen.y - y;
    const distance = Math.hypot(dx, dy);
    const reach = Math.max(item.radiusPx, 5) + slackPx;
    if (distance > reach) continue;
    // Prefer the most "inside" target: normalised distance, with depth as a tiebreak.
    const score = distance / reach + camera.position.distanceTo(item.position) * 1e-6;
    if (score < bestScore) {
      bestScore = score;
      best = item.target;
    }
  }
  return best;
}

/** Distance along a ray to a sphere, or null when the ray misses. `t >= 0`. */
export function raySphereT(ray: THREE.Ray, center: THREE.Vector3, radius: number): number | null {
  scratch.subVectors(ray.origin, center);
  const b = scratch.dot(ray.direction);
  const c = scratch.lengthSq() - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sqrt = Math.sqrt(disc);
  const near = -b - sqrt;
  if (near >= 0) return near;
  const far = -b + sqrt;
  return far >= 0 ? 0 : null;
}

/** Ray from the camera through a client pixel. */
export function pointerRay(
  camera: THREE.PerspectiveCamera,
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
  out: THREE.Ray = new THREE.Ray(),
): THREE.Ray {
  const n = pointerToNdc(x, y, rect, new THREE.Vector2());
  out.origin.copy(camera.position);
  out.direction.set(n.x, n.y, 0.5).unproject(camera).sub(camera.position).normalize();
  return out;
}
