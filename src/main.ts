import './styles.css';

import { GalaxyApp } from './app/controller';
import { mountUI } from './ui';

/**
 * Boot: one canvas, one app, one error surface.
 *
 * A missing WebGL2 context is stated plainly instead of swallowed — half of this app
 * is a renderer, and pretending otherwise would be the silent fallback the project
 * rules forbid.
 */

declare global {
  interface Window {
    __galaxy?: GalaxyApp;
    __GALAXY_READY__?: boolean;
  }
}

const canvas = document.getElementById('scene');
const boot = document.getElementById('boot');
const ui = document.getElementById('ui');

function fail(message: string, detail?: unknown): void {
  if (!ui) {
    document.body.textContent = message;
    return;
  }
  ui.innerHTML = '';
  const panel = document.createElement('section');
  panel.className = 'panel boot-error';
  panel.setAttribute('role', 'alert');
  panel.innerHTML = `
    <div class="panel__head"><h2 class="panel__title">Galaxy could not start</h2></div>
    <div class="panel__body">
      <p class="boot-error__message"></p>
      <p class="field__hint boot-error__detail"></p>
    </div>`;
  const messageEl = panel.querySelector('.boot-error__message');
  const detailEl = panel.querySelector('.boot-error__detail');
  if (messageEl) messageEl.textContent = message;
  if (detailEl) detailEl.textContent = detail instanceof Error ? detail.message : String(detail ?? '');
  ui.append(panel);
  boot?.classList.add('is-gone');
  console.error('[galaxy] fatal:', message, detail);
}

if (!(canvas instanceof HTMLCanvasElement)) {
  fail('The scene canvas is missing from the page.', 'index.html no longer has #scene.');
} else {
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) {
    fail(
      'This browser could not create a WebGL2 context.',
      'Galaxy needs WebGL2. Try a current Chrome, Firefox or Safari with hardware acceleration enabled.',
    );
  } else {
    try {
      const app = new GalaxyApp({
        canvas,
        onError: (message, detail) => fail(message, detail),
        onReady: () => {
          boot?.classList.add('is-gone');
          window.__GALAXY_READY__ = true;
        },
      });
      window.__galaxy = app;

      if (ui) {
        const disposeUI = mountUI(ui, app);
        window.addEventListener('pagehide', () => disposeUI());
      }

      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          app.back();
        }
      });
    } catch (error) {
      fail('The renderer failed to start.', error);
    }
  }
}
