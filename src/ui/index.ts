/**
 * The UI shell — the one place that mounts panels, subscribes to the store and owns the
 * keyboard.
 *
 * Three rules shape this file:
 *  1. `app.store.state` is the only source of truth. Panels are updated from it; the UI
 *     keeps no second copy of anything but "which tab is open".
 *  2. A change is routed to the smallest updater that can express it. Hover changes
 *     touch nothing; the controller's 4 Hz time sync touches only the clock text; the
 *     inspector rebuilds only when the selection, the view or the parameters changed.
 *  3. The scene is the subject. At ≤ 900 px the two panels collapse into one bottom
 *     sheet, closed by default, with the time bar and breadcrumb always reachable.
 */

import type { AppState } from '../app/state';
import type { GalaxyApp } from '../app/controller';
import { createBrand } from './brand';
import { copyText } from './clipboard';
import { createCrumbs } from './crumbs';
import { el, icon, setAttr } from './dom';
import { errorText } from './errors';
import { createHelpOverlay } from './help-overlay';
import { createInspector } from './inspector';
import { keyContext, shortcutFor } from './keys';
import { createParamsPanel } from './params-panel';
import { shareUrl } from './share';
import { createTimeBar } from './time-bar';
import { createToast } from './toast';

type SheetTab = 'galaxy' | 'details';

const MOBILE_QUERY = '(max-width: 900px)';

export function mountUI(root: HTMLElement, app: GalaxyApp): () => void {
  const shell = el('div', { class: 'gx', attrs: { 'aria-live': 'off' } });

  const toast = createToast();
  const help = createHelpOverlay();

  const openHelp = (): void => help.open();

  const copyLink = async (): Promise<void> => {
    const link = shareUrl(app.store.state, {
      origin: window.location.origin,
      pathname: window.location.pathname,
    });
    try {
      await copyText(link);
      toast.show('Share link copied — seed, sliders and your place in the atlas.');
    } catch (error) {
      console.error('[galaxy ui] could not copy the share link:', error);
      toast.show(`Could not copy the link: ${errorText(error)}`, 'error');
    }
  };

  const brand = createBrand(() => void copyLink());
  const crumbs = createCrumbs(app);
  const params = createParamsPanel(app, () => void copyLink());
  const inspector = createInspector(app, { openHelp });
  const timebar = createTimeBar(app, { openHelp });

  /* ------------------------------------------------------------- mobile sheet */

  let tab: SheetTab = 'galaxy';
  let sheetOpen = false;
  let renderedOpen: boolean | null = null;

  const tabButtons: Record<SheetTab, HTMLButtonElement> = {
    galaxy: el(
      'button',
      { class: 'gx-sheet__tab', attrs: { type: 'button', 'data-tab': 'galaxy' } },
      el('span', { text: 'Parameters' }),
    ),
    details: el(
      'button',
      { class: 'gx-sheet__tab', attrs: { type: 'button', 'data-tab': 'details' } },
      el('span', { text: 'Details' }),
    ),
  };
  const sheetToggle = el('button', {
    class: 'gx-sheet__toggle',
    attrs: { type: 'button', 'aria-expanded': 'false', 'aria-label': 'Expand the panel' },
  });
  sheetToggle.append(icon('chevronUp'));

  const sheet = el(
    'div',
    { class: 'gx-sheethead', attrs: { 'data-testid': 'sheet' } },
    tabButtons.galaxy,
    tabButtons.details,
    sheetToggle,
  );

  const applySheet = (): void => {
    setAttr(shell, 'data-tab', tab);
    setAttr(shell, 'data-sheet', sheetOpen ? 'open' : 'closed');
    for (const name of ['galaxy', 'details'] as const) {
      // A tab is only "pressed" while its panel is actually showing; a highlighted tab
      // over a collapsed sheet reads as an empty panel.
      setAttr(tabButtons[name], 'aria-pressed', name === tab && sheetOpen ? 'true' : 'false');
    }
    setAttr(sheetToggle, 'aria-expanded', sheetOpen ? 'true' : 'false');
    const label = sheetOpen ? 'Collapse the panel' : 'Expand the panel';
    setAttr(sheetToggle, 'aria-label', label);
    setAttr(sheetToggle, 'title', label);
    if (renderedOpen !== sheetOpen) {
      renderedOpen = sheetOpen;
      sheetToggle.replaceChildren(icon(sheetOpen ? 'chevronDown' : 'chevronUp'));
    }
  };

  for (const name of ['galaxy', 'details'] as const) {
    tabButtons[name].addEventListener('click', () => {
      if (tab === name) sheetOpen = !sheetOpen;
      else {
        tab = name;
        sheetOpen = true;
      }
      applySheet();
    });
  }
  sheetToggle.addEventListener('click', () => {
    sheetOpen = !sheetOpen;
    applySheet();
  });

  /* -------------------------------------------------------------- composition */

  shell.append(
    brand.el,
    crumbs.el,
    params.el,
    inspector.el,
    sheet,
    timebar.el,
    help.el,
    toast.el,
  );
  root.append(shell);

  /* ----------------------------------------------------------------- keyboard */

  const onKeyDown = (event: KeyboardEvent): void => {
    if (help.isOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        help.close();
        return;
      }
      if (event.key === 'Tab') help.trapTab(event);
      return;
    }

    const target = event.target instanceof HTMLElement ? event.target : null;
    const context = keyContext({
      tagName: target?.tagName ?? '',
      type: target instanceof HTMLInputElement ? target.type : undefined,
      isContentEditable: target?.isContentEditable ?? false,
    });
    const action = shortcutFor(event, context);

    if (action === null) {
      // Escape inside a text field must blur the field and must NOT reach the global
      // handler in `main.ts`, which would navigate back.
      if (event.key === 'Escape' && context.textEditable && target) {
        event.preventDefault();
        target.blur();
      }
      return;
    }

    event.preventDefault();
    switch (action) {
      case 'play':
        app.setPlaying(!app.store.state.playing);
        break;
      case 'back':
        app.back();
        break;
      case 'randomize':
        params.flush();
        app.randomizeSeed();
        break;
      case 'copy':
        void copyLink();
        break;
      case 'help':
        help.open();
        break;
    }
  };
  window.addEventListener('keydown', onKeyDown);

  /* -------------------------------------------------------------- breakpoints */

  const media = window.matchMedia(MOBILE_QUERY);
  const onMediaChange = (): void => {
    timebar.setCompact(media.matches);
    if (media.matches) {
      const { selection } = app.store.state;
      tab = selection.systemId ? 'details' : 'galaxy';
      // The sheet stays closed: on a phone the world IS the point, and a dossier that
      // opens itself hides it. The Details tab carries a dot instead.
      sheetOpen = false;
    } else {
      sheetOpen = false;
    }
    applySheet();
  };
  media.addEventListener('change', onMediaChange);

  /* -------------------------------------------------------------- the state */

  const renderInitial = (state: AppState): void => {
    brand.update(state);
    params.update(state);
    crumbs.update(state);
    inspector.update(state);
    timebar.updateClock(state.timeDays);
    timebar.updateTransport(state);
    timebar.setCompact(media.matches);
    if (media.matches) {
      tab = state.selection.systemId ? 'details' : 'galaxy';
      // A deep link straight to a planet shows the world, not its dossier; the Details
      // tab is dotted so the reader knows there is something to open.
      sheetOpen = false;
    }
    applySheet();
    setAttr(shell, 'data-has-selection', state.selection.systemId ? 'true' : 'false');
  };

  const render = (state: AppState, previous: AppState): void => {
    const timeChanged = state.timeDays !== previous.timeDays;
    const transportChanged =
      state.playing !== previous.playing ||
      state.speedDaysPerSec !== previous.speedDaysPerSec;
    const paramsChanged = state.params !== previous.params;
    const placeChanged =
      state.view !== previous.view || state.selection !== previous.selection;

    // The clock is the only thing that moves most of the time: two text nodes, nothing else.
    if (timeChanged) timebar.updateClock(state.timeDays);
    if (transportChanged) timebar.updateTransport(state);
    if (!paramsChanged && !placeChanged) return;

    if (paramsChanged) {
      params.update(state);
      brand.update(state);
    }
    if (paramsChanged || placeChanged) {
      crumbs.update(state);
      inspector.update(state);
      setAttr(shell, 'data-has-selection', state.selection.systemId ? 'true' : 'false');

      // A parameter edit clears the selection too; that must not slam the sheet shut
      // under the finger that is dragging a slider.
      if (media.matches && !paramsChanged && state.selection !== previous.selection) {
        if (state.selection.planetId && state.selection.planetId !== previous.selection.planetId) {
          // Entering a world shows the world; the dossier opens only when asked for.
          tab = 'details';
        } else if (state.selection.systemId) {
          // A star was tapped: keep the system itself visible; the Details tab carries
          // the dot that says there is something to read.
          tab = 'details';
        } else {
          tab = 'galaxy';
          sheetOpen = false;
        }
        applySheet();
      }
    }
  };

  // A hand-edited link can name a view without the selection that view needs
  // (`?view=planet&planet=x` with no system). Showing the map is the only consistent
  // reading of that state, and it keeps the back affordance from walking into a
  // renderer that has no system to show.
  if (app.store.state.view !== 'galaxy' && app.store.state.selection.systemId === null) {
    app.setView('galaxy');
  }

  renderInitial(app.store.state);
  const unsubscribe = app.store.subscribe((state, previous) => render(state, previous));

  return () => {
    unsubscribe();
    window.removeEventListener('keydown', onKeyDown);
    media.removeEventListener('change', onMediaChange);
    params.dispose();
    toast.dispose();
    if (help.isOpen) help.close();
    shell.remove();
  };
}
