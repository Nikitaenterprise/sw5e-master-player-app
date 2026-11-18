// Test for F-070. The security audit (docs/БЕЗПЕКА.md): each finding that was fixed has
// a check here that fails without the fix.
//
// What must hold: no request and no message can take the server down mid-session; a page
// of some other site, open in the GM's browser, cannot drive the server — neither through
// the WebSocket nor by pointing its domain name at this computer; the GM screen opens
// only on the computer the server runs on, while players connect from the wifi as before;
// a screen cannot send megabytes at once; and every response carries the security
// headers, with the demo's own inline script allowed by its hash and nothing else.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import type { FromServer } from '../packages/protocol/src/index.js';
import { hostName, inlineScriptHashes, isAllowedHost, isLoopback, isSameOrigin, securityHeaders } from '../apps/server/src/guard.js';
import { start, type Server } from '../apps/server/src/index.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');

let server: Server | null = null;
const cleanup: Array<() => void> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) c();
  await server?.close();
  server = null;
});

const fresh = async (): Promise<Server> => {
  const dir = mkdtempSync(join(tmpdir(), 'holotable-f070-'));
  server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
  return server;
};

const get = (port: number, path: string, host = `127.0.0.1:${port}`): Promise<{ status: number; headers: Record<string, unknown> }> =>
  new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, headers: res.headers });
    }).on('error', reject).end();
  });

/** Opens a socket, says hello, and tells what came back: welcome, a refusal, or a rejected upgrade. */
const greet = (url: string, hello: object, origin?: string): Promise<string> =>
  new Promise((resolve) => {
    const ws = new WebSocket(url, origin === undefined ? {} : { origin });
    cleanup.push(() => ws.terminate());
    ws.on('unexpected-response', (_req, res) => resolve(`http ${res.statusCode}`));
    ws.on('error', () => undefined);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', ...hello })));
    ws.on('message', (b) => {
      const m = JSON.parse(b.toString('utf8')) as FromServer;
      if (m.type === 'welcome') resolve('welcome');
      if (m.type === 'refused') resolve(m.reason);
    });
  });

const alive = async (s: Server): Promise<boolean> => (await get(s.port, '/health')).status === 200;

describe('F-070 · аудит безпеки', () => {
  it('правила охорони: свій компʼютер, адреса IP чи localhost, своя сторінка', () => {
    expect(['127.0.0.1', '127.8.0.1', '::1', '::ffff:127.0.0.1'].every(isLoopback)).toBe(true);
    expect(['192.168.1.5', '::ffff:192.168.1.5', '10.0.0.1', undefined].some(isLoopback)).toBe(false);
    expect(hostName('[::1]:7777')).toBe('::1');
    expect(hostName('192.168.1.5:7777')).toBe('192.168.1.5');
    expect(['localhost:7777', '192.168.1.5:7777', '[::1]:7777', 'LOCALHOST'].every(isAllowedHost)).toBe(true);
    expect(['evil.example:7777', 'localhost.evil.example', '', undefined].some(isAllowedHost), 'доменне імʼя — це DNS rebinding').toBe(false);
    expect(isSameOrigin(undefined, 'localhost:1')).toBe(true);
    expect(isSameOrigin('http://localhost:1', 'localhost:1')).toBe(true);
    expect(isSameOrigin('http://evil.example', 'localhost:1')).toBe(false);
    expect(isSameOrigin('null', 'localhost:1')).toBe(false);
  });

  it('S-01, S-02: битий запит і «__proto__» замість персонажа не кладуть сервер', async () => {
    const s = await fresh();
    expect((await get(s.port, '/api/doc/rule/%E0%A4%A')).status).toBe(404);
    const probes: object[] = [
      { type: 'use-item', character: '__proto__', item: 'x' },
      { type: 'use-item', character: 'constructor', item: 'x' },
      { type: 'intent', character: '__proto__', changes: { hitDiceUsed: { d8: 1 } } },
      { type: 'use-feature', character: '__proto__', feature: 'x', allies: [] },
      { type: 'death-save', character: 'constructor', roll: 5 },
    ];
    const got: FromServer[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}`);
    cleanup.push(() => ws.terminate());
    ws.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'hello', role: 'gm' }));
    for (const p of probes) ws.send(JSON.stringify(p));
    const end = Date.now() + 5000;
    while (got.filter((m) => m.type === 'refused').length < probes.length && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    expect(got.filter((m) => m.type === 'refused')).toHaveLength(probes.length);
    expect(await alive(s), 'сервер живий').toBe(true);
  });

  it('S-03: чужа сторінка не підключиться, і доменне імʼя замість адреси — відмова', async () => {
    const s = await fresh();
    expect(await greet(`ws://127.0.0.1:${s.port}`, { role: 'gm' }, 'http://evil.example')).toBe('http 401');
    expect(await greet(`ws://localhost:${s.port}`, { role: 'gm' }, `http://localhost:${s.port}`), 'своя сторінка — так').toBe('welcome');
    expect((await get(s.port, '/sheets.json', `evil.example:${s.port}`)).status).toBe(421);
    expect((await get(s.port, '/sheets.json')).status).toBe(200);
  });

  it('S-04: екран майстра — лише на цьому компʼютері; гравці з wifi — як і було', async () => {
    const s = await fresh();
    expect(await greet(`ws://127.0.0.1:${s.port}`, { role: 'gm' })).toBe('welcome');
    const lan = Object.values(networkInterfaces()).flat().find((i) => i !== undefined && i.family === 'IPv4' && !i.internal)?.address;
    // A machine with no network at all has nothing to test from: the rule itself is checked above.
    if (lan === undefined) return;
    expect(await greet(`ws://${lan}:${s.port}`, { role: 'gm' })).toBe('екран майстра відкривається лише на компʼютері, де запущено сервер');
    expect(await greet(`ws://${lan}:${s.port}`, { role: 'player', character: 'sandra-vong' })).toBe('welcome');
  });

  it('S-07: повідомлення на мегабайти закривається, сервер живе', async () => {
    const s = await fresh();
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${s.port}`);
      cleanup.push(() => ws.terminate());
      ws.on('error', () => undefined);
      ws.on('open', () => ws.send('x'.repeat(2 * 1024 * 1024)));
      ws.on('close', (c) => resolve(c));
    });
    expect(code, '1009 — повідомлення завелике').toBe(1009);
    expect(await alive(s)).toBe(true);
  });

  it('S-06: заголовки безпеки на кожній відповіді; inline-скрипт демо — лише за хешем', async () => {
    const s = await fresh();
    const { headers } = await get(s.port, '/health');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['referrer-policy']).toBe('no-referrer');
    const csp = String(headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain(`connect-src 'self' ws://127.0.0.1:${s.port}`);
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);

    const demo = join(root, 'apps', 'web', 'demo.html');
    const hashes = inlineScriptHashes(readFileSync(demo, 'utf8'));
    expect(hashes, 'у демо рівно один inline-скрипт').toHaveLength(1);
    expect(securityHeaders('localhost:1', hashes)['content-security-policy']).toContain(`script-src 'self' ${hashes[0]}`);
    expect(inlineScriptHashes('<script type="module" src="/a.js"></script>'), 'скрипт із src — не inline').toEqual([]);
    // The built page is served with its own hash — when it has been built.
    const built = join(root, 'apps', 'web', 'dist', 'demo.html');
    if (existsSync(built)) {
      const page = await get(s.port, '/demo.html');
      expect(String(page.headers['content-security-policy'])).toContain(inlineScriptHashes(readFileSync(built, 'utf8'))[0]);
    }
  });
});
