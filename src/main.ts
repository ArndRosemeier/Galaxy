import './styles.css';

/**
 * Application bootstrap.
 *
 * Day 1 of the build: this only clears the boot overlay. The generator and renderer
 * are built in parallel against `src/sim/types.ts`; integration replaces the body of
 * this file. Keeping it tiny is deliberate — it is the file both branches merge into,
 * so it stays quiet until there is something real to mount.
 */

const boot = document.getElementById('boot');
const ui = document.getElementById('ui');

if (ui && !ui.firstElementChild) {
  ui.innerHTML = `
    <header class="brand">
      <span class="brand__name">Galaxy</span>
      <span class="brand__sub">procedural atlas</span>
    </header>`;
}

boot?.classList.add('is-gone');
