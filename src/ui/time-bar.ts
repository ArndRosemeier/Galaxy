/**
 * The time bar: play/pause, the speed ladder, and the simulation clock.
 *
 * It is the only thing in the UI that updates while the simulation runs, and even then
 * only its clock text changes — `updateClock` is called at the controller's 4 Hz sync
 * and touches two text nodes.
 */

import type { AppState } from '../app/state';
import { el, icon, setAttr, setText } from './dom';
import { formatSimDate, formatSimDay } from './format';
import { SPEED_STEPS, speedLabel } from './keys';
import { interactionHint } from './labels';
import type { UiApp } from './types';

export interface TimeBarDeps {
  openHelp(): void;
}

export interface TimeBarPanel {
  readonly el: HTMLElement;
  updateClock(days: number): void;
  updateTransport(state: AppState): void;
  setCompact(compact: boolean): void;
}

export function createTimeBar(app: UiApp, deps: TimeBarDeps): TimeBarPanel {
  const playButton = el('button', {
    class: 'btn gx-play',
    attrs: {
      type: 'button',
      'data-testid': 'play-toggle',
      'aria-pressed': 'true',
      'aria-label': 'Pause the simulation',
      'aria-keyshortcuts': 'Space',
      title: 'Play / pause (Space)',
    },
  });
  playButton.append(icon('pause'));
  playButton.addEventListener('click', () => {
    app.setPlaying(!app.store.state.playing);
  });

  const speedGroup = el('div', {
    class: 'gx-speeds',
    attrs: {
      role: 'group',
      'aria-label': 'Simulation speed, in days per second',
      'data-testid': 'speed',
    },
  });
  const speedButtons = new Map<number, HTMLButtonElement>();
  for (const step of SPEED_STEPS) {
    const button = el('button', {
      class: 'gx-speed',
      attrs: {
        type: 'button',
        'data-speed': String(step),
        'aria-pressed': 'false',
        'aria-label': `${speedLabel(step)} ${step === 1 ? 'day' : 'days'} per second`,
        title: step === 0 ? 'Frozen time' : `${speedLabel(step)} days per second`,
      },
      text: speedLabel(step),
    });
    button.addEventListener('click', () => app.setSpeed(step));
    speedButtons.set(step, button);
    speedGroup.append(button);
  }

  const dayText = el('span', { class: 'gx-clock__day mono', attrs: { 'data-testid': 'clock' } });
  const dateText = el('span', { class: 'gx-clock__date' });
  const clock = el('div', { class: 'gx-clock' }, dayText, dateText);

  const rewindButton = el(
    'button',
    {
      class: 'btn btn--ghost btn--icon gx-rewind',
      attrs: {
        type: 'button',
        'aria-label': 'Return the simulation to day zero',
        title: 'Return to day zero',
      },
    },
    icon('rewind'),
  );
  rewindButton.addEventListener('click', () => app.setTime(0));

  const hint = el('p', { class: 'gx-hint' });
  const helpButton = el('button', {
    class: 'gx-help-btn',
    attrs: {
      type: 'button',
      'data-testid': 'help',
      'aria-label': 'Keyboard shortcuts (?)',
      'aria-keyshortcuts': '?',
      title: 'Keyboard shortcuts (?)',
    },
    text: '?',
  });
  helpButton.addEventListener('click', deps.openHelp);

  const bar = el(
    'footer',
    { class: 'panel gx-timebar', attrs: { 'aria-label': 'Simulation time' } },
    el('div', { class: 'gx-timebar__row' }, playButton, speedGroup, clock),
    el(
      'div',
      { class: 'gx-timebar__foot' },
      hint,
      el('div', { class: 'gx-timebar__tools' }, rewindButton, helpButton),
    ),
  );

  let lastPlaying: boolean | null = null;
  let clockOutOfRange = false;

  return {
    el: bar,
    updateClock(days: number): void {
      setText(dayText, formatSimDay(days));
      try {
        setText(dateText, formatSimDate(days));
      } catch (error) {
        // A hand-edited `?t=` can exceed the range of a calendar date. The day count is
        // still true, so the clock states the limit instead of dying mid-frame.
        if (!clockOutOfRange) {
          clockOutOfRange = true;
          console.error('[galaxy ui] the simulation clock is beyond a calendar date:', error);
        }
        setText(dateText, 'beyond the calendar');
      }
    },
    updateTransport(state: AppState): void {
      const playing = state.playing;
      if (playing !== lastPlaying) {
        lastPlaying = playing;
        playButton.replaceChildren(icon(playing ? 'pause' : 'play'));
        setAttr(playButton, 'aria-pressed', playing ? 'true' : 'false');
        setAttr(playButton, 'aria-label', playing ? 'Pause the simulation' : 'Resume the simulation');
      }
      for (const [step, button] of speedButtons) {
        const active = step === state.speedDaysPerSec;
        setAttr(button, 'aria-pressed', active ? 'true' : 'false');
        if (button.classList.contains('is-active') !== active) button.classList.toggle('is-active', active);
      }
    },
    setCompact(compact: boolean): void {
      setText(hint, interactionHint(compact));
    },
  };
}
