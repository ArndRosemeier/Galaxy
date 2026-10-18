/**
 * The renderer's public types, re-exported from `src/render/index.ts`.
 *
 * They live in their own module so the per-view modules can speak the dispatcher's
 * vocabulary without importing the dispatcher entry point (which imports them).
 */

import type * as THREE from 'three';

/** The three nested scales the app moves between. */
export type ViewKind = 'galaxy' | 'system' | 'planet';

/** What the pointer can select. Ids are the ids from `src/sim/types.ts`. */
export type PickTarget =
  | { kind: 'system'; id: string }
  | { kind: 'planet'; id: string }
  | { kind: 'moon'; id: string };

export interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
  onPick?(target: PickTarget | null): void;
  onHover?(target: PickTarget | null): void;
  onViewChange?(view: ViewKind): void;
}

export interface RenderInfo {
  drawCalls: number;
  triangles: number;
  points: number;
}

/** One pickable thing in the active scene: where it is and how big it is drawn. */
export interface WorldPickable {
  readonly target: PickTarget;
  readonly position: THREE.Vector3;
  /** Drawn radius in the scene's own units. Zero for point-like targets. */
  readonly radius: number;
}
