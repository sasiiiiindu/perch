import { describe, expect, it } from 'vitest';
import { missingRequired, precacheFiles, serviceWorkerSource, versionOf } from '../build/pwa';

const BUILD = [
  'index.html', 'assets/index-abc.js', 'assets/index-abc.css', 'assets/pitch-processor-x1.js',
  'assets/analysis-worker-y2.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
];

describe('precache list', () => {
  it('lists every built file except the service worker and source maps', () => {
    expect(precacheFiles([...BUILD, 'sw.js', 'assets/index-abc.js.map'])).toEqual([...BUILD].sort());
  });

  it('has everything Perch needs to start offline', () => {
    expect(missingRequired(BUILD)).toEqual([]);
    expect(missingRequired(BUILD.filter((f) => !f.includes('pitch-processor'))).length).toBe(1);
    expect(missingRequired(BUILD.filter((f) => !f.includes('analysis-worker'))).length).toBe(1);
  });

  it('changes version when any file name changes', () => {
    expect(versionOf(BUILD)).toBe(versionOf([...BUILD]));
    expect(versionOf(BUILD)).not.toBe(versionOf(BUILD.map((f) => f.replace('abc', 'abd'))));
  });
});

/** Runs the generated service worker against fake caches and network. */
function runWorker(files: string[]) {
  const scope = 'https://example.github.io/perch/';
  const listeners: Record<string, (event: never) => void> = {};
  const cached = new Map<string, string>();
  const added: string[] = [];
  const self = {
    registration: { scope },
    clients: { claim: async () => {} },
    addEventListener: (type: string, fn: (event: never) => void) => { listeners[type] = fn; },
  };
  const caches = {
    open: async () => ({ addAll: async (requests: Request[]) => {
      for (const r of requests) { added.push(r.url); cached.set(r.url, `cached ${r.url}`); }
    } }),
    keys: async () => ['perch-old', 'other-app'],
    delete: async () => true,
    match: async (req: Request | string) => cached.get(typeof req === 'string' ? req : req.url),
  };
  const network = async (req: { url: string }) => `network ${req.url}`;
  new Function('self', 'caches', 'fetch', serviceWorkerSource(files, 'test'))(self, caches, network);

  const fetchEvent = async (url: string, mode = 'no-cors', method = 'GET') => {
    let response: Promise<unknown> | null = null;
    listeners.fetch({ request: { url, mode, method }, respondWith: (p: Promise<unknown>) => { response = p; } } as never);
    return response === null ? 'not handled' : await response;
  };
  const install = async () => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.install({ waitUntil: (p: Promise<unknown>) => { done = p; } } as never);
    await done;
  };
  return { scope, added, fetchEvent, install };
}

describe('service worker', () => {
  it('caches every file under the /perch/ scope on install', async () => {
    const sw = runWorker(BUILD);
    await sw.install();
    expect(sw.added).toEqual(BUILD.map((f) => sw.scope + f));
  });

  it('serves the cached index.html for any page in scope, query strings included', async () => {
    const sw = runWorker(BUILD);
    await sw.install();
    for (const page of ['', '?chorus', '?debug', '?fps', 'index.html']) {
      expect(await sw.fetchEvent(sw.scope + page, 'navigate')).toBe(`cached ${sw.scope}index.html`);
    }
  });

  it('serves built files from the cache, and anything else from the network', async () => {
    const sw = runWorker(BUILD);
    await sw.install();
    expect(await sw.fetchEvent(sw.scope + 'assets/pitch-processor-x1.js')).toBe(`cached ${sw.scope}assets/pitch-processor-x1.js`);
    expect(await sw.fetchEvent(sw.scope + 'assets/new.js')).toBe(`network ${sw.scope}assets/new.js`);
  });

  it('leaves other sites and non-GET requests alone', async () => {
    const sw = runWorker(BUILD);
    expect(await sw.fetchEvent('https://elsewhere.example/x.js')).toBe('not handled');
    expect(await sw.fetchEvent(sw.scope + 'index.html', 'navigate', 'POST')).toBe('not handled');
  });
});
