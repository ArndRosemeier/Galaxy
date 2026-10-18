/**
 * The parameters panel: the atlas' legend. Presets first (the friendliest control),
 * then the seed, then one slider per `PARAM_SPECS` entry, each with its own hint and its
 * two pole labels.
 *
 * Slider edits are committed with a short trailing throttle: a drag would otherwise
 * regenerate the whole galaxy on every pointer move. The displayed value updates
 * immediately, so the control never feels laggy.
 *
 * Collapsible, because the scene matters more than the controls.
 */

import type { AppState } from '../app/state';
import { DEFAULT_PARAMS, PARAM_SPECS, PRESETS } from '../sim';
import type { NumericParamKey, ParamSpec } from '../sim/types';
import { activePresetId, applyPreset, commitSeed, resetShape } from './actions';
import { el, icon, setAttr, setText, toggleClass, watchOverflow } from './dom';
import { normalizeSeed, SEED_MAX_LENGTH } from './share';
import type { UiApp } from './types';

export interface ParamsPanel {
  readonly el: HTMLElement;
  update(state: AppState): void;
  /** Commit anything pending right now (called before a preset or randomize overrides it). */
  flush(): void;
  dispose(): void;
}

const COMMIT_DELAY_MS = 90;

interface SliderControl {
  readonly spec: ParamSpec;
  readonly input: HTMLInputElement;
  readonly value: HTMLOutputElement;
}

export function createParamsPanel(app: UiApp, onCopy: () => void): ParamsPanel {
  /* --------------------------------------------------------------- sliders */
  const sliders: SliderControl[] = [];
  const pending = new Map<NumericParamKey, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) return;
    const patch: Partial<Record<NumericParamKey, number>> = {};
    for (const [key, value] of pending) patch[key] = value;
    pending.clear();
    app.setParams(patch);
  };

  const queueCommit = (key: NumericParamKey, value: number): void => {
    pending.set(key, value);
    if (timer !== null) return;
    timer = setTimeout(flush, COMMIT_DELAY_MS);
  };

  const sliderList = el('div', { class: 'gx-sliders' });
  for (const spec of PARAM_SPECS) {
    const fieldId = `gx-param-${spec.key}`;
    const input = el('input', {
      attrs: {
        type: 'range',
        id: fieldId,
        min: spec.bounds.min,
        max: spec.bounds.max,
        step: spec.bounds.step,
        'data-testid': `param-${spec.key}`,
        'aria-describedby': `${fieldId}-hint`,
      },
    });
    input.value = String(app.store.state.params[spec.key]);

    const value = el('output', {
      class: 'field__value',
      attrs: { for: fieldId },
    });

    const ends = el(
      'div',
      { class: 'gx-param__ends' },
      spec.lowLabel ? el('span', { text: spec.lowLabel }) : el('span'),
      spec.highLabel ? el('span', { text: spec.highLabel }) : el('span'),
    );

    input.addEventListener('input', () => {
      const raw = Number(input.value);
      setText(value, spec.format(raw));
      queueCommit(spec.key, raw);
    });
    input.addEventListener('change', () => {
      const raw = Number(input.value);
      setText(value, spec.format(raw));
      pending.set(spec.key, raw);
      flush();
    });

    sliders.push({ spec, input, value });

    sliderList.append(
      el(
        'div',
        { class: 'field gx-param', attrs: { 'data-key': spec.key } },
        el(
          'div',
          { class: 'field__row' },
          el('label', { class: 'field__label', attrs: { for: fieldId }, text: spec.label }),
          value,
        ),
        input,
        ends,
        el('p', {
          class: 'field__hint',
          attrs: { id: `${fieldId}-hint` },
          text: spec.hint,
        }),
      ),
    );
  }

  /* --------------------------------------------------------------- presets */
  const presetGrid = el('div', {
    class: 'gx-presets',
    attrs: { role: 'group', 'aria-label': 'Galaxy presets' },
  });

  const scrollByCard = (direction: 1 | -1): void => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    presetGrid.scrollBy({
      left: direction * 178 * 1.5,
      behavior: reduced ? 'auto' : 'smooth',
    });
  };

  const previousPresets = el(
    'button',
    {
      class: 'btn btn--ghost btn--icon gx-strip__nav',
      attrs: {
        type: 'button',
        'aria-label': 'Scroll to earlier presets',
        title: 'Earlier presets',
      },
    },
    icon('chevronLeft'),
  );
  const nextPresets = el(
    'button',
    {
      class: 'btn btn--ghost btn--icon gx-strip__nav',
      attrs: {
        type: 'button',
        'aria-label': 'Scroll to later presets',
        title: 'Later presets',
      },
    },
    icon('chevronRight'),
  );
  previousPresets.addEventListener('click', () => scrollByCard(-1));
  nextPresets.addEventListener('click', () => scrollByCard(1));

  const updatePresetNav = (): void => {
    const max = presetGrid.scrollWidth - presetGrid.clientWidth;
    previousPresets.disabled = presetGrid.scrollLeft <= 2;
    nextPresets.disabled = presetGrid.scrollLeft >= max - 2;
  };
  presetGrid.addEventListener('scroll', updatePresetNav, { passive: true });
  const presetObserver = new ResizeObserver(updatePresetNav);
  presetObserver.observe(presetGrid);

  const presetButtons = new Map<string, HTMLButtonElement>();
  for (const preset of PRESETS) {
    const button = el(
      'button',
      {
        class: 'gx-preset',
        attrs: {
          type: 'button',
          'data-testid': `preset-${preset.id}`,
          'data-preset-id': preset.id,
          'aria-pressed': 'false',
          title: preset.blurb,
        },
      },
      el('span', { class: 'gx-preset__label', text: preset.label }),
      el('span', { class: 'gx-preset__blurb', text: preset.blurb }),
    );
    button.addEventListener('click', () => {
      flush();
      applyPreset(app, preset);
    });
    presetButtons.set(preset.id, button);
    presetGrid.append(button);
  }

  /* ------------------------------------------------------------------ seed */
  const seedInput = el('input', {
    class: 'gx-seed-input mono',
    attrs: {
      type: 'text',
      id: 'gx-seed-field',
      'data-testid': 'seed',
      maxlength: SEED_MAX_LENGTH,
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
      'aria-label': 'Galaxy seed',
    },
  });
  seedInput.value = app.store.state.params.seed;

  const seedError = el('p', {
    class: 'gx-seed-error',
    attrs: { role: 'alert', hidden: true },
    text: 'A seed cannot be empty — the field was restored to the current seed.',
  });
  let seedErrorTimer: ReturnType<typeof setTimeout> | null = null;
  const showSeedError = (): void => {
    seedError.hidden = false;
    if (seedErrorTimer !== null) clearTimeout(seedErrorTimer);
    seedErrorTimer = setTimeout(() => {
      seedError.hidden = true;
      seedErrorTimer = null;
    }, 3200);
  };
  seedInput.addEventListener('change', () => {
    const raw = seedInput.value;
    const applied = commitSeed(app, raw);
    if (!applied && normalizeSeed(raw) === '') showSeedError();
    if (!applied) seedInput.value = app.store.state.params.seed;
  });
  seedInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      seedInput.blur();
    }
  });

  const randomizeButton = el(
    'button',
    {
      class: 'btn gx-randomize',
      attrs: {
        type: 'button',
        'data-testid': 'randomize',
        'aria-keyshortcuts': 'R',
        title: 'Randomize the seed (R)',
      },
    },
    icon('sparkle'),
    el('span', { text: 'New seed' }),
  );
  randomizeButton.addEventListener('click', () => {
    flush();
    app.randomizeSeed();
  });

  const copyButton = el(
    'button',
    {
      class: 'btn gx-copy',
      attrs: {
        type: 'button',
        'data-testid': 'copy-link-panel',
        'aria-keyshortcuts': 'C',
        title: 'Copy a share link (C)',
      },
    },
    icon('copy'),
    el('span', { text: 'Copy link' }),
  );
  copyButton.addEventListener('click', onCopy);

  /* --------------------------------------------------------------- assembly */
  const defaultsButton = el('button', {
    class: 'gx-link',
    attrs: {
      type: 'button',
      'data-role': 'defaults',
      title: `Reset every shape control to its default (${DEFAULT_PARAMS.arms} arms, ${DEFAULT_PARAMS.systemCount} systems, …)`,
    },
    text: 'Defaults',
  });
  defaultsButton.addEventListener('click', () => {
    pending.clear();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    resetShape(app);
  });

  const body = el(
    'div',
    { class: 'panel__body gx-params__body', attrs: { id: 'gx-params-body' } },
    el(
      'section',
      { class: 'gx-params__section' },
      el(
        'div',
        { class: 'gx-section__head' },
        el('h3', { class: 'eyebrow', text: 'Presets' }),
        el(
          'div',
          { class: 'gx-section__tools' },
          el('span', { class: 'dim gx-section__note', text: 'one click, a whole galaxy' }),
          previousPresets,
          nextPresets,
        ),
      ),
      presetGrid,
    ),
    el(
      'section',
      { class: 'gx-params__section' },
      el(
        'div',
        { class: 'gx-section__head' },
        el('h3', { class: 'eyebrow', text: 'Seed' }),
        el('span', { class: 'dim gx-section__note', text: 'identity of the galaxy' }),
      ),
      el(
        'div',
        { class: 'gx-seed-row' },
        seedInput,
        randomizeButton,
      ),
      el('p', {
        class: 'field__hint',
        text: 'The same seed always rebuilds the same disc; a share link carries it.',
      }),
      seedError,
      copyButton,
    ),
    el('hr', { class: 'rule' }),
    el(
      'section',
      { class: 'gx-params__section' },
      el(
        'div',
        { class: 'gx-section__head' },
        el('h3', { class: 'eyebrow', text: 'Shape' }),
        defaultsButton,
      ),
      sliderList,
    ),
  );

  const collapseButton = el('button', {
    class: 'btn btn--ghost btn--icon gx-params__collapse',
    attrs: {
      type: 'button',
      'aria-expanded': 'true',
      'aria-controls': 'gx-params-body',
      'aria-label': 'Collapse the parameters',
      title: 'Collapse the parameters',
    },
  });
  collapseButton.append(icon('chevronUp'));

  const panel = el(
    'section',
    { class: 'panel gx-panel gx-params', attrs: { 'data-collapsed': 'false' } },
    el(
      'div',
      { class: 'panel__head' },
      el('h2', { class: 'panel__title', text: 'Parameters' }),
      el('div', { class: 'gx-panel__actions' }, collapseButton),
    ),
    body,
  );

  const overflow = watchOverflow(body, panel);
  const presetOverflow = watchOverflow(presetGrid, presetGrid);

  const setCollapsed = (collapsed: boolean): void => {
    setAttr(panel, 'data-collapsed', collapsed ? 'true' : 'false');
    setAttr(collapseButton, 'aria-expanded', collapsed ? 'false' : 'true');
    const label = collapsed ? 'Expand the parameters' : 'Collapse the parameters';
    setAttr(collapseButton, 'aria-label', label);
    setAttr(collapseButton, 'title', label);
    collapseButton.replaceChildren(icon(collapsed ? 'chevronDown' : 'chevronUp'));
    overflow.update();
  };
  collapseButton.addEventListener('click', () => {
    setCollapsed(panel.getAttribute('data-collapsed') !== 'true');
  });

  return {
    el: panel,
    flush,
    update(state: AppState): void {
      const params = state.params;
      if (document.activeElement !== seedInput && seedInput.value !== params.seed) {
        seedInput.value = params.seed;
      }
      for (const slider of sliders) {
        const raw = params[slider.spec.key];
        const asText = String(raw);
        if (slider.input.value !== asText) slider.input.value = asText;
        setText(slider.value, slider.spec.format(raw));
      }
      const active = activePresetId(state);
      for (const [id, button] of presetButtons) {
        const on = id === active;
        toggleClass(button, 'is-active', on);
        setAttr(button, 'aria-pressed', on ? 'true' : 'false');
      }
      overflow.update();
      presetOverflow.update();
      updatePresetNav();
    },
    dispose(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (seedErrorTimer !== null) {
        clearTimeout(seedErrorTimer);
        seedErrorTimer = null;
      }
      pending.clear();
      overflow.dispose();
      presetOverflow.dispose();
      presetObserver.disconnect();
    },
  };
}
