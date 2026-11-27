// Whole-project check against the REAL app (CLAUDE.md, rule 9): starts the server
// through the same entry point as ЗАПУСТИТИ.bat, in demo mode so state/ is untouched,
// and walks every finished feature with real sockets. Needs a built client first.
//
//   npm run build && node tools/full-check.mjs
//
// Prints one line per check; exits 1 if any failed.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { request } from 'node:http';
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
  // F-031: the ship's sheet reads everything in one request, like the paper sheets.
  ok('F-031 лист корабля по HTTP: корабель, листи посад і числа рушія',
    printData.ships?.['mandrivna-zorya']?.summary?.name === 'Мандрівна Зоря'
      && printData.ships['mandrivna-zorya'].summary.armorClass === 11
      && Object.keys(printData.deployments ?? {}).length === 5
      && printData.deployments['alister'][0].deployment === 'Gunner'
      && printData.deployments['alister'][0].rank === 1
      && Array.isArray(printData.shipProblems) && printData.shipProblems.length === 0);
  // F-032: the six station cards, with the book's own text and checks.
  const roleNames = (printData.roles ?? []).map((c) => c.deployment);
  const gunnerCard = (printData.roles ?? []).find((c) => c.deployment === 'Gunner');
  const helm = (printData.shipActions ?? []).find((a) => a.name === 'Helm');
  ok('F-032 картки станцій: шість станцій, узяте навідника, Helm лише пілот',
    roleNames.join(',') === 'Pilot,Gunner,Mechanic,Operator,Technician,Coordinator'
      && gunnerCard?.name === 'Алістер'
      && gunnerCard.techniques.map((t) => t.name).join(',') === 'Penetrating Shot,Disabling Shot'
      && gunnerCard.role === 'Controls one or more weapon emplacements'
      && helm?.pilotOnly === true
      && (printData.shipActions ?? []).filter((a) => a.pilotOnly).length === 1
      && (printData.roles ?? []).flatMap((c) => c.problems).length === 0);
  ok('F-032 станція без екіпажу не вигадує людину',
    (printData.roles ?? []).find((c) => c.deployment === 'Technician')?.character === null
      && ((printData.roles ?? []).find((c) => c.deployment === 'Technician')?.rankFeatures.length ?? 0) > 0);
  const shipPage = await (await fetch(`http://localhost:${port}/?as=ship`)).text();
  ok('F-031 сторінка листа корабля роздається', /<script[^>]+assets\/index-/.test(shipPage));
  // F-062: the GM's print links, and the addresses each of them opens.
  const printPages = await Promise.all(['', '&what=sheet', '&what=cards', '&card=Gunner', '&card=Кухар']
    .map((tail) => fetch(`http://localhost:${port}/?as=ship${tail}`).then((r) => r.status)));
  ok('F-062 кожна адреса друку відповідає сторінкою, а не помилкою',
    printPages.every((status) => status === 200));
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
  const lastCombatOf = (g) => [...g].reverse().find((m) => m.type === 'combat')?.combat;
  ok('F-055 майстер привів двох ворогів — у нього КБ і ХП з бестіарію',
    await wait(gm, (g) => foes(g).length === 2 && foes(g)[0].enemy?.ac === 11));
  ok('F-055 у гравця вороги без жодного числа, лише стан словами',
    await wait(p1, (g) => foes(g).length === 2 && foes(g).every((f) => f.enemy === undefined && f.total === null && f.status === 'цілий')));
  gm.ws.send(JSON.stringify({ type: 'enemy-conditions', enemy: 'enemy-sith-probe-droid-1', conditions: ['Prone'] }));
  ok('F-056 умова на ворогові видна гравцеві, числа — ні',
    await wait(p1, (g) => foes(g)[0]?.conditions?.[0] === 'Prone' && foes(g)[0]?.enemy === undefined));
  // F-084: saves from the bestiary, and an effect on one creature.
  gm.ws.send(JSON.stringify({ type: 'enemies-add', monster: 'trandoshan-warrior', count: 1, hp: 20 }));
  const trandoshan = (g) => foes(g).find((f) => f.enemy?.key === 'trandoshan-warrior');
  const saveOf = (f, ability) => f?.enemy?.saves?.find((s) => s.ability === ability);
  ok('F-084 сейви ворога: книжкові з бестіарію, решта — модифікатор характеристики',
    await wait(gm, (g) => saveOf(trandoshan(g), 'Wisdom')?.modifier === 3 && saveOf(trandoshan(g), 'Wisdom')?.book === true
      && saveOf(trandoshan(g), 'Dexterity')?.book === false && saveOf(trandoshan(g), 'Dexterity')?.modifier === 1));
  gm.ws.send(JSON.stringify({ type: 'enemy-effects', enemy: 'enemy-trandoshan-warrior-1', effects: [
    { id: 'fc-dark', source: 'Сила Сандри', target: 'save:Wisdom', mode: 'disadvantage', until: 'fight' },
  ] }));
  ok('F-084 недолік на сейв Мудрості — у майстра на карточці ворога',
    await wait(gm, (g) => saveOf(trandoshan(g), 'Wisdom')?.mode === 'disadvantage' && saveOf(trandoshan(g), 'Strength')?.mode === undefined));
  ok('F-084 гравцеві не дійшло ні сейвів, ні ефектів ворога',
    await wait(p1, (g) => foes(g).length === 3) && !JSON.stringify(lastCombatOf(p1.got)).includes('Сила Сандри')
      && foes(p1.got).every((f) => f.enemy === undefined));
  gm.ws.send(JSON.stringify({ type: 'enemy-effects', enemy: 'enemy-trandoshan-warrior-1', effects: [
    { id: 'fc-nope', source: 'Хиба', target: 'skill:Stealth', bonus: 2, until: 'fight' },
  ] }));
  ok('F-084 на ворога не кладуть ефект, якого його рядок не покаже',
    await wait(gm, (g) => g.some((m) => m.type === 'refused' && m.reason === 'на ворога ефект кладуть на сейв, КБ, ініціативу або атаки')));
  gm.ws.send(JSON.stringify({ type: 'enemy-remove', enemy: 'enemy-trandoshan-warrior-1' }));
  await wait(gm, (g) => trandoshan(g) === undefined);
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
  const brew = gm.got.find((m) => m.type === 'homebrew');
  ok('F-066 хомбрю-предмети: файл без помилок, Стимулятор у Нигри, Bracelet у Крінж-Дора',
    brew?.problems?.length === 0 && brew.items['nigra-4']?.some((i) => i.name === 'Стимулятор')
      && brew.items['krinzh-dor']?.some((i) => i.name === 'Bracelet'));
  p2.ws.send(JSON.stringify({ type: 'use-item', character: 'nigra-4', item: 'Стимулятор' }));
  ok('F-067 Нигра використала Стимулятор з телефона: витрачено 1, ефект на 5 раундів',
    await wait(gm, (g) => g.some((m) => m.type === 'event' && m.event.note === 'використано: Стимулятор'
      && m.state.holotableItemsUsed?.['стимулятор'] === 1 && m.state.holotableEffects?.some((e) => e.until === 'rounds'))));
  const file = gm.got.find((m) => m.type === 'homebrew-file');
  ok('F-068 редактор предметів: майстру прийшов файл і пропозиції з листів (Порада, Signet ring)',
    file?.items?.['Стимулятор'] !== undefined && file.candidates.includes('Порада') && file.candidates.includes('Signet ring'));
  const krinzhFeature = sheets['krinzh-dor'].featureEffects?.[0];
  ok('F-069 здібність Крінж-Дора Motivating Diplomat — з числом і реченням книги',
    krinzhFeature?.feature === 'Motivating Diplomat' && krinzhFeature.effects[0].bonus > 0
      && krinzhFeature.sentence.startsWith('When you are the target of your Critical Analysis'));
  // A WebSocket upgrade as a page of some other site would send it.
  const evil = await new Promise((resolve) => {
    request({ host: '127.0.0.1', port, path: '/', headers: {
      connection: 'Upgrade', upgrade: 'websocket', origin: 'http://evil.example',
      'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    } }, (res) => { res.resume(); resolve(res.statusCode); })
      .on('upgrade', () => resolve('upgraded'))
      .on('error', () => resolve('error'))
      .end();
  });
  ok('F-070 чужа сторінка не підключається до сервера (Origin evil.example → 401)', evil === 401);
  gm.ws.send(JSON.stringify({ type: 'handout-send', title: 'Записка Сандрі', text: 'fc-secret-71', to: ['sandra-vong'] }));
  ok('F-071 роздатка Сандрі дійшла до Сандри',
    await wait(p1, (g) => g.some((m) => m.type === 'handouts' && m.handouts.some((h) => h.title === 'Записка Сандрі'))));
  ok('F-071 до Нигри чужа записка не дійшла навіть у даних',
    !p2.got.some((m) => JSON.stringify(m).includes('fc-secret-71')));
  ok('F-074 Rage в Анам Мелех і Force Shield у Сандри — на їхніх листах',
    sheets['anam-melekh'].featureEffects?.[0]?.feature === 'Rage'
      && sheets['sandra-vong'].featureEffects?.[0]?.effects[0]?.until === 'next-turn');
  const comp = gm.got.find((m) => m.type === 'companions');
  ok('F-039 дроїд Нигри приходить окремо від партії, з правилами книги',
    comp?.companions?.['nigra-4-droid']?.name === 'BOBR-1488' && comp.rules.length === 2
      && !('nigra-4-droid' in (gm.got.find((m) => m.type === 'state')?.characters ?? {})));
  p2.ws.send(JSON.stringify({ type: 'intent', character: 'nigra-4-droid', id: 'fc-droid', base: { hitPointsLost: 0 }, changes: { hitPointsLost: 3 } }));
  ok('F-039 гравець Нигри міняє ХП свого дроїда',
    await wait(gm, (g) => g.some((m) => m.type === 'event' && m.event.character === 'nigra-4-droid' && m.state.hitPointsLost === 3)));
  const initBefore = sheets['nigra-4'].initiative;
  gm.ws.send(JSON.stringify({ type: 'intent', character: 'nigra-4', changes: { holotableEffects: [
    { id: 'fc-stim', source: 'Стимулятор', target: 'ability:Dexterity', bonus: 2, until: 'manual' },
  ] } }));
  ok('F-065 «Спритність +2» — лист Нигри перераховано: ініціатива +1',
    await wait(gm, (g) => g.some((m) => m.type === 'sheets' && m.sheets['nigra-4'].initiative === initBefore + 1)));
  // F-083: a sight on one weapon, and advantage on the ranged ones only.
  const latest = () => [...gm.got].reverse().find((m) => m.type === 'sheets')?.sheets['nigra-4'];
  const hitOf = (sheet, name) => sheet?.attacks.find((a) => a.name === name)?.toHit;
  const indexOf = (sheet, name) => sheet?.attacks.findIndex((a) => a.name === name);
  const beforeSight = latest();
  const rifleBefore = hitOf(beforeSight, 'Bowcaster');
  const sabreBefore = hitOf(beforeSight, 'Vibrosabre');
  gm.ws.send(JSON.stringify({ type: 'intent', character: 'nigra-4', changes: { holotableEffects: [
    { id: 'fc-stim', source: 'Стимулятор', target: 'ability:Dexterity', bonus: 2, until: 'manual' },
    { id: 'fc-sight', source: 'Приладдя', target: 'attack:Bowcaster', bonus: 1, until: 'manual' },
    { id: 'fc-aim', source: 'Приціл', target: 'attack:ranged', mode: 'advantage', until: 'manual' },
  ] } }));
  const sighted = await wait(gm, (g) => g.some((m) => m.type === 'sheets' && hitOf(m.sheets['nigra-4'], 'Bowcaster') === rifleBefore + 1));
  const withSight = latest();
  ok('F-083 приладдя на гвинтівці: +1 лише їй, перевага — лише далекобійним',
    sighted && hitOf(withSight, 'Vibrosabre') === sabreBefore
      && withSight.rollModes?.[`attack:${indexOf(withSight, 'Bowcaster')}`] === 'advantage'
      && withSight.rollModes?.[`attack:${indexOf(withSight, 'Vibrosabre')}`] === undefined
      && withSight.explain[`attack:${indexOf(withSight, 'Bowcaster')}`]?.parts.some((part) => part.label === 'ефект: Приладдя'));
  // F-060: the ship at the table — the engine's numbers, and damage on every phone.
  const shipOf = (g) => [...g].reverse().find((m) => m.type === 'ships')?.ships?.['mandrivna-zorya'];
  ok('F-060 «Мандрівна Зоря» з рушія: корпус 38, щити 22, КБ 11, мінімальний екіпаж 3',
    shipOf(gm.got)?.summary.hull.max === 38 && shipOf(gm.got)?.summary.shields?.max === 22
      && shipOf(gm.got)?.summary.armorClass === 11 && shipOf(gm.got)?.summary.minimumCrew === 3);
  gm.ws.send(JSON.stringify({ type: 'ship-damage', ship: 'mandrivna-zorya', amount: 25 }));
  ok('F-060 шкода 25: щити −22, корпус −3 — і це видно на телефоні Сандри',
    await wait(p1, (g) => shipOf(g)?.state.shieldPointsLost === 22 && shipOf(g)?.state.hullPointsLost === 3));

  // F-063: space combat — the ship's turn, and the crew moving power from a phone.
  gm.ws.send(JSON.stringify({ type: 'ship-turn', ship: 'mandrivna-zorya', regenerate: true }));
  ok('F-063 початок ходу корабля: регенерація повернула щити (−22 → −10)',
    await wait(p1, (g) => shipOf(g)?.state.shieldPointsLost === 10));
  p2.ws.send(JSON.stringify({ type: 'ship-set', ship: 'mandrivna-zorya', changes: { hullPointsLost: 0 } }));
  ok('F-063 гравець не лагодить корабель — це майстер',
    await wait(p2, (g) => g.some((m) => m.type === 'refused' && m.reason === 'стан корабля міняє майстер')));

  // F-087: the test-session scenario — offered to the demo page, its items in hand.
  const scenario = await (await fetch(`http://localhost:${port}/api/scenario`)).json();
  ok('F-087 сценарій тестової сесії: девʼять сцен без проблем у файлі',
    scenario.scenes?.length === 9 && scenario.problems?.length === 0);
  const scenarioItems = [...gm.got].reverse().find((m) => m.type === 'homebrew')?.items ?? {};
  ok('F-087 предмети сценарію в демо: бакта-інʼєктор у Крінж-Дора, приладдя в Нигри',
    scenarioItems['krinzh-dor']?.some((i) => i.name === 'Бакта-інʼєктор') && scenarioItems['nigra-4']?.some((i) => i.name === 'Приладдя на гвинтівку'));

  // F-086: weather as an effect of the scene — the owner's own file, on everyone.
  const weatherOf = (g) => [...g].reverse().find((m) => m.type === 'weather')?.weather;
  const npcsOf = (g) => [...g].reverse().find((m) => m.type === 'npcs')?.npcs ?? [];
  const notesOf = (g) => [...g].reverse().find((m) => m.type === 'scene-notes')?.notes ?? [];
  ok('F-086 погода Міролла з файла власника: чотири погоди й правило планети',
    await wait(gm, (g) => weatherOf(g)?.planet === 'Міролл')
      && weatherOf(gm.got)?.choices?.length === 4 && weatherOf(gm.got)?.always?.effects?.length === 5
      && (weatherOf(gm.got)?.problems ?? []).length === 0);
  ok('F-086 правило планети вже в числах партії',
    sheets['krinzh-dor'].explain['skill:Insight'].parts.some((p) => p.label === 'ефект: Чисте повітря'));
  gm.ws.send(JSON.stringify({ type: 'weather-set', weather: 'stina' }));
  ok('F-086 майстер перемкнув погоду — її видно і в майстра, і в гравця',
    await wait(gm, (g) => weatherOf(g)?.now?.name === 'Стіна')
      && await wait(p1, (g) => weatherOf(g)?.now?.name === 'Стіна'));
  p1.ws.send(JSON.stringify({ type: 'weather-set', weather: 'para' }));
  ok('F-086 гравець погоду не перемикає',
    await wait(p1, (g) => g.some((m) => m.type === 'refused' && m.reason === 'погоду перемикає майстер')));
  ok('F-086 слід погоди в стрічці майстра, і гравцеві він не йде',
    notesOf(gm.got).some((n) => n.text === 'Погода · Міролл: без погоди → Стіна')
      && notesOf(p1.got).length === 0);
  gm.ws.send(JSON.stringify({ type: 'weather-set', weather: null }));
  await wait(gm, (g) => weatherOf(g)?.now === null);

  // F-085: the scene's NPCs. The GM leads them; a player sees only a shown name.
  gm.ws.send(JSON.stringify({ type: 'npc-set', npc: {
    id: 'fc-ron', name: 'Торговець Рон', attitude: 'indifferent', wants: 'вивезти товар',
    modifiers: [{ id: 'fc-cig', source: 'цигарка', target: 'skill:Persuasion', bonus: 1 }], shown: false,
  } }));
  ok('F-085 НПС у сцені: у майстра ставлення, «чого хоче» й модифікатор',
    await wait(gm, (g) => npcsOf(g)[0]?.gm?.attitude === 'indifferent' && npcsOf(g)[0]?.gm?.modifiers?.[0]?.bonus === 1));
  ok('F-085 поки не показаний — у гравця його немає зовсім', npcsOf(p1.got).length === 0);
  gm.ws.send(JSON.stringify({ type: 'npc-set', npc: {
    id: 'fc-ron', name: 'Торговець Рон', attitude: 'friendly', wants: 'вивезти товар',
    modifiers: [{ id: 'fc-cig', source: 'цигарка', target: 'skill:Persuasion', bonus: 1 }], shown: true,
  } }));
  ok('F-085 показаний — у гравця лише імʼя, без ставлення й чисел',
    await wait(p1, (g) => npcsOf(g).length === 1)
      && JSON.stringify(npcsOf(p1.got)) === JSON.stringify([{ id: 'fc-ron', name: 'Торговець Рон' }]));
  ok('F-085 слід у стрічці майстра називає, що саме змінилось',
    notesOf(gm.got).some((n) => n.text.includes('байдужий → прихильний')) && notesOf(p1.got).length === 0);
  gm.ws.send(JSON.stringify({ type: 'npcs-clear' }));
  ok('F-085 «Сцена скінчилась» прибирає всіх',
    await wait(gm, (g) => npcsOf(g).length === 0) && await wait(p1, (g) => npcsOf(g).length === 0));
  // F-061: the GM seats someone and the card reaches that phone, through real sockets.
  const lastOf = (c, type) => [...c.got].reverse().find((m) => m.type === type);
  await wait(p1, (g) => g.some((m) => m.type === 'role-card'));
  const stationBefore = lastOf(p1, 'role-card')?.card?.deployment;
  gm.ws.send(JSON.stringify({ type: 'crew-set', ship: 'mandrivna-zorya', deployment: 'Technician', character: 'sandra-vong' }));
  await wait(p1, (g) => g.some((m) => m.type === 'role-card' && m.card?.deployment === 'Technician'));
  const seated = lastOf(p1, 'role-card')?.card;
  const crewNow = lastOf(gm, 'ships')?.ships['mandrivna-zorya']?.summary.crew ?? [];
  ok('F-061 станції: майстер пересадив — картка приїхала на той телефон',
    stationBefore === 'Operator'
      && seated?.deployment === 'Technician'
      && seated.name === 'Сандра Вонг'
      && crewNow.filter((c) => c.character === 'sandra-vong').length === 1
      && crewNow.find((c) => c.deployment === 'Operator') === undefined);
  p1.ws.send(JSON.stringify({ type: 'crew-set', ship: 'mandrivna-zorya', deployment: 'Pilot', character: 'sandra-vong' }));
  ok('F-061 гравець себе на станцію не садить',
    await wait(p1, (g) => g.some((m) => m.type === 'refused' && m.reason === 'на станції садить майстер')));
  // Put her back, so the rest of the run sees the ship as its own sheet describes it.
  gm.ws.send(JSON.stringify({ type: 'crew-set', ship: 'mandrivna-zorya', deployment: 'Operator', character: 'sandra-vong' }));
  await wait(p1, (g) => g.some((m) => m.type === 'role-card' && m.card?.deployment === 'Operator'));
  // F-072: the weather's timer — the GM's dice, and a queued switch that comes by itself.
  {
    const weatherNow = () => lastOf(gm, 'weather')?.weather;
    gm.ws.send(JSON.stringify({ type: 'weather-roll', why: 'move', value: 2 }));
    // The weather and its line in the scene notes are two messages; either may come first.
    await wait(gm, () => weatherNow()?.now?.key === 'stina'
      && (lastOf(gm, 'scene-notes')?.notes.at(-1)?.text ?? '').includes('(d4=2)'));
    const moved = weatherNow()?.now?.name;
    const trace = lastOf(gm, 'scene-notes')?.notes.at(-1)?.text ?? '';
    gm.ws.send(JSON.stringify({ type: 'weather-roll', why: 'check', value: 5 }));
    await wait(gm, () => (lastOf(gm, 'scene-notes')?.notes.at(-1)?.text ?? '').includes('d6=5'));
    const noChange = lastOf(gm, 'scene-notes')?.notes.at(-1)?.text ?? '';
    ok('F-072 таймер погоди: d4 майстра ставить погоду, d6 без зміни лишає рядок',
      moved === 'Стіна' && trace.includes('(d4=2)') && noChange.includes('без зміни')
        && weatherNow()?.now?.key === 'stina');
    p1.ws.send(JSON.stringify({ type: 'weather-roll', why: 'move', value: 1 }));
    ok('F-072 гравець за погоду не кидає',
      await wait(p1, (g) => g.some((m) => m.type === 'refused' && m.reason === 'за погоду кидає майстер')));
    // In a fight the switch waits for its round and then happens on its own.
    gm.ws.send(JSON.stringify({ type: 'combat-start' }));
    await wait(gm, () => lastOf(gm, 'combat')?.combat !== null);
    for (const [i, slug] of ['alister', 'nigra-4', 'anam-melekh', 'krinzh-dor', 'sandra-vong'].entries()) {
      gm.ws.send(JSON.stringify({ type: 'combat-roll', character: slug, roll: 10 + i }));
    }
    await wait(gm, () => (lastOf(gm, 'combat')?.combat?.order ?? []).every((o) => o.total !== null && o.total !== undefined));
    gm.ws.send(JSON.stringify({ type: 'weather-roll', why: 'check', value: 1 }));
    gm.ws.send(JSON.stringify({ type: 'weather-roll', why: 'queue', value: 3 }));
    await wait(gm, () => weatherNow()?.queued != null);
    const queued = weatherNow()?.queued;
    for (let i = 0; i < 7; i += 1) {
      gm.ws.send(JSON.stringify({ type: 'combat-turn', direction: 'next' }));
      await sleep(60);
      if ((lastOf(gm, 'combat')?.combat?.round ?? 1) >= 2) break;
    }
    await wait(gm, () => weatherNow()?.now?.key === 'moloko');
    ok('F-072 черга погоди стає сама, коли починається її раунд',
      queued?.weather.key === 'moloko' && queued.round === 2
        && weatherNow()?.now?.key === 'moloko' && weatherNow()?.queued == null);
    gm.ws.send(JSON.stringify({ type: 'combat-end', clear: [] }));
    await wait(gm, () => lastOf(gm, 'combat')?.combat === null);
    gm.ws.send(JSON.stringify({ type: 'weather-set', weather: null }));
    await wait(gm, () => weatherNow()?.now === null);
  }

  // F-090: two GM pages editing one NPC, and taking a line back.
  const gm2 = await client({ role: 'gm' });
  await wait(gm2, (g) => g.some((m) => m.type === 'npcs'));
  const ronSeen = { id: 'fc-ron2', name: 'Рон Другий', attitude: 'indifferent', wants: '', modifiers: [], shown: false };
  gm.ws.send(JSON.stringify({ type: 'npc-set', npc: ronSeen }));
  await wait(gm2, (g) => npcsOf(g).some((n) => n.id === 'fc-ron2'));
  gm.ws.send(JSON.stringify({ type: 'npc-set', npc: { ...ronSeen, attitude: 'friendly' }, base: ronSeen }));
  await wait(gm, (g) => npcsOf(g).find((n) => n.id === 'fc-ron2')?.gm?.attitude === 'friendly');
  gm2.ws.send(JSON.stringify({ type: 'npc-set', npc: { ...ronSeen, modifiers: [{ id: 'fc-m', source: 'цигарка', target: 'skill:Persuasion', bonus: 1 }] }, base: ronSeen }));
  ok('F-090 дві сторінки майстра правлять одного НПС — обидві правки лишаються',
    await wait(gm, (g) => (npcsOf(g).find((n) => n.id === 'fc-ron2')?.gm?.modifiers ?? []).length === 1)
      && npcsOf(gm.got).find((n) => n.id === 'fc-ron2')?.gm?.attitude === 'friendly');
  const line = notesOf(gm.got).at(-1);
  gm.ws.send(JSON.stringify({ type: 'npc-set', npc: line?.undo?.npc }));
  ok('F-090 «відкотити» в рядку НПС повертає те, що там написано',
    line?.undo?.kind === 'set'
      && await wait(gm, (g) => (npcsOf(g).find((n) => n.id === 'fc-ron2')?.gm?.modifiers ?? []).length === 0));
  gm.ws.send(JSON.stringify({ type: 'npc-remove', npc: 'fc-ron2' }));
  await wait(gm, (g) => npcsOf(g).every((n) => n.id !== 'fc-ron2'));
  gm2.ws.close();

  // And closing the session takes whoever is left in the scene with it.
  gm.ws.send(JSON.stringify({ type: 'npc-set', npc: {
    id: 'fc-left', name: 'Забутий НПС', attitude: 'hostile', wants: '', modifiers: [], shown: true,
  } }));
  await wait(gm, (g) => npcsOf(g).length === 1);
  gm.ws.send(JSON.stringify({ type: 'weather-set', weather: 'moloko' }));
  await wait(gm, (g) => weatherOf(g)?.now?.key === 'moloko');
  gm.ws.send(JSON.stringify({ type: 'close-session' }));
  ok('F-085 закриття сесії забирає сцену з собою',
    await wait(gm, (g) => npcsOf(g).length === 0) && await wait(p1, (g) => npcsOf(g).length === 0));
  const closed = await wait(gm, (g) => g.some((m) => m.type === 'session-closed'));
  const c = gm.got.find((m) => m.type === 'session-closed');
  ok('F-024/F-037 закриття сесії в демо — без коміту', closed && c.opened === 2 && c.save.saved === false && c.save.reason.includes('демо'));
  ok('F-086 закриття сесії гасить погоду', weatherOf(gm.got)?.now === null);
  for (const k of [gm, p1, p2]) k.ws.close();
} catch (e) { results.push('FAIL виняток: ' + e.message); }
child.kill();
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
