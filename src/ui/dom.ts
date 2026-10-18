/**
 * Tiny DOM helpers. No framework and no virtual DOM: the panels build real elements
 * once and update text/attributes in place, which is what keeps a 4 Hz simulation clock
 * from rebuilding the inspector.
 */

type AttrValue = string | number | boolean | null | undefined;

export interface ElOptions {
  readonly class?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, AttrValue>>;
  readonly style?: Readonly<Record<string, string>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  ...children: readonly (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      if (value === null || value === undefined || value === false) continue;
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  if (options.style) {
    for (const [name, value] of Object.entries(options.style)) {
      node.style.setProperty(name, value);
    }
  }
  append(node, ...children);
  return node;
}

export function append(parent: Node, ...children: readonly (Node | string | null | undefined)[]): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** Write text only when it changed — avoids layout work and screen-reader churn. */
export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setAttr(node: Element, name: string, value: string | null): void {
  const current = node.getAttribute(name);
  if (value === null) {
    if (current !== null) node.removeAttribute(name);
    return;
  }
  if (current !== value) node.setAttribute(name, value);
}

export function toggleClass(node: Element, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
}

/* ------------------------------------------------------------- overflow cue */

export interface OverflowWatch {
  /** Re-read the scroll box after content changed. */
  update(): void;
  dispose(): void;
}

/**
 * Keep `data-more` on `panel` while `scroller` has content below the fold, so the
 * stylesheet can fade the panel's bottom edge exactly when there is more to read.
 * A ResizeObserver covers the case where the panel is shown or resized without a
 * content change (the mobile sheet, a window resize).
 */
export function watchOverflow(scroller: HTMLElement, panel: HTMLElement): OverflowWatch {
  const apply = (): void => {
    const below = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 4;
    const above = scroller.scrollTop > 4;
    const right = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft > 4;
    const left = scroller.scrollLeft > 4;
    if (panel.getAttribute('data-more') !== String(below)) {
      panel.setAttribute('data-more', String(below));
    }
    if (panel.getAttribute('data-above') !== String(above)) {
      panel.setAttribute('data-above', String(above));
    }
    if (panel.getAttribute('data-more-x') !== String(right)) {
      panel.setAttribute('data-more-x', String(right));
    }
    if (panel.getAttribute('data-before-x') !== String(left)) {
      panel.setAttribute('data-before-x', String(left));
    }
  };
  scroller.addEventListener('scroll', apply, { passive: true });
  const observer = new ResizeObserver(apply);
  observer.observe(scroller);
  apply();
  return {
    update: apply,
    dispose(): void {
      scroller.removeEventListener('scroll', apply);
      observer.disconnect();
      panel.removeAttribute('data-more');
      panel.removeAttribute('data-above');
      panel.removeAttribute('data-more-x');
      panel.removeAttribute('data-before-x');
    },
  };
}

/* ---------------------------------------------------------------------- icons */

export type IconName =
  | 'copy'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronUp'
  | 'chevronDown'
  | 'play'
  | 'pause'
  | 'sparkle'
  | 'help'
  | 'close'
  | 'rewind'
  | 'moon'
  | 'ring'
  | 'star';

interface Shape {
  readonly tag: 'path' | 'rect' | 'circle' | 'ellipse';
  readonly attrs: Readonly<Record<string, string>>;
}

const FILLED: Readonly<Record<string, string>> = { fill: 'currentColor', stroke: 'none' };

/** Small stroke icons, drawn on the same 24-unit grid as the design primitives. */
const ICONS: Readonly<Record<IconName, readonly Shape[]>> = {
  copy: [
    { tag: 'rect', attrs: { x: '9', y: '9', width: '11', height: '11', rx: '2' } },
    { tag: 'path', attrs: { d: 'M15 5.5H5.5A1.5 1.5 0 0 0 4 7v9.5' } },
  ],
  chevronLeft: [{ tag: 'path', attrs: { d: 'M14.5 5.5 8 12l6.5 6.5' } }],
  chevronRight: [{ tag: 'path', attrs: { d: 'M9.5 5.5 16 12l-6.5 6.5' } }],
  chevronUp: [{ tag: 'path', attrs: { d: 'M6.5 14.5 12 9l5.5 5.5' } }],
  chevronDown: [{ tag: 'path', attrs: { d: 'M6.5 9.5 12 15l5.5-5.5' } }],
  play: [{ tag: 'path', attrs: { d: 'M8.5 5.2v13.6L18.8 12z', ...FILLED } }],
  pause: [
    { tag: 'rect', attrs: { x: '7.5', y: '5.5', width: '3.2', height: '13', rx: '1', ...FILLED } },
    { tag: 'rect', attrs: { x: '13.3', y: '5.5', width: '3.2', height: '13', rx: '1', ...FILLED } },
  ],
  sparkle: [
    {
      tag: 'path',
      attrs: { d: 'M12 3.6l1.9 6.1 6.1 1.9-6.1 1.9L12 19.6l-1.9-6.1L4 11.6l6.1-1.9z', ...FILLED },
    },
  ],
  help: [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '8.8' } },
    { tag: 'path', attrs: { d: 'M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3c-.7.3-1.2 1-1.2 1.8v.4' } },
    { tag: 'path', attrs: { d: 'M12 17.1h.01' } },
  ],
  close: [{ tag: 'path', attrs: { d: 'M6 6l12 12M18 6 6 18' } }],
  rewind: [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '8.6' } },
    { tag: 'path', attrs: { d: 'M12 7.4V12l3.1 2' } },
  ],
  moon: [{ tag: 'path', attrs: { d: 'M20 14.4A8 8 0 1 1 9.6 4a6.4 6.4 0 0 0 10.4 10.4z' } }],
  ring: [
    { tag: 'ellipse', attrs: { cx: '12', cy: '12', rx: '10', ry: '4.1' } },
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '3' } },
  ],
  star: [
    {
      tag: 'path',
      attrs: {
        d: 'M12 3.4l2.4 5.5 5.9.6-4.4 4 1.2 5.9L12 16.4l-5.1 3 1.2-5.9-4.4-4 5.9-.6z',
        ...FILLED,
      },
    },
  ],
};

export function icon(name: IconName): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'gx-icon');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const shape of ICONS[name]) {
    const node = document.createElementNS(ns, shape.tag);
    for (const [key, value] of Object.entries(shape.attrs)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}
