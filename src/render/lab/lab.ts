/**
 * DEV LAB — not shipped. Mounts `GalaxyRenderer` against the temporary fixtures.
 *
 * URL: `lab.html?view=galaxy|system|planet[&planet=<id>]`
 * The HUD exists so a screenshot proves the draw-call/triangle/point counts of that
 * exact frame. `window.__GALAXY_READY__` flips after the renderer's first frame and
 * `window.__GALAXY_INFO__` tracks `info()` for the screenshot harness.
 */

import { GalaxyRenderer } from '../index';
import type { PickTarget, ViewKind } from '../api';
import { LAB_FOCUS, LAB_GALAXY, LAB_SYSTEM_A, findLabPlanet, findLabSystem } from './fixtures';

declare global {
  interface Window {
    __GALAXY_READY__?: boolean;
    __GALAXY_INFO__?: { drawCalls: number; triangles: number; points: number };
  }
}

const BUDGET: Record<ViewKind, { draws: number; note: string }> = {
  galaxy: { draws: 8, note: '≤400k points' },
  system: { draws: 120, note: '≤60k belt tris' },
  planet: { draws: 40, note: '≤120k tris' },
};

function parseView(raw: string | null): ViewKind {
  if (raw === 'system' || raw === 'planet') return raw;
  return 'galaxy';
}

const params = new URLSearchParams(window.location.search);
const initialView = parseView(params.get('view'));
const canvas = document.getElementById('scene');
const hudView = document.getElementById('hud-view');
const hudStats = document.getElementById('hud-stats');
const hudTarget = document.getElementById('hud-target');
const hudTime = document.getElementById('hud-time');
const hudBudget = document.getElementById('hud-budget');
const errorBox = document.getElementById('error');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('lab.html: #scene canvas is missing');

function showError(message: string): void {
  if (errorBox) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
  console.error(`[lab] ${message}`);
}

window.addEventListener('error', (event) => showError(event.message));
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  showError(reason instanceof Error ? reason.message : String(reason));
});

const host = findLabSystem(LAB_FOCUS.planetHostId);
const planetId = params.get('planet') ?? LAB_FOCUS.planetId;
const planet = findLabPlanet(host, planetId);

let currentView: ViewKind = initialView;

function targetLabel(target: PickTarget | null): string {
  if (!target) return '—';
  return `${target.kind} ${target.id}`;
}

function selectionFor(view: ViewKind): PickTarget | null {
  if (view === 'galaxy') {
    // A star out on an arm, so the selection ring demonstrates itself against the disc
    // instead of sitting on top of the core.
    return { kind: 'system', id: LAB_GALAXY.systems[120]?.id ?? LAB_FOCUS.systemId };
  }
  if (view === 'system') return { kind: 'planet', id: LAB_FOCUS.planetId };
  return null;
}

function refreshHud(): void {
  const budget = BUDGET[currentView];
  if (hudView) hudView.textContent = currentView.toUpperCase();
  if (hudTime) hudTime.textContent = 't+17.3 d · paused';
  if (hudBudget) hudBudget.textContent = `budget ${budget.draws} draws · ${budget.note}`;
}

let renderer: GalaxyRenderer | null = null;

try {
  renderer = new GalaxyRenderer({
    canvas,
    onPick(target) {
      renderer?.select(target);
      if (hudTarget) hudTarget.textContent = targetLabel(target);
    },
    onHover(target) {
      if (hudTarget) hudTarget.textContent = targetLabel(target);
    },
    onViewChange(view) {
      currentView = view;
      refreshHud();
      renderer?.select(selectionFor(view));
    },
  });

  renderer.setGalaxy(LAB_GALAXY);
  renderer.showSystem(LAB_SYSTEM_A);
  renderer.showPlanet(planet, host);
  renderer.setTime(17.3);
  renderer.setPlaying(false);
  renderer.setView(initialView, false);
  renderer.select(selectionFor(initialView));

  refreshHud();

  await renderer.ready;
  window.__GALAXY_READY__ = true;
  // Dev-only handle so a screenshot run can drive a camera flight (see the brief's
  // transition requirement). Nothing in the app imports this page.
  (window as unknown as { __GALAXY_LAB__?: unknown }).__GALAXY_LAB__ = renderer;

  const tick = (): void => {
    if (!renderer) return;
    const info = renderer.info();
    window.__GALAXY_INFO__ = info;
    const budgetNow = BUDGET[currentView];
    if (hudStats) {
      const over = info.drawCalls > budgetNow.draws;
      hudStats.textContent =
        `${info.drawCalls}/${budgetNow.draws} draws · ` +
        `${(info.triangles / 1000).toFixed(1)}k tris · ` +
        `${(info.points / 1000).toFixed(1)}k pts`;
      hudStats.style.color = over ? '#ff8d7a' : '';
    }
    if (hudTime) hudTime.textContent = 't+17.3 d · paused';
  };
  setInterval(tick, 300);
  tick();

  window.addEventListener('keydown', (event) => {
    if (!renderer) return;
    const next: ViewKind | null =
      event.key === '1' ? 'galaxy' : event.key === '2' ? 'system' : event.key === '3' ? 'planet' : null;
    if (!next) return;
    currentView = next;
    renderer.setView(next, true);
    renderer.select(selectionFor(next));
    refreshHud();
  });
} catch (error) {
  showError(error instanceof Error ? error.message : String(error));
}
