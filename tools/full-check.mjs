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
  const printData = await (await fetch(`http://localhost:${port}/sheets.json`)).json();
  ok('F-030 дані для друку: пʼять листів по HTTP', Object.keys(printData.sheets).length === 5 && printData.sheets['krinzh-dor'].details.speed.walk === 30);
  const refHits = await (await fetch(`http://localhost:${port}/api/search?q=${encodeURIComponent('Витонченість')}`)).json();
  const refDoc = await (await fetch(`http://localhost:${port}/api/doc/power/force-push-pull`)).json();
  ok('F-049 довідник: «Витонченість» → Finesse, сторінка сили з текстом книги',
    refHits[0]?.key === 'finesse' && refDoc.sections?.[0]?.text?.includes('Force'));
  const termHit = await (await fetch(`http://localhost:${port}/api/term?kind=condition&name=Prone`)).json();
  ok('F-050 посилання «Prone» → правило умов на розділі prone', termHit.key === 'phb-appendix-a-conditions' && termHit.anchor === 'prone');
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
  gm.ws.send(JSON.stringify({ type: 'combat-start' }));
  ok('F-054 майстер почав бій — у черзі вся партія',
    await wait(gm, (g) => g.some((m) => m.type === 'combat' && m.combat?.order.length === 5 && m.combat.order.every((f) => f.total === null))));
  p1.ws.send(JSON.stringify({ type: 'combat-roll', character: 'sandra-vong', roll: 14 }));
  const rolled = await wait(gm, (g) => g.some((m) => m.type === 'combat' && m.combat?.order.some((f) => f.character === 'sandra-vong' && f.total !== null)));
  const hers = [...gm.got].reverse().find((m) => m.type === 'combat')?.combat?.order.find((f) => f.character === 'sandra-vong');
  ok('F-054 кидок гравця + модифікатор із листа', rolled && hers.roll === 14 && hers.total === 14 + sheets['sandra-vong'].initiative, String(hers?.total));
  p1.ws.send(JSON.stringify({ type: 'combat-turn', direction: 'next' }));
  ok('F-054 гравець ходом не рухає', await wait(p1, (g) => g.some((m) => m.type === 'refused' && m.reason === 'бій веде майстер')));
  gm.ws.send(JSON.stringify({ type: 'combat-turn', direction: 'next' }));
  ok('F-054 хід перейшов до того, хто кинув', await wait(gm, (g) => g.some((m) => m.type === 'combat' && m.combat?.turn === 'sandra-vong')));
  const midFight = await client({ role: 'gm' });
  ok('F-054 нова сторінка майстра одразу бачить бій', await wait(midFight, (g) => g.some((m) => m.type === 'combat' && m.combat?.turn === 'sandra-vong')));
  midFight.ws.close();
  gm.ws.send(JSON.stringify({ type: 'counts-set', character: 'nigra-4', who: 'app' }));
  ok('F-064 майстер перемкнув Нигру на «рахує застосунок»',
    await wait(gm, (g) => g.some((m) => m.type === 'counts' && m.counts['nigra-4'] === 'app')) &&
    await wait(p2, (g) => g.some((m) => m.type === 'counts' && m.counts['nigra-4'] === 'app')));
  p2.ws.send(JSON.stringify({ type: 'combat-roll', character: 'nigra-4', roll: 10 }));
  ok('F-064 за кого рахує застосунок — одне число',
    await wait(gm, (g) => g.some((m) => m.type === 'combat' && m.combat?.order.some((f) =>
      f.character === 'nigra-4' && f.said === null && f.total === 10 + sheets['nigra-4'].initiative))));
  p1.ws.send(JSON.stringify({ type: 'combat-roll', character: 'sandra-vong', roll: 9, said: 19 }));
  ok('F-064 у черзі число гравця, а лист поруч',
    await wait(gm, (g) => g.some((m) => m.type === 'combat' && m.combat?.order[0]?.character === 'sandra-vong'
      && m.combat.order[0].said === 19 && m.combat.order[0].total === 9 + sheets['sandra-vong'].initiative)));
  p1.ws.send(JSON.stringify({ type: 'counts-set', character: 'sandra-vong', who: 'app' }));
  ok('F-064 перемикає тільки майстер',
    await wait(p1, (g) => g.some((m) => m.type === 'refused' && m.reason === 'перемикає майстер')));
  gm.ws.send(JSON.stringify({ type: 'enemies-add', monster: 'sith-probe-droid', count: 2 }));
  const foes = (g) => [...g].reverse().find((m) => m.type === 'combat')?.combat?.order.filter((f) => f.kind === 'enemy') ?? [];
  ok('F-055 майстер привів двох ворогів — у нього КБ і ХП з бестіарію',
    await wait(gm, (g) => foes(g).length === 2 && foes(g)[0].enemy?.ac === 11));
  ok('F-055 у гравця вороги без жодного числа, лише стан словами',
    await wait(p1, (g) => foes(g).length === 2 && foes(g).every((f) => f.enemy === undefined && f.total === null && f.status === 'цілий')));
  gm.ws.send(JSON.stringify({ type: 'enemy-conditions', enemy: 'enemy-sith-probe-droid-1', conditions: ['Prone'] }));
  ok('F-056 умова на ворогові видна гравцеві, числа — ні',
    await wait(p1, (g) => foes(g)[0]?.conditions?.[0] === 'Prone' && foes(g)[0]?.enemy === undefined));
  const briefsMsg = gm.got.find((m) => m.type === 'briefs');
  ok('F-056 таблиця виснаження з книги приходить на екран', briefsMsg?.exhaustion?.length === 6 && briefsMsg.exhaustion[5] === 'Death');
  const lastCombat = (g) => [...g].reverse().find((m) => m.type === 'combat')?.combat;
  const turnNow = lastCombat(gm.got)?.turn;
  if (turnNow === 'sandra-vong') {
    p1.ws.send(JSON.stringify({ type: 'attack-roll', character: 'sandra-vong', weapon: sheets['sandra-vong'].attacks[0].name, roll: 11, said: 15 }));
    ok('F-057 атака з телефона — у майстра обидва числа',
      await wait(gm, (g) => lastCombat(g)?.lastAttack?.said === 15 && lastCombat(g)?.lastAttack?.total === 11 + sheets['sandra-vong'].attacks[0].toHit));
    p1.ws.send(JSON.stringify({ type: 'turn-done' }));
    ok('F-057 «Хід завершено» від того, чий хід, переводить хід', await wait(gm, (g) => lastCombat(g)?.turn !== 'sandra-vong'));
  } else {
    ok('F-057 хід Сандри для перевірки атаки', false, `зараз хід: ${turnNow}`);
  }
  const nigraMax = sheets['nigra-4'].maxHitPoints;
  gm.ws.send(JSON.stringify({ type: 'intent', character: 'nigra-4', changes: { hitPointsLost: nigraMax } }));
  gm.ws.send(JSON.stringify({ type: 'death-save', character: 'nigra-4', roll: 7 }));
  ok('F-058 рятівний від смерті на нулі ХП — провал записано',
    await wait(gm, (g) => g.some((m) => m.type === 'event' && m.event.note === 'рятівний від смерті: 7 — провал')));
  gm.ws.send(JSON.stringify({ type: 'intent', character: 'nigra-4', changes: { hitPointsLost: nigraMax - 1 } }));
  ok('F-058 лікування скидає позначки тією самою подією',
    await wait(gm, (g) => g.some((m) => m.type === 'event' && m.event.character === 'nigra-4' && m.event.changes.some((c) => c.field === 'deathSaves' && c.to.failures === 0))));
  gm.ws.send(JSON.stringify({ type: 'intent', character: 'krinzh-dor', changes: { conditions: ['Prone', 'Poisoned'] } }));
  await wait(gm, (g) => g.some((m) => m.type === 'event' && m.event.character === 'krinzh-dor'));
  gm.ws.send(JSON.stringify({ type: 'combat-end', clear: [{ character: 'krinzh-dor', condition: 'Prone' }] }));
  ok('F-059 кінець бою: підсумок у стрічці майстра', await wait(gm, (g) => g.some((m) => m.type === 'fight-summary' && m.summary.rounds >= 1)));
  ok('F-059 знято лише позначену умову',
    await wait(gm, (g) => g.some((m) => m.type === 'event' && m.event.note === 'кінець бою' && JSON.stringify(m.state.conditions) === '["Poisoned"]')));
  gm.ws.send(JSON.stringify({ type: 'close-session' }));
  const closed = await wait(gm, (g) => g.some((m) => m.type === 'session-closed'));
  const c = gm.got.find((m) => m.type === 'session-closed');
  ok('F-024/F-037 закриття сесії в демо — без коміту', closed && c.opened === 2 && c.save.saved === false && c.save.reason.includes('демо'));
  for (const k of [gm, p1, p2]) k.ws.close();
} catch (e) { results.push('FAIL виняток: ' + e.message); }
child.kill();
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
