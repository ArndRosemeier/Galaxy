/**
 * Breadcrumb + back — the "never wonder how to go back" affordance.
 *
 * It sits directly under the masthead, so the left rail reads top-to-bottom as
 * identity → location → controls. The row is one fixed-height line: a long system name
 * truncates instead of wrapping, because a wrapping crumb would push the whole
 * parameters panel down every time the selection changed.
 *
 * The crumbs follow the *view*, not the selection: a URL can point at a system while
 * the camera is at the map, and the trail must describe where the camera is.
 */

import type { AppState } from '../app/state';
import { goToGalaxy, goToSystem } from './actions';
import { el, icon, setAttr } from './dom';
import type { UiApp } from './types';

export interface CrumbsPanel {
  readonly el: HTMLElement;
  update(state: AppState): void;
}

type CrumbKind = 'galaxy' | 'system' | 'planet';

interface Crumb {
  readonly kind: CrumbKind;
  readonly label: string;
}

export function createCrumbs(app: UiApp): CrumbsPanel {
  const backButton = el(
    'button',
    {
      class: 'btn btn--ghost gx-back',
      attrs: {
        type: 'button',
        'data-testid': 'back',
        'aria-label': 'Back one level (Esc)',
        'aria-keyshortcuts': 'Escape',
        title: 'Back one level (Esc)',
      },
    },
    icon('chevronLeft'),
    el('span', { class: 'gx-back__text', text: 'Back' }),
  );
  backButton.addEventListener('click', () => {
    if (!backButton.disabled) app.back();
  });

  const list = el('ol', { class: 'gx-crumbs__list' });

  list.addEventListener('click', (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>('[data-crumb]');
    if (!button) return;
    const kind = button.dataset.crumb;
    if (kind === 'galaxy') goToGalaxy(app);
    else if (kind === 'system') goToSystem(app);
    else if (kind === 'planet' && app.store.state.view !== 'planet') app.setView('planet');
  });

  const nav = el('nav', { class: 'gx-crumbs', attrs: { 'aria-label': 'Location' } }, backButton, list);

  let signature = '';

  function rebuild(crumbs: readonly Crumb[]): void {
    list.replaceChildren();
    crumbs.forEach((crumb, index) => {
      if (index > 0) {
        list.append(
          el('li', { class: 'gx-crumbs__sep', attrs: { 'aria-hidden': 'true' }, text: '›' }),
        );
      }
      const current = index === crumbs.length - 1;
      const button = el('button', {
        class: current ? 'gx-crumb is-current' : 'gx-crumb',
        attrs: {
          type: 'button',
          'data-crumb': crumb.kind,
          'data-testid': `crumb-${crumb.kind}`,
          'aria-current': current ? 'page' : null,
          title: crumb.kind === 'galaxy' ? 'The galaxy map' : crumb.label,
        },
        text: crumb.label,
      });
      list.append(el('li', { class: 'gx-crumbs__item' }, button));
    });
  }

  return {
    el: nav,
    update(state: AppState): void {
      const system = app.selectedSystem;
      const planet = app.selectedPlanet;
      const crumbs: Crumb[] = [{ kind: 'galaxy', label: 'Galaxy' }];
      if (state.view !== 'galaxy' && state.selection.systemId) {
        crumbs.push({ kind: 'system', label: system?.name ?? 'System' });
      }
      if (state.view === 'planet' && state.selection.planetId) {
        crumbs.push({ kind: 'planet', label: planet?.name ?? 'Planet' });
      }

      const nextSignature = crumbs.map((crumb) => `${crumb.kind}:${crumb.label}`).join('|');
      if (nextSignature !== signature) {
        signature = nextSignature;
        rebuild(crumbs);
      }

      const canGoBack = state.view !== 'galaxy';
      backButton.disabled = !canGoBack;
      setAttr(backButton, 'aria-disabled', canGoBack ? null : 'true');
      setAttr(backButton, 'title', canGoBack ? 'Back one level (Esc)' : 'You are at the galaxy map');
    },
  };
}
