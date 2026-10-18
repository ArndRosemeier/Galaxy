/**
 * The inspector — the atlas' data page.
 *
 * Three scales, three cards: nothing selected teaches the click path, a system shows its
 * star and worlds, a planet opens its full dossier. The panel is a fixed box (it fills
 * the right edge top to bottom) so changing the selection can never shift the layout;
 * only the inside scrolls, and only when it overflows.
 *
 * Rebuilds are keyed: the body is regenerated only when the selection, the view or the
 * parameters actually change. Hover and the 4 Hz clock never reach it.
 */

import type { AppState } from '../app/state';
import type { Atmosphere, Moon, Planet, StarSystem } from '../sim/types';
import { selectPlanet, toggleMoon } from './actions';
import { append, el, icon, setText, watchOverflow } from './dom';
import { errorText } from './errors';
import {
  chemicalFormula,
  cssColor,
  formatAu,
  formatAuRange,
  formatDayLength,
  formatEarthMasses,
  formatFraction,
  formatGravity,
  formatGreenhouse,
  formatKilometreRange,
  formatKilometres,
  formatKelvin,
  formatPercent,
  formatPressure,
  formatSolarMass,
  formatSolarRadius,
  formatLuminosity,
  formatTemperature,
  formatThickness,
  formatYearLength,
} from './format';
import { galaxySummary, kindLabel, lifeLabel, plural, spectralNote } from './labels';
import type { UiApp } from './types';

export interface InspectorPanel {
  readonly el: HTMLElement;
  update(state: AppState): void;
}

export interface InspectorDeps {
  openHelp(): void;
}

const STEPS: readonly (readonly [string, string])[] = [
  ['Click a star', 'enter its system'],
  ['Click a planet', 'open its dossier'],
  ['Press Esc', 'go back one level'],
];

export function createInspector(app: UiApp, deps: InspectorDeps): InspectorPanel {
  const context = el('span', { class: 'gx-panel__context' });
  const body = el('div', { class: 'panel__body gx-inspector__body' });

  const panel = el(
    'aside',
    { class: 'panel gx-panel gx-inspector', attrs: { 'aria-label': 'Inspector' } },
    el(
      'div',
      { class: 'panel__head' },
      el('h2', { class: 'panel__title', text: 'Inspector' }),
      context,
    ),
    body,
  );

  const overflow = watchOverflow(body, panel);

  body.addEventListener('click', (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const planetButton = target.closest<HTMLElement>('[data-planet-id]');
    if (planetButton) {
      const planetId = planetButton.dataset.planetId;
      const planet = app.selectedSystem?.planets.find((candidate) => candidate.id === planetId);
      if (planet) selectPlanet(app, planet);
      return;
    }

    const moonButton = target.closest<HTMLElement>('[data-moon-id]');
    if (moonButton) {
      const moonId = moonButton.dataset.moonId;
      if (moonId) toggleMoon(app, moonId);
      return;
    }

    if (target.closest('[data-role="help"]')) deps.openHelp();
  });

  let lastParams: AppState['params'] | null = null;
  let paramsVersion = 0;
  let key = '';

  function kv(rows: readonly (readonly [string, string])[]): HTMLElement {
    const list = el('dl', { class: 'kv' });
    for (const [term, value] of rows) {
      list.append(el('dt', { text: term }), el('dd', { text: value }));
    }
    return list;
  }

  function section(title: string, ...content: readonly (Node | string)[]): HTMLElement {
    const node = el(
      'section',
      { class: 'gx-section' },
      el('h4', { class: 'eyebrow gx-section__title', text: title }),
    );
    append(node, ...content);
    return node;
  }

  function swatch(color: string, modifier: string): HTMLElement {
    return el('span', {
      class: `gx-swatch ${modifier}`,
      attrs: { 'aria-hidden': 'true' },
      style: { '--dot': color },
    });
  }

  function head(
    marker: HTMLElement,
    name: string,
    meta: string,
    chip?: HTMLElement,
  ): HTMLElement {
    const text = el(
      'div',
      { class: 'gx-head__text' },
      el('h3', { class: 'gx-head__name', text: name }),
      el('p', { class: 'gx-head__meta', text: meta }),
    );
    const node = el('header', { class: 'gx-head' }, marker, text);
    if (chip) node.append(chip);
    return node;
  }

  function paragraph(text: string): HTMLElement {
    return el('p', { class: 'gx-sentence', text });
  }

  function errorCard(title: string, message: string, hint: string): HTMLElement {
    return el(
      'div',
      { class: 'gx-error', attrs: { role: 'alert' } },
      el('h3', { class: 'gx-error__title', text: title }),
      el('p', { class: 'gx-error__text', text: message }),
      el('p', { class: 'field__hint', text: hint }),
    );
  }

  function emptyState(state: AppState): HTMLElement {
    const steps = el('ol', { class: 'gx-steps' });
    STEPS.forEach(([label, detail], index) => {
      steps.append(
        el(
          'li',
          { class: 'gx-step' },
          el('span', { class: 'gx-step__num mono', text: String(index + 1) }),
          el(
            'div',
            { class: 'gx-step__text' },
            el('strong', { text: label }),
            el('span', { class: 'dim', text: detail }),
          ),
        ),
      );
    });

    return el(
      'div',
      { class: 'gx-empty' },
      el('div', { class: 'gx-empty__mark' }, icon('star')),
      el('h3', { class: 'gx-empty__title', text: 'Nothing selected yet' }),
      el('p', {
        class: 'gx-empty__lead',
        text: 'Click a star in the disc to enter its system, then click a planet to open its dossier.',
      }),
      el('p', { class: 'gx-empty__summary', text: galaxySummary(state.params) }),
      steps,
      el(
        'button',
        {
          class: 'btn gx-empty__help',
          attrs: { type: 'button', 'data-role': 'help' },
        },
        icon('help'),
        el('span', { text: 'Keyboard shortcuts' }),
      ),
    );
  }

  function worldRow(planet: Planet, selected: boolean): HTMLElement {
    const moons = planet.moons.length;
    const extras: string[] = [];
    if (moons > 0) extras.push(plural(moons, 'moon'));
    if (planet.rings) extras.push('ring system');
    const label = [
      planet.name,
      kindLabel(planet.kind),
      formatKilometres(planet.radiusKm),
      formatKelvin(planet.temperatureK),
      ...extras,
    ].join(', ');

    const glyphs = el('span', {
      class: 'gx-world__glyphs',
      attrs: { 'aria-hidden': 'true' },
    });
    if (moons > 0) {
      glyphs.append(
        el(
          'span',
          { class: 'gx-glyph', attrs: { title: plural(moons, 'moon') } },
          icon('moon'),
          el('span', { class: 'gx-glyph__count', text: String(moons) }),
        ),
      );
    }
    if (planet.rings) {
      glyphs.append(el('span', { class: 'gx-glyph', attrs: { title: 'Ring system' } }, icon('ring')));
    }

    const button = el(
      'button',
      {
        class: selected ? 'gx-world is-selected' : 'gx-world',
        attrs: {
          type: 'button',
          'data-testid': 'planet-row',
          'data-planet-id': planet.id,
          'aria-current': selected ? 'true' : null,
          'aria-label': label,
        },
      },
      el('span', {
        class: 'gx-world__dot',
        attrs: { 'aria-hidden': 'true' },
        style: { '--dot': cssColor(planet.surface.colors.mid) },
      }),
      el('span', { class: 'gx-world__name', text: planet.name }),
      glyphs,
      el('span', { class: 'chip gx-world__kind', text: kindLabel(planet.kind) }),
      el('span', {
        class: 'gx-world__facts mono',
        text: `${formatKilometres(planet.radiusKm)} · ${formatKelvin(planet.temperatureK)}`,
      }),
    );

    return el('li', { class: 'gx-worlds__item' }, button);
  }

  function systemCard(state: AppState, system: StarSystem): HTMLElement {
    const star = system.star;
    const worlds = el('ul', { class: 'gx-worlds' });
    system.planets.forEach((planet) => {
      worlds.append(worldRow(planet, state.selection.planetId === planet.id));
    });

    const card = el('div', { class: 'gx-card' });
    card.append(
      head(
        swatch(cssColor(star.color), 'gx-swatch--star'),
        star.name,
        `${star.spectral}-class · ${spectralNote(star.spectral)}`,
        el('span', {
          class: 'chip gx-chip--spectral mono',
          attrs: { title: `Spectral class ${star.spectral}` },
          text: star.spectral,
        }),
      ),
      kv([
        ['Temperature', formatTemperature(star.temperatureK)],
        ['Radius', formatSolarRadius(star.radiusSun)],
        ['Luminosity', formatLuminosity(star.luminositySun)],
        ['Mass', formatSolarMass(star.massSun)],
      ]),
      el('hr', { class: 'rule' }),
      el(
        'div',
        { class: 'gx-section__head' },
        el('h4', { class: 'eyebrow', text: 'Worlds' }),
        el('span', { class: 'dim gx-section__note', text: plural(system.planets.length, 'world') }),
      ),
      worlds,
    );

    if (system.belts.length > 0) {
      card.append(
        el(
          'div',
          { class: 'gx-note' },
          el('span', { class: 'gx-note__label', text: 'Debris' }),
          el('span', {
            class: 'gx-note__body',
            text: system.belts
              .map((belt) => `${belt.name} · ${formatAuRange(belt.innerAU, belt.outerAU)}`)
              .join(' — '),
          }),
        ),
      );
    }

    return card;
  }

  function atmosphereSection(atmosphere: Atmosphere): HTMLElement {
    const gases = el('ul', { class: 'gx-gases' });
    for (const entry of atmosphere.composition) {
      // Trace gases keep a visible sliver: the bar is a composition, not a log scale.
      const share = Math.max(0, Math.min(1, entry.fraction)) * 100;
      const width = `${share > 0 ? Math.max(share, 1.5) : 0}%`;
      gases.append(
        el(
          'li',
          { class: 'gx-gas' },
          el('span', { class: 'gx-gas__name', text: chemicalFormula(entry.gas) }),
          el(
            'span',
            { class: 'gx-gas__bar', attrs: { 'aria-hidden': 'true' } },
            el('span', { class: 'gx-gas__fill', style: { width } }),
          ),
          el('span', { class: 'gx-gas__pct mono', text: formatFraction(entry.fraction) }),
        ),
      );
    }

    return section(
      'Atmosphere',
      el(
        'div',
        { class: 'gx-atmo__head' },
        el('span', { class: 'mono', text: formatPressure(atmosphere.pressureAtm) }),
        el('span', { class: 'dim', text: formatGreenhouse(atmosphere.greenhouseK) }),
      ),
      gases,
    );
  }

  function moonList(moons: readonly Moon[], selectedMoonId: string | null): HTMLElement {
    const list = el('ul', { class: 'gx-moons' });
    for (const moon of moons) {
      const facts = `${formatKilometres(moon.radiusKm)} radius · orbit ${formatKilometres(
        moon.orbit.radiusKm,
      )} · ${formatYearLength(moon.orbit.periodDays)}`;
      const button = el(
        'button',
        {
          class: selectedMoonId === moon.id ? 'gx-moon is-selected' : 'gx-moon',
          attrs: {
            type: 'button',
            'data-moon-id': moon.id,
            'aria-current': selectedMoonId === moon.id ? 'true' : null,
            'aria-label': `${moon.name}, ${facts}`,
            title: 'Select this moon',
          },
        },
        el('span', { class: 'gx-moon__name', text: moon.name }),
        el('span', { class: 'gx-moon__facts mono', text: facts }),
      );
      list.append(el('li', {}, button));
    }
    return list;
  }

  function planetCard(state: AppState, planet: Planet): HTMLElement {
    const card = el('div', { class: 'gx-card' });
    const chips = el('div', { class: 'gx-chips' });
    chips.append(el('span', { class: 'chip gx-chip--kind', text: kindLabel(planet.kind) }));
    const kindText = kindLabel(planet.kind).toLowerCase();
    for (const tag of planet.tags) {
      if (kindText.includes(tag.toLowerCase())) continue;
      chips.append(el('span', { class: 'chip', text: tag }));
    }

    card.append(
      head(
        swatch(cssColor(planet.surface.colors.mid), 'gx-swatch--planet'),
        planet.name,
        `${kindLabel(planet.kind)} · ${formatEarthMasses(planet.massEarth)}`,
      ),
      chips,
      el('p', { class: 'gx-lede', text: planet.description }),
      section(
        'Physical',
        kv([
          ['Radius', formatKilometres(planet.radiusKm)],
          ['Mass', formatEarthMasses(planet.massEarth)],
          ['Gravity', formatGravity(planet.gravityG)],
          ['Temperature', formatTemperature(planet.temperatureK)],
          ['Day', formatDayLength(planet.dayHours)],
          ['Year', formatYearLength(planet.yearDays)],
          ['Orbit', formatAu(planet.orbit.semiMajorAU)],
          ['Reflects', formatPercent(planet.albedo)],
        ]),
      ),
    );

    if (planet.atmosphere) {
      card.append(atmosphereSection(planet.atmosphere));
    } else {
      card.append(section('Atmosphere', paragraph('Airless — no measurable atmosphere.')));
    }

    if (planet.hydrosphere) {
      const water = planet.hydrosphere;
      card.append(
        section(
          'Water',
          paragraph(
            `Liquid covers ${formatPercent(water.coverage)} of the surface, to a mean depth of ${formatKilometres(
              water.depthKm,
            )}.`,
          ),
        ),
      );
    } else {
      card.append(section('Water', paragraph('No standing liquid on the surface.')));
    }

    if (planet.biosphere) {
      card.append(
        section(
          'Life',
          el(
            'div',
            { class: 'gx-life' },
            el('span', { class: 'chip chip--life', text: lifeLabel(planet.biosphere.level) }),
            el('p', { class: 'gx-sentence', text: planet.biosphere.summary }),
          ),
        ),
      );
    } else {
      card.append(section('Life', paragraph('No life detected.')));
    }

    if (planet.rings) {
      const rings = planet.rings;
      card.append(
        section(
          'Rings',
          kv([
            ['Span', formatKilometreRange(rings.innerRadiusKm, rings.outerRadiusKm)],
            ['Material', rings.composition],
            ['Thickness', formatThickness(rings.thicknessKm)],
            ['Opacity', formatPercent(rings.opacity)],
          ]),
        ),
      );
    } else {
      card.append(section('Rings', paragraph('No ring system.')));
    }

    card.append(
      section(
        'Moons',
        planet.moons.length === 0
          ? paragraph('No moons.')
          : moonList(planet.moons, state.selection.moonId),
      ),
    );

    return card;
  }

  function render(state: AppState): void {
    const selection = state.selection;
    let system: StarSystem | null = null;
    let planet: Planet | null = null;
    try {
      system = selection.systemId ? app.selectedSystem : null;
      planet = selection.planetId ? app.selectedPlanet : null;
    } catch (error) {
      console.error('[galaxy ui] the inspector could not resolve the selection:', error);
      setText(context, 'Error');
      body.replaceChildren(
        errorCard(
          'The inspector could not read this place',
          errorText(error),
          'Press Esc to go back to the galaxy map.',
        ),
      );
      return;
    }

    setText(context, planet?.name ?? system?.name ?? 'Galaxy');

    if (selection.systemId && !system) {
      body.replaceChildren(
        errorCard(
          'This star system is not in the galaxy',
          `Nothing matches the id “${selection.systemId}” in the current seed. The link may predate a change to the seed or a slider.`,
          'Press Esc to go back to the galaxy map.',
        ),
      );
      return;
    }
    if (selection.planetId && !planet) {
      body.replaceChildren(
        errorCard(
          'This world is not in the selected system',
          `The system no longer contains the id “${selection.planetId}”.`,
          'Press Esc to go back to its system.',
        ),
      );
      return;
    }

    try {
      if (!system) {
        body.replaceChildren(emptyState(state));
      } else if (!planet) {
        body.replaceChildren(systemCard(state, system));
      } else {
        body.replaceChildren(planetCard(state, planet));
      }
    } catch (error) {
      console.error('[galaxy ui] the inspector could not format this view:', error);
      setText(context, 'Error');
      body.replaceChildren(
        errorCard(
          'This dossier could not be formatted',
          errorText(error),
          'The generated data is inconsistent; the rest of the app is unaffected.',
        ),
      );
    }
  }

  return {
    el: panel,
    update(state: AppState): void {
      if (state.params !== lastParams) {
        lastParams = state.params;
        paramsVersion += 1;
      }
      const selection = state.selection;
      const nextKey = `${paramsVersion}|${state.view}|${selection.systemId}|${selection.planetId}|${selection.moonId}`;
      if (nextKey === key) return;
      key = nextKey;
      render(state);
      overflow.update();
    },
  };
}
