/**
 * GalaxyRenderer — the integration surface the dispatcher builds against.
 *
 * The API is deliberately small and stable (see the doc comments on each method). The
 * renderer owns three scenes at three scales, one camera, one post chain, and the
 * transitions between them; it never generates content and never reads app state.
 *
 * ## What it guarantees
 *  - **One camera.** Galaxy/system/planet are poses on the same perspective camera.
 *    `setView(view, true)` is two glides with a scene swap covered by a short flash:
 *    fly toward the subject in the outgoing scale, flash, pull back in the incoming
 *    scale. `prefers-reduced-motion` turns every flight into a jump.
 *  - **Frozen data only.** Bodies are placed with `positionAtAU` / `moonPositionKm`;
 *    nothing here re-derives an orbit and nothing here touches `src/sim`.
 *  - **Loud failure.** Asking for a view whose scene has not been populated throws;
 *    the constructor throws if the context cannot do HDR render targets. There is no
 *    silent black universe.
 *  - **Measured.** `info()` reports the draw calls / triangles / points of the last
 *    frame across every post pass, against the budgets in `docs/ARCHITECTURE.md`.
 *
 * Interaction: `pick(x, y)` takes page pixels (client coordinates), as do the
 * callbacks. Hover and click are wired to the canvas; `select()` only paints a
 * highlight — the app decides what a click means.
 */

import * as THREE from 'three';
import type { Galaxy, Planet, StarSystem } from '../sim/types';
import type { PickTarget, RenderInfo, RendererOptions, ViewKind, WorldPickable } from './api';
import { CameraRig, closePose, directionFromAngles, type CameraPose } from './camera';
import { PostChain } from './post';
import { GalaxyView } from './galaxyView';
import { SystemView } from './systemView';
import { PlanetView } from './planetView';
import { Markers } from './markers';
import { pickNearestOnScreen, projectToScreen, screenRadiusPx, type ScreenTarget } from './pick';

export type { PickTarget, RendererOptions, RenderInfo, ViewKind } from './api';

/** Per-view post settings: the galaxy glows, a world must not wash out. */
const VIEW_LOOK: Record<ViewKind, { bloom: number; exposure: number; vignette: number }> = {
  galaxy: { bloom: 0.55, exposure: 0.97, vignette: 0.40 },
  system: { bloom: 0.5, exposure: 1.0, vignette: 0.34 },
  planet: { bloom: 0.42, exposure: 1.12, vignette: 0.30 },
};


interface Flight {
  readonly to: ViewKind;
  readonly startedAt: number;
  readonly departMs: number;
  readonly arriveMs: number;
  readonly arrivalNear: CameraPose;
  readonly arrivalPose: CameraPose;
  activated: boolean;
}

function sameTarget(a: PickTarget | null, b: PickTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.id === b.id;
}

export class GalaxyRenderer {
  readonly ready: Promise<void>;

  private readonly options: RendererOptions;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly rig: CameraRig;
  private readonly post: PostChain;
  private readonly markers = new Markers();
  private readonly emptyScene = new THREE.Scene();
  private readonly abort = new AbortController();
  private resizeObserver: ResizeObserver | null = null;

  private galaxyView: GalaxyView | null = null;
  private systemView: SystemView | null = null;
  private planetView: PlanetView | null = null;

  private view: ViewKind = 'galaxy';
  private renderView: ViewKind = 'galaxy';
  private poses: Partial<Record<ViewKind, CameraPose>> = {};
  private selection: PickTarget | null = null;
  private hovered: PickTarget | null = null;
  private focusStar: THREE.Vector3 | null = null;
  private focusPlanetId: string | null = null;
  private interactedSinceView = false;

  private timeDays = 0;
  private playing = true;
  private speed = 1;
  private elapsed = 0;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private lastInfo: RenderInfo = { drawCalls: 0, triangles: 0, points: 0 };
  private lastFrame = 0;
  private raf = 0;
  private flash = 0;
  private flight: Flight | null = null;
  private disposed = false;
  private readyFired = false;
  private resolveReady!: () => void;
  private pointerDown: { x: number; y: number; at: number; pointerId: number } | null = null;

  constructor(options: RendererOptions) {
    this.options = options;
    this.canvas = options.canvas;

    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: false, // MSAA happens on the HDR scene target (post.ts), not here.
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.NoToneMapping; // ACES is applied once, in post.ts.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;

    this.rig = new CameraRig(options.canvas, 50);
    this.rig.controls.addEventListener('start', () => {
      this.interactedSinceView = true;
    });

    this.post = new PostChain(this.renderer);

    this.attachInput();
    this.setDeferredSize();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize(this.canvas.clientWidth, this.canvas.clientHeight);
      });
      this.resizeObserver.observe(this.canvas);
    }
    window.addEventListener(
      'resize',
      () => this.resize(this.canvas.clientWidth, this.canvas.clientHeight),
      { signal: this.abort.signal },
    );

    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ content

  setGalaxy(galaxy: Galaxy): void {
    const old = this.galaxyView;
    this.galaxyView = new GalaxyView(galaxy);
    this.galaxyView.setDpr(this.dpr);
    this.galaxyView.setViewport(this.height * this.dpr, this.rig.camera.fov);
    if (old) {
      old.scene.remove(this.markers.points);
      old.dispose();
    }
    if (this.selection?.kind === 'system' && !this.galaxyView.systemPosition(this.selection.id)) {
      this.selection = null;
    }
    this.hovered = null;
    this.focusStar = null;
    this.focusPlanetId = null;
    this.poses.galaxy = undefined;
    if (this.renderView === 'galaxy') {
      this.refreshMarkersScene();
      if (!this.flight) this.rig.setPose(this.galaxyOverviewPose());
    }
  }

  showSystem(system: StarSystem): void {
    const old = this.systemView;
    this.systemView = new SystemView(system, this.timeDays, this.dpr);
    this.systemView.setSelected(this.selection);
    if (old) {
      old.scene.remove(this.markers.points);
      old.dispose();
    }
    if (this.selection && this.selection.kind !== 'system' && !this.systemView.positionOf(this.selection)) {
      this.selection = null;
    }
    this.hovered = null;
    this.focusPlanetId = null;
    this.poses.system = undefined;
    if (this.renderView === 'system') {
      this.refreshMarkersScene();
      if (!this.flight) this.rig.setPose(this.systemView.defaultPose(this.aspect(), this.rig.camera.fov));
    }
  }

  showPlanet(planet: Planet, host: StarSystem): void {
    const old = this.planetView;
    this.planetView = new PlanetView(planet, host, this.timeDays, this.dpr);
    if (old) {
      old.scene.remove(this.markers.points);
      old.dispose();
    }
    this.hovered = null;
    this.poses.planet = undefined;
    if (this.renderView === 'planet') {
      this.refreshMarkersScene();
      if (!this.flight) {
        this.rig.setPose(this.planetView.defaultPose(this.aspect(), this.rig.camera.fov));
      }
    }
  }

  // ------------------------------------------------------------------- camera

  setView(view: ViewKind, animate = true): void {
    if (view === this.view && view === this.renderView && !this.flight) return;
    this.requireView(view);

    // A view change always flies at a body, even if the app did not call focusSystem()
    // first: the incoming system's star (or world) is the obvious destination, and a
    // flight to the galaxy's centre instead would read as a zoom into nothing.
    if (view === 'system' && this.systemView) {
      this.focusStar = new THREE.Vector3(
        this.systemView.system.position.x,
        this.systemView.system.position.y,
        this.systemView.system.position.z,
      );
    } else if (view === 'planet' && this.planetView) {
      this.focusPlanetId = this.planetView.planet.id;
    }

    if (this.flight) this.cancelFlight();

    const from = this.renderView;
    this.view = view;
    if (from === view) {
      this.rig.glideTo(this.poseFor(view), animate ? 700 : 0, 'inout');
      return;
    }
    this.poses[from] = from === 'galaxy' ? this.galaxyOverviewFromCurrent() : this.rig.getPose();

    if (!animate || this.rig.reducedMotion) {
      this.activate(view, this.poseFor(view));
      this.options.onViewChange?.(view);
      return;
    }

    const galaxyInvolved = from === 'galaxy' || view === 'galaxy';
    const departMs = galaxyInvolved ? 950 : 750;
    const arriveMs = galaxyInvolved ? 1150 : 950;
    this.flight = {
      to: view,
      startedAt: performance.now(),
      departMs,
      arriveMs,
      arrivalNear: this.portalPose(view),
      arrivalPose: this.poseFor(view),
      activated: false,
    };
    this.rig.glideTo(this.portalPose(from), departMs, 'in', undefined, true);
  }

  focusSystem(id: string): void {
    const galaxy = this.galaxyView;
    if (!galaxy) {
      throw new Error('GalaxyRenderer.focusSystem: setGalaxy() has not been called — there is no system to focus.');
    }
    const position = galaxy.systemPosition(id);
    if (!position) {
      throw new Error(`GalaxyRenderer.focusSystem: no system with id "${id}" in the current galaxy.`);
    }
    this.focusStar = position.clone();
    this.focusPlanetId = null;
    if (this.renderView !== 'galaxy' || this.flight) return;

    const offset = this.rig.camera.position.clone().sub(this.rig.controls.target);
    const distance = Math.min(offset.length(), galaxy.radius * 0.22);
    const pose = closePose(
      position,
      offset.lengthSq() > 0.0001 ? offset.normalize() : directionFromAngles(0.6, -0.6),
      Math.max(distance, galaxy.radius * 0.07),
      this.galaxyNear(galaxy),
      galaxy.radius * 40,
    );
    this.rig.glideTo(pose, 1100, 'inout');
  }

  focusPlanet(id: string): void {
    const system = this.systemView;
    if (!system) {
      throw new Error('GalaxyRenderer.focusPlanet: showSystem() has not been called — there is no planet to focus.');
    }
    const target = system.planetVisual(id);
    if (!target) {
      throw new Error(`GalaxyRenderer.focusPlanet: no planet with id "${id}" in the current system.`);
    }
    this.focusPlanetId = id;
    if (this.renderView === 'planet' && this.planetView?.planet.id === id) return;
    if (this.renderView !== 'system' || this.flight) return;

    const offset = this.rig.camera.position.clone().sub(this.rig.controls.target);
    const direction = offset.lengthSq() > 0.0001 ? offset.normalize() : directionFromAngles(0.4, 0.62);
    const distance = Math.max(target.radiusAU * 7, system.starRadius * 0.8);
    this.rig.glideTo(
      closePose(target.position, direction, distance, Math.max(system.starRadius * 0.02, 1e-5), system.outerAU * 120),
      1000,
      'inout',
    );
  }

  // --------------------------------------------------------------- selection

  select(target: PickTarget | null): void {
    this.selection = target;
    this.systemView?.setSelected(target);
  }

  // -------------------------------------------------------------------- time

  setTime(days: number): void {
    if (!Number.isFinite(days)) {
      throw new Error(`GalaxyRenderer.setTime: days must be finite, got ${String(days)}.`);
    }
    this.timeDays = days;
    this.applyTime();
  }

  setSpeed(daysPerSecond: number): void {
    if (!Number.isFinite(daysPerSecond)) {
      throw new Error(`GalaxyRenderer.setSpeed: daysPerSecond must be finite, got ${String(daysPerSecond)}.`);
    }
    this.speed = daysPerSecond;
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  // ---------------------------------------------------------------- viewport

  resize(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(width, height, false);
    this.post.setSize(width, height, this.dpr);
    this.rig.setAspect(this.aspect());
    this.markers.setDpr(this.dpr);
    this.galaxyView?.setDpr(this.dpr);
    this.galaxyView?.setViewport(this.height * this.dpr, this.rig.camera.fov);
    this.systemView?.setDpr(this.dpr);
    this.planetView?.setDpr(this.dpr);

    if (!this.flight && !this.interactedSinceView && this.hasView(this.renderView)) {
      this.rig.setPose(this.poseFor(this.renderView));
    }
  }

  // ---------------------------------------------------------------- picking

  pick(x: number, y: number): PickTarget | null {
    if (this.flight) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const camera = this.rig.camera;

    if (this.renderView === 'galaxy') {
      const galaxy = this.galaxyView;
      if (!galaxy) return null;
      const targets: ScreenTarget<PickTarget>[] = [];
      for (const star of galaxy.stars) {
        const projected = projectToScreen(camera, star.position, rect.width, rect.height);
        if (!projected.visible) continue;
        targets.push({
          target: { kind: 'system', id: star.stub.id },
          position: star.position,
          radiusPx: 5 + star.stub.brightness * 5,
        });
      }
      return pickNearestOnScreen(camera, x, y, rect.width, rect.height, targets, 7);
    }

    const pickables: WorldPickable[] =
      this.renderView === 'system'
        ? (this.systemView?.pickables() ?? [])
        : (this.planetView?.pickables() ?? []);
    const targets: ScreenTarget<PickTarget>[] = pickables.map((item) => ({
      target: item.target,
      position: item.position,
      radiusPx: Math.max(screenRadiusPx(camera, item.position, item.radius, rect.height), 7),
    }));
    return pickNearestOnScreen(camera, x, y, rect.width, rect.height, targets, 6);
  }

  getView(): ViewKind {
    return this.view;
  }

  info(): RenderInfo {
    return { ...this.lastInfo };
  }

  // ---------------------------------------------------------------- lifecycle

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.rig.dispose();
    this.markers.dispose();
    this.galaxyView?.dispose();
    this.systemView?.dispose();
    this.planetView?.dispose();
    this.galaxyView = null;
    this.systemView = null;
    this.planetView = null;
    this.post.dispose();
    this.renderer.dispose();
    this.canvas.style.cursor = '';
  }

  // ------------------------------------------------------------------ internal

  private aspect(): number {
    return this.width / Math.max(this.height, 1);
  }

  private hasView(view: ViewKind): boolean {
    if (view === 'galaxy') return this.galaxyView !== null;
    if (view === 'system') return this.systemView !== null;
    return this.planetView !== null;
  }

  private requireView(view: ViewKind): void {
    if (view === 'galaxy' && !this.galaxyView) {
      throw new Error('GalaxyRenderer.setView("galaxy"): setGalaxy() has not been called.');
    }
    if (view === 'system' && !this.systemView) {
      throw new Error('GalaxyRenderer.setView("system"): showSystem() has not been called — there is no system to show.');
    }
    if (view === 'planet' && !this.planetView) {
      throw new Error('GalaxyRenderer.setView("planet"): showPlanet() has not been called — there is no world to show.');
    }
  }

  private setDeferredSize(): void {
    const width = this.canvas.clientWidth || this.canvas.width || window.innerWidth;
    const height = this.canvas.clientHeight || this.canvas.height || window.innerHeight;
    this.resize(width, height);
  }

  private galaxyNear(galaxy: GalaxyView): number {
    return Math.max(galaxy.radius * 0.0004, 0.2);
  }

  private galaxyOverviewPose(): CameraPose {
    const galaxy = this.galaxyView;
    if (!galaxy) {
      throw new Error('GalaxyRenderer: no galaxy loaded — cannot compose the galaxy view.');
    }
    const radius = galaxy.radius;
    const fovY = this.rig.camera.fov * (Math.PI / 180);
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * this.aspect());
    const elevation = 0.62;
    const horizontal = (radius * 1.24) / Math.tan(fovX / 2);
    const vertical = (radius * Math.sin(elevation) * 1.38 + radius * 0.05) / Math.tan(fovY / 2);
    const distance = Math.max(horizontal, vertical);
    return {
      position: directionFromAngles(elevation, -0.62).multiplyScalar(distance),
      target: new THREE.Vector3(0, 0, 0),
      near: this.galaxyNear(galaxy),
      far: radius * 40,
    };
  }

  private galaxyOverviewFromCurrent(): CameraPose {
    const galaxy = this.galaxyView;
    if (!galaxy) throw new Error('GalaxyRenderer: no galaxy loaded.');
    const overview = this.galaxyOverviewPose();
    const offset = this.rig.camera.position.clone().sub(this.rig.controls.target);
    if (offset.lengthSq() < 1e-6) return overview;
    offset.normalize();
    const elevation = Math.min(Math.max(Math.asin(Math.max(-1, Math.min(1, offset.y))), 0.25), 1.15);
    const azimuth = Math.atan2(offset.x, offset.z);
    const distance = overview.position.length();
    return {
      position: directionFromAngles(elevation, azimuth).multiplyScalar(distance),
      target: new THREE.Vector3(0, 0, 0),
      near: overview.near,
      far: overview.far,
    };
  }

  private poseFor(view: ViewKind): CameraPose {
    switch (view) {
      case 'galaxy':
        return this.poses.galaxy ?? this.galaxyOverviewPose();
      case 'system':
        return (
          this.poses.system ??
          this.systemView!.defaultPose(this.aspect(), this.rig.camera.fov)
        );
      case 'planet':
        return (
          this.poses.planet ??
          this.planetView!.defaultPose(this.aspect(), this.rig.camera.fov)
        );
    }
  }

  /** The close-up frame the flash hides, at either end of a transition. */
  private portalPose(view: ViewKind): CameraPose {
    if (view === 'galaxy') {
      const galaxy = this.galaxyView;
      if (!galaxy) throw new Error('GalaxyRenderer: no galaxy loaded.');
      const target = this.focusStar ?? new THREE.Vector3(0, 0, 0);
      const distance = Math.max(galaxy.radius * 0.045, this.galaxyNear(galaxy) * 4);
      return closePose(target, directionFromAngles(0.55, -0.62), distance, this.galaxyNear(galaxy), galaxy.radius * 40);
    }
    if (view === 'system') {
      const system = this.systemView!;
      const near = Math.max(system.starRadius * 0.02, 1e-5);
      const far = system.outerAU * 120;
      const planet = this.focusPlanetId ? system.planetVisual(this.focusPlanetId) : null;
      if (planet) {
        return closePose(planet.position, directionFromAngles(0.34, 0.62), Math.max(planet.radiusAU * 3.4, near * 8), near, far);
      }
      return system.starPortalPose(directionFromAngles(0.3, 0.62));
    }
    return this.planetView!.portalPose();
  }

  private activate(view: ViewKind, pose: CameraPose, enableControls = true): void {
    this.renderView = view;
    this.refreshMarkersScene();
    this.applyViewLimits(view);
    this.rig.setPose(pose, enableControls);
    this.interactedSinceView = false;
    this.systemView?.setSelected(this.selection);
  }

  private applyViewLimits(view: ViewKind): void {
    if (view === 'galaxy') {
      const radius = this.galaxyView?.radius ?? 1000;
      this.rig.setLimits(radius * 0.012, radius * 9, 0.05, Math.PI - 0.05);
    } else if (view === 'system' && this.systemView) {
      this.rig.setLimits(
        Math.max(this.systemView.starRadius * 1.15, 1e-4),
        this.systemView.outerAU * 9,
        0.02,
        Math.PI - 0.02,
      );
    } else if (view === 'planet') {
      this.rig.setLimits(1.24, 30, 0.12, Math.PI - 0.12);
    }
  }

  private refreshMarkersScene(): void {
    this.markers.points.removeFromParent();
    const scene = this.sceneFor(this.renderView);
    if (scene) scene.add(this.markers.points);
    else this.emptyScene.add(this.markers.points);
  }

  private sceneFor(view: ViewKind): THREE.Scene | null {
    if (view === 'galaxy') return this.galaxyView?.scene ?? null;
    if (view === 'system') return this.systemView?.scene ?? null;
    return this.planetView?.scene ?? null;
  }

  private cancelFlight(): void {
    if (!this.flight) return;
    const to = this.flight.to;
    this.flight = null;
    this.flash = 0;
    this.activate(to, this.poseFor(to));
  }

  private updateFlight(now: number): void {
    const flight = this.flight;
    if (!flight) {
      this.flash = 0;
      return;
    }
    const elapsed = now - flight.startedAt;
    const total = flight.departMs + flight.arriveMs;
    const progress = Math.min(Math.max(elapsed / total, 0), 1);
    // A short, bright pulse at the swap: the scale change disappears inside the light.
    this.flash = Math.pow(Math.sin(Math.PI * progress), 5) * 0.88;

    if (!flight.activated && elapsed >= flight.departMs) {
      flight.activated = true;
      this.activate(flight.to, flight.arrivalNear, false);
      this.options.onViewChange?.(flight.to);
      this.rig.glideTo(flight.arrivalPose, flight.arriveMs, 'out', () => {
        if (this.flight === flight) this.finishFlight();
      });
    }
    if (elapsed >= total + 600 && this.flight === flight) {
      // Safety net for a background tab or a clock jump: land the transition cleanly.
      if (!flight.activated) {
        this.activate(flight.to, flight.arrivalPose);
        this.options.onViewChange?.(flight.to);
      }
      this.finishFlight();
    }
  }

  private finishFlight(): void {
    this.flight = null;
    this.flash = 0;
  }

  private applyTime(): void {
    this.systemView?.setTime(this.timeDays);
    this.planetView?.setTime(this.timeDays);
  }

  private positionOf(target: PickTarget | null): THREE.Vector3 | null {
    if (!target) return null;
    if (this.renderView === 'galaxy') {
      return target.kind === 'system' ? (this.galaxyView?.systemPosition(target.id) ?? null) : null;
    }
    if (this.renderView === 'system') return this.systemView?.positionOf(target) ?? null;
    if (this.renderView === 'planet') return this.planetView?.positionOf(target) ?? null;
    return null;
  }

  private updateMarkers(): void {
    if (this.flight) {
      this.markers.set(null, null);
      return;
    }
    const hover = this.positionOf(this.hovered);
    const selected = this.positionOf(this.selection);
    this.markers.set(hover, selected);
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(Math.max((now - this.lastFrame) / 1000, 0), 0.1);
    this.lastFrame = now;
    this.elapsed += dt;

    if (this.playing && this.speed !== 0 && (this.systemView || this.planetView)) {
      this.timeDays += this.speed * dt;
      this.applyTime();
    }

    this.rig.update(now);
    this.updateFlight(now);
    if (this.renderView === 'system') this.systemView?.updateFrame(this.elapsed);
    else if (this.renderView === 'planet') this.planetView?.updateFrame(this.elapsed);
    this.updateMarkers();

    const scene = this.sceneFor(this.renderView) ?? this.emptyScene;
    this.post.setFlash(this.flash);
    this.renderer.info.reset();
    const look = VIEW_LOOK[this.renderView];
    this.post.render(scene, this.rig.camera, {
      bloomStrength: look.bloom,
      exposure: look.exposure,
      vignette: look.vignette,
    });

    const counts = this.renderer.info.render;
    this.lastInfo.drawCalls = counts.calls;
    this.lastInfo.triangles = counts.triangles;
    this.lastInfo.points = counts.points;

    if (!this.readyFired) {
      this.readyFired = true;
      this.resolveReady();
    }
  };

  private attachInput(): void {
    const signal = this.abort.signal;
    this.canvas.addEventListener(
      'pointermove',
      (event: PointerEvent) => {
        if (this.flight || this.pointerDown) return;
        const target = this.pick(event.clientX, event.clientY);
        if (!sameTarget(target, this.hovered)) {
          this.hovered = target;
          this.options.onHover?.(target);
        }
        this.canvas.style.cursor = target ? 'pointer' : 'grab';
      },
      { signal },
    );
    this.canvas.addEventListener('pointerleave', () => {
      if (this.hovered) {
        this.hovered = null;
        this.options.onHover?.(null);
      }
      this.canvas.style.cursor = 'grab';
    }, { signal });
    this.canvas.addEventListener(
      'pointerdown',
      (event: PointerEvent) => {
        if (this.flight) return;
        this.pointerDown = { x: event.clientX, y: event.clientY, at: performance.now(), pointerId: event.pointerId };
        this.canvas.style.cursor = 'grabbing';
      },
      { signal },
    );
    this.canvas.addEventListener(
      'pointerup',
      (event: PointerEvent) => {
        const down = this.pointerDown;
        this.pointerDown = null;
        this.canvas.style.cursor = this.hovered ? 'pointer' : 'grab';
        if (!down || down.pointerId !== event.pointerId || this.flight) return;
        const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
        const held = performance.now() - down.at;
        if (moved > 6 || held > 900) return;
        this.options.onPick?.(this.pick(event.clientX, event.clientY));
      },
      { signal },
    );
  }
}
