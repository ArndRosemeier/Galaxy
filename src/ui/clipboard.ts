/**
 * Clipboard access with a loud failure path.
 *
 * The async Clipboard API needs a secure context; the fallback covers a plain-http
 * deployment. If both refuse, the caller says so in a toast — a copy button that
 * silently does nothing is exactly the kind of fallback the project rules forbid.
 */

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  fallbackCopy(text);
}

function fallbackCopy(text: string): void {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  try {
    const copied = document.execCommand('copy');
    if (!copied) throw new Error('the browser refused the copy command');
  } finally {
    area.remove();
  }
}
