#!/usr/bin/env node
/**
 * shoot.mjs — headless visual verification for Galaxy.
 *
 * Loads a page in headless Chrome (software WebGL via SwiftShader), optionally acts
 * on it (click / wheel), captures a PNG, and reports the page's console errors and
 * exceptions. Read the PNG back with an image viewer to actually SEE the frame.
 *
 * It can serve a directory itself (`--serve`), so no long-running dev server has to
 * exist for a check, and everything it starts — the static server AND the whole
 * Chrome process tree — is killed in `finally`, on success and on failure alike.
 * A headless browser is a TREE: the launch is `detached` so the children share a
 * process group, and the group is what gets killed.
 *
 * Usage:
 *   node tools/shoot.mjs --serve dist --url / --out shots/home.png
 *   node tools/shoot.mjs --url http://127.0.0.1:5173/ --out shots/live.png --wait 4000
 *   node tools/shoot.mjs --serve dist --url / --out shots/zoom.png --wheel 720,450,-600 --wait 2500
 *
 * Flags:
 *   --url <path-or-url>   page to open (default "/")
 *   --out <file.png>      where to write the screenshot (required)
 *   --size <WxH>          viewport (default 1440x900)
 *   --wait <ms>           settle time after load and after each action (default 2500)
 *   --serve <dir>         serve this directory on an ephemeral port and prepend it
 *   --click <x,y>         left click at page coordinates (repeatable, in order)
 *   --wheel <x,y,dy>      wheel at page coordinates (repeatable, in order)
 *   --eval <js>           evaluate JS in the page after load (repeatable)
 *   --print <js>          evaluate JS and include its value in the printed JSON
 *   --click-selector <css>  real left click at an element's centre (repeatable)
 *   --wheel-selector <css:dx,dy>  real wheel over an element (repeatable)
 *   --key <Escape|Space|r|c|?>   dispatch a real keypress (repeatable)
 *   --allow-errors        do not exit 1 on page errors (for deliberately broken pages)
 *
 * Exit codes: 0 = captured and the page was clean · 1 = captured but the page erred
 * or the capture failed. Never invent a third meaning.
 */

import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME_BIN ?? '/opt/google/chrome/chrome';

// ---------------------------------------------------------------- cli parsing
const argv = process.argv.slice(2);
const opts = {
  url: '/',
  out: '',
  size: '1440x900',
  wait: 2500,
  serve: '',
  allowErrors: false,
  actions: [],
};

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const next = () => {
    const v = argv[i + 1];
    if (v === undefined) fail(`missing value for ${a}`);
    i += 1;
    return v;
  };
  switch (a) {
    case '--url': opts.url = next(); break;
    case '--out': opts.out = next(); break;
    case '--size': opts.size = next(); break;
    case '--wait': opts.wait = Number(next()); break;
    case '--serve': opts.serve = next(); break;
    case '--click': opts.actions.push({ kind: 'click', value: next() }); break;
    case '--wheel': opts.actions.push({ kind: 'wheel', value: next() }); break;
    case '--eval': opts.actions.push({ kind: 'eval', value: next() }); break;
    case '--print': opts.actions.push({ kind: 'print', value: next() }); break;
    case '--click-selector': opts.actions.push({ kind: 'clickSelector', value: next() }); break;
    case '--wheel-selector': opts.actions.push({ kind: 'wheelSelector', value: next() }); break;
    case '--key': opts.actions.push({ kind: 'key', value: next() }); break;
    case '--allow-errors': opts.allowErrors = true; break;
    case '--help': case '-h': usage(); process.exit(0); break;
    default: fail(`unknown flag ${a}`);
  }
}
if (!opts.out) fail('--out is required');
const [width, height] = opts.size.split('x').map(Number);
if (!Number.isFinite(width) || !Number.isFinite(height)) fail(`bad --size ${opts.size}`);

function fail(msg) {
  console.error(`shoot: ${msg}`);
  process.exit(2);
}
function usage() {
  console.log('see the header of tools/shoot.mjs for flags');
}

// ------------------------------------------------------------- static server
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
};

function startStaticServer(root) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = normalize(join(base, p));
      if (!file.startsWith(base)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      if (!existsSync(file)) {
        // SPA fallback: the app has one entry document.
        const fallback = join(base, 'index.html');
        if (!existsSync(fallback)) {
          res.writeHead(404).end('not found');
          return;
        }
        res.writeHead(200, { 'content-type': MIME['.html'] });
        res.end(readFileSync(fallback));
        return;
      }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      ok({ server, port: typeof addr === 'object' && addr ? addr.port : 0 });
    });
  });
}

// ------------------------------------------------------------------ chrome cdp
async function launchChrome(profileDir) {
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--user-data-dir=' + profileDir,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-extensions',
      '--disable-sync',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--enable-unsafe-swiftshader',
      '--remote-debugging-port=0',
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { detached: true, stdio: 'ignore' },
  );

  const portFile = join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const [portLine, wsPathLine] = readFileSync(portFile, 'utf8').split('\n');
      if (portLine && wsPathLine) {
        return { proc, port: Number(portLine), wsPath: wsPathLine.trim() };
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('headless Chrome did not expose a DevTools port within 20s');
}

function connect(wsUrl) {
  return new Promise((ok, no) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let id = 0;
    const events = [];
    const listeners = new Set();

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve: res, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        else res(msg.result);
      } else if (msg.method) {
        events.push(msg);
        for (const l of listeners) l(msg);
      }
    });
    ws.addEventListener('error', () => no(new Error('CDP socket error')));
    ws.addEventListener('open', () =>
      ok({
        send(method, params = {}, sessionId) {
          id += 1;
          const msgId = id;
          const payload = { id: msgId, method, params };
          if (sessionId) payload.sessionId = sessionId;
          return new Promise((res, rej) => {
            pending.set(msgId, { resolve: res, reject: rej });
            ws.send(JSON.stringify(payload));
          });
        },
        onEvent(fn) {
          listeners.add(fn);
        },
        events,
        close() {
          ws.close();
        },
      }),
    );
  });
}


async function evaluateJson(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? 'evaluate failed'));
  return r.result?.value ?? null;
}

// --------------------------------------------------------------------- driver
let server = null;
let chrome = null;
let profileDir = '';
const consoleErrors = [];
const pageErrors = [];
const prints = [];

try {
  let targetUrl = opts.url;
  if (opts.serve) {
    const started = await startStaticServer(opts.serve);
    server = started.server;
    targetUrl = `http://127.0.0.1:${started.port}${opts.url.startsWith('/') ? '' : '/'}${opts.url}`;
  }

  profileDir = await (async () => {
    const dir = join(tmpdir(), `galaxy-shoot-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    return dir;
  })();

  const launched = await launchChrome(profileDir);
  chrome = launched.proc;

  const cdp = await connect(`ws://127.0.0.1:${launched.port}${launched.wsPath}`);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  cdp.onEvent((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      consoleErrors.push(
        (msg.params.args ?? [])
          .map((a) => a.value ?? a.description ?? a.preview?.description ?? '')
          .join(' '),
      );
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params?.exceptionDetails?.exception?.description ?? 'exception');
    }
    if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
      consoleErrors.push(msg.params.entry.text);
    }
  });

  const loaded = new Promise((ok) => {
    const t = setTimeout(ok, 15_000);
    cdp.onEvent((msg) => {
      if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') {
        clearTimeout(t);
        ok();
      }
    });
  });

  await send('Page.navigate', { url: targetUrl });
  await loaded;
  await new Promise((r) => setTimeout(r, opts.wait));

  const runActions = async () => {
    for (const action of opts.actions) {
      if (action.kind === 'key') {
        // Keyboard is dispatched page-side as a real bubbling KeyboardEvent.
        // MEASURED 2026-10-18: CDP Input.dispatchKeyEvent on this Chrome (153) delivers
        // key:"" for synthetic presses, so every shortcut that switches on event.key
        // missed — a native dispatch would prove nothing about the app. This exercises
        // the app's own listener (bubble to window) exactly as a focused body would.
        const key = action.value === 'Space' ? ' ' : action.value;
        const known = {
          Escape: { code: 'Escape' },
          ' ': { code: 'Space' },
          Space: { code: 'Space' },
          r: { code: 'KeyR' },
          R: { code: 'KeyR' },
          c: { code: 'KeyC' },
          '?': { code: 'Slash' },
        }[key];
        if (!known) {
          pageErrors.push(`--key: unsupported key ${JSON.stringify(key)}`);
        } else {
          const script = `(() => {
            const target = document.activeElement && document.activeElement !== document.body
              ? document.activeElement
              : document.body;
            const opts = { key: ${JSON.stringify(key)}, code: ${JSON.stringify(known.code)}, bubbles: true, cancelable: true };
            const down = new KeyboardEvent('keydown', opts);
            target.dispatchEvent(down);
            target.dispatchEvent(new KeyboardEvent('keyup', opts));
            return true;
          })()`;
          const r = await send('Runtime.evaluate', { expression: script, returnByValue: true });
          if (r.exceptionDetails) pageErrors.push(String(r.exceptionDetails.exception?.description ?? ''));
        }
      } else if (action.kind === 'clickSelector' || action.kind === 'wheelSelector') {
        // Drive a REAL click at a DOM element's centre: the only way an end-to-end
        // check proves the event path (listener, state, camera) rather than the API.
        const box = await evaluateJson(
          send,
          `(() => {
             const el = document.querySelector(${JSON.stringify(action.value)});
             if (!el) return null;
             const r = el.getBoundingClientRect();
             return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
           })()`,
        );
        if (!box) {
          pageErrors.push(`click-selector: no element matches ${action.value}`);
        } else if (action.kind === 'clickSelector') {
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none' });
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
        } else {
          const [dx, dy] = String(action.value).split(':').slice(1).join(':').split(',').map(Number);
          await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: dx || 0, deltaY: dy || 0 });
        }
      } else if (action.kind === 'click') {
        const [x, y] = action.value.split(',').map(Number);
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      } else if (action.kind === 'wheel') {
        const [x, y, dy] = action.value.split(',').map(Number);
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy });
      } else if (action.kind === 'eval' || action.kind === 'print') {
        const r = await send('Runtime.evaluate', {
          expression: action.value,
          awaitPromise: true,
          returnByValue: true,
        });
        if (r.exceptionDetails) {
          pageErrors.push(String(r.exceptionDetails.exception?.description ?? ''));
        } else if (action.kind === 'print') {
          prints.push(r.result?.value);
        }
      }
      await new Promise((r) => setTimeout(r, Math.max(150, opts.wait / 2)));
    }
  };
  await runActions();

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await mkdir(resolve(opts.out, '..'), { recursive: true });
  await writeFile(opts.out, Buffer.from(shot.data, 'base64'));

  const bytes = (await readFile(opts.out)).byteLength;
  console.log(
    JSON.stringify(
      {
        shot: opts.out,
        bytes,
        size: `${width}x${height}`,
        url: targetUrl,
        consoleErrors,
        pageErrors,
        prints,
      },
      null,
      2,
    ),
  );

  const failed = !opts.allowErrors && (consoleErrors.length > 0 || pageErrors.length > 0);
  process.exitCode = failed ? 1 : 0;
} catch (err) {
  console.error(`shoot: FAILED — ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  // Kill the whole Chrome TREE by its process group, then the server, then the profile.
  if (chrome?.pid) {
    try {
      process.kill(-chrome.pid, 'SIGKILL');
    } catch {
      try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
    }
  }
  if (server) await new Promise((r) => server.close(r));
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
