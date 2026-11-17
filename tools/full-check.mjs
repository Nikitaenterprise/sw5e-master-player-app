// Whole-project check against the REAL app (CLAUDE.md, rule 9): starts the server
// through the same entry point as ЗАПУСТИТИ.bat, in demo mode so state/ is untouched,
// and walks every finished feature with real sockets. Needs a built client first.
//
//   npm run build && node tools/full-check.mjs
//
// Prints one line per check; exits 1 if any failed.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
const dir = process.argv[2] ?? join(import.meta.dirname, '..');
const port = 7793;
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/run.ts'], {
  cwd: dir, env: { ...process.env, HOLOTABLE_PORT: String(port), HOLOTABLE_OPEN: '', HOLOTABLE_DEMO: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let out = ''; child.stdout.on('data', (b) => (out += b)); child.stderr.on('data', (b) => (out += b));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && !out.includes('Сервер працює'); i++) await sleep(100);
const results = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
try {
  ok('банер запуску й режим демо', out.includes('Сервер працює') && out.includes('ДЕМО'));
  const health = await (await fetch(`http://localhost:${port}/health`)).json();
  ok('/health', health.alive === true);
  const page = await (await fetch(`http://localhost:${port}/`)).text();
  ok('сторінка зібрана й роздається', /<script[^>]+assets\/index-/.test(page));
  const demo = await (await fetch(`http://localhost:${port}/demo.html`)).text();
  ok('демо 2×2 з кнопкою wifi', demo.includes('обірвати wifi'));
  const asset = page.match(/assets\/index-[^"]+\.js/)?.[0];
  const js = await (await fetch(`http://localhost:${port}/${asset}`)).text();
  ok('клієнтський бандл роздається', js.length > 100000, `${Math.round(js.length / 1024)} КБ`);

  const client = (hello) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}`); const got = [];
    ws.onmessage = (e) => got.push(JSON.parse(e.data));
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'hello', ...hello })); resolve({ ws, got }); };
  });
  const wait = async (c, f, ms = 3000) => { for (let i = 0; i < ms / 20 && !f(c.got); i++) await sleep(20); return f(c.got); };
  const gm = await client({ role: 'gm' });
  const p1 = await client({ role: 'player', character: 'sandra-vong' });
  const p2 = await client({ role: 'player', character: 'nigra-4' });
  await wait(gm, (g) => g.some((m) => m.type === 'sheets'));
  const welcome = gm.got.find((m) => m.type === 'welcome');
  ok('F-010 привітання, F-037 прапорець демо, F-024 номер сесії', welcome?.demo === true && welcome.session === 1);
  await wait(gm, (g) => g.filter((m) => m.type === 'clients').some((m) => m.clients.length === 3));
  ok('F-011 «за столом — 3»', gm.got.filter((m) => m.type === 'clients').some((m) => m.clients.length === 3));
  const sheets = gm.got.find((m) => m.type === 'sheets').sheets;
  await wait(gm, (g) => g.some((m) => m.type === 'glossary'));
  const glossary = gm.got.find((m) => m.type === 'glossary')?.terms ?? {};
  ok('F-025 глосарій приходить: Кел-Дор, Учений, Згуртування',
    glossary['species.kel-dor'] === 'Кел-Дор' && glossary['class.scholar'] === 'Учений' && glossary['maneuver.rally'] === 'Згуртування');
  ok('F-021 Анам 51 ХП максимум', sheets['anam-melekh'].maxHitPoints === 51);
  ok('F-021 Крінж-Дор 4×d4 суперіориті, 5 маневрів', sheets['krinzh-dor'].superiority?.quantity === 4 && sheets['krinzh-dor'].maneuvers.length === 5);
  ok('F-021 Нигра DC техніки 13', sheets['nigra-4'].techPoints?.dc === 13);
  ok('F-042 підказка Переконання Сандри = +5', sheets['sandra-vong'].explain['skill:Persuasion'].total === 5);
  ok('F-043 ручна правка КБ Анама — походження невідоме', sheets['anam-melekh'].handEdits.some((h) => h.key === 'armorClass' && h.verdict === 'unknown'));
  ok('F-043 зайва правка Мудрості Сандри', sheets['sandra-vong'].handEdits.some((h) => h.key === 'ability:Wisdom' && h.verdict === 'redundant'));
  ok('F-044 у Сандри 4×d6', JSON.stringify(sheets['sandra-vong'].hitDice) === '[{"size":"d6","count":4}]');
  const state = gm.got.find((m) => m.type === 'state').characters;
  const lost = state['sandra-vong'].hitPointsLost;
  p1.ws.send(JSON.stringify({ type: 'intent', character: 'sandra-vong', id: 's1', base: { hitPointsLost: lost }, changes: { hitPointsLost: lost + 5 } }));
  ok('F-020 −5 ХП гравця видно в майстра й у другого гравця',
    (await wait(gm, (g) => g.some((m) => m.type === 'event' && m.event.character === 'sandra-vong'))) &&
    (await wait(p2, (g) => g.some((m) => m.type === 'event' && m.event.character === 'sandra-vong'))));
  ok('F-045 підтвердження ack', await wait(p1, (g) => g.some((m) => m.type === 'ack' && m.intent === 's1')));
  p2.ws.send(JSON.stringify({ type: 'intent', character: 'sandra-vong', changes: { hitPointsLost: 0 } }));
  ok('F-019 чужого персонажа змінити не можна', await wait(p2, (g) => g.some((m) => m.type === 'refused' && m.reason.includes('не твій'))));
  p1.ws.send(JSON.stringify({ type: 'intent', character: 'sandra-vong', id: 's2', base: { hitDiceUsed: { d6: 1 }, hitPointsLost: lost + 5 }, changes: { hitDiceUsed: { d6: 2 }, hitPointsLost: lost + 1 }, note: 'кубик здоровʼя d6: 4 +0 = 4 ХП' }));
  ok('F-044 витрата кубика — одна подія з двома полями', await wait(gm, (g) => g.some((m) => m.type === 'event' && m.event.changes.length === 2)));
  const reloaded = await client({ role: 'gm' });
  ok('F-047 нова сторінка майстра одразу має стрічку з журналу',
    await wait(reloaded, (g) => g.some((m) => m.type === 'history' && m.events.some((e) => e.intent === 's1'))));
  reloaded.ws.close();
  gm.ws.send(JSON.stringify({ type: 'rest', kind: 'long' }));
  ok('F-023 довгий відпочинок', await wait(gm, (g) => g.some((m) => m.type === 'event' && m.event.note === 'довгий відпочинок' && m.event.character === 'sandra-vong')));
  const last = [...gm.got].reverse().find((m) => m.type === 'event' && m.event.character === 'sandra-vong');
  ok('F-023/F-044 після довгого: ХП повні, кубики повернулись', last.state.hitPointsLost === 0 && last.state.hitDiceUsed.d6 === 0);
  p1.ws.send(JSON.stringify({ type: 'rest', kind: 'long' }));
  ok('F-023 гравцю відпочинок не дозволено', await wait(p1, (g) => g.some((m) => m.type === 'refused' && m.reason === 'відпочинок оголошує майстер')));
  gm.ws.send(JSON.stringify({ type: 'close-session' }));
  const closed = await wait(gm, (g) => g.some((m) => m.type === 'session-closed'));
  const c = gm.got.find((m) => m.type === 'session-closed');
  ok('F-024/F-037 закриття сесії в демо — без коміту', closed && c.opened === 2 && c.save.saved === false && c.save.reason.includes('демо'));
  for (const k of [gm, p1, p2]) k.ws.close();
} catch (e) { results.push('FAIL виняток: ' + e.message); }
child.kill();
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
