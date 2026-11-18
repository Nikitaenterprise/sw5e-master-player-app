// The character sheet on A4 (F-030). Open /?as=print (all five) or
// /?as=print&character=<slug>, then the browser's Print → Save as PDF.
//
// The numbers are the very ones on the GM card: one source, the engine, computed on
// the server and read here over plain HTTP. The page is a plain HTML document styled
// for paper — no PDF library, nothing native (ADR 0004).
//
// It is also the backup: if the laptop dies mid-session, the game goes on with these
// sheets, so each one carries the state at the moment of printing.
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { showTerm, usedOf, type CharacterState, type PrintData, type SheetSummary, type TermKind, type TermMode } from '@holotable/protocol';
import { readMode } from './terms.js';

const ABILITIES: { key: string; short: string }[] = [
  { key: 'Strength', short: 'СИЛ' },
  { key: 'Dexterity', short: 'СПР' },
  { key: 'Constitution', short: 'СТА' },
  { key: 'Intelligence', short: 'ІНТ' },
  { key: 'Wisdom', short: 'МУД' },
  { key: 'Charisma', short: 'ХАР' },
];

/** Which ability each skill uses, for the small label next to it. */
const SKILL_ABILITY: Record<string, string> = {
  Athletics: 'СИЛ', Acrobatics: 'СПР', 'Sleight of Hand': 'СПР', Stealth: 'СПР',
  Investigation: 'ІНТ', Lore: 'ІНТ', Nature: 'ІНТ', Piloting: 'ІНТ', Technology: 'ІНТ',
  'Animal Handling': 'МУД', Insight: 'МУД', Medicine: 'МУД', Perception: 'МУД', Survival: 'МУД',
  Deception: 'ХАР', Intimidation: 'ХАР', Performance: 'ХАР', Persuasion: 'ХАР',
};

const MOVE: Record<string, string> = {
  climbing: 'лазіння', swimming: 'плавання', flying: 'політ', burrowing: 'риття',
};

const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
/** Feet as the books give them, with metres next to them for the table. */
export const feet = (n: number): string => `${n} фт (${Math.round(n * 0.3)} м)`;

/** A property as written on a weapon ("reload 8", "power cell (range 30/120)"): name translated, rest kept. */
export function propertyText(term: (kind: TermKind, en: string) => string, raw: string): string {
  const m = /^([a-z][a-z -]*?)(\s+[\d(].*)?$/i.exec(raw.trim());
  if (m?.[1] === undefined) return raw;
  return `${term('property', m[1])}${m[2] ?? ''}`;
}

/** "2nd" → "2": the books' ordinal, as a plain number for the sheet. */
export const levelNumber = (ordinal: string): string => /^(\d+)/.exec(ordinal)?.[1] ?? ordinal;

/** Empty boxes to tick in pencil. */
const boxes = (n: number, used = 0): string => '☒'.repeat(Math.min(used, n)) + '☐'.repeat(Math.max(0, n - used));

export function PrintPage(): JSX.Element {
  const [data, setData] = useState<PrintData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const only = new URLSearchParams(location.search).get('character');

  useEffect(() => {
    fetch('/sheets.json')
      .then((r) => (r.ok ? (r.json() as Promise<PrintData>) : Promise.reject(new Error(`сервер відповів ${r.status}`))))
      .then(setData)
      .catch((e: unknown) => setError(String((e as Error).message ?? e)));
  }, []);

  if (error !== null) return <p className="print-message">Не вдалося взяти листи в сервера: {error}</p>;
  if (data === null) return <p className="print-message">Беру листи в сервера…</p>;

  const slugs = Object.keys(data.sheets)
    .filter((s) => only === null || s === only)
    .sort((a, b) => (data.sheets[a]?.name ?? a).localeCompare(data.sheets[b]?.name ?? b, 'uk'));

  return (
    <div className="print-root">
      <div className="print-toolbar">
        <button type="button" onClick={() => window.print()}>Друкувати</button>
        <span>
          {slugs.length === 1 ? 'Один аркуш' : `${slugs.length} аркушів`} A4. У вікні друку: «Зберегти як PDF» або принтер;
          поля — «Немає» або «Типові».
        </span>
      </div>
      {slugs.map((slug) => (
        <PrintSheet
          key={slug}
          sheet={data.sheets[slug] as SheetSummary}
          state={data.characters[slug] ?? {}}
          glossary={data.glossary}
          mode={readMode()}
          session={data.session}
          printedAt={new Date()}
        />
      ))}
    </div>
  );
}

function Box({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }): JSX.Element {
  return (
    <div className={`p-box${wide === true ? ' wide' : ''}`}>
      <div className="p-value">{children}</div>
      <div className="p-label">{label}</div>
    </div>
  );
}

export function PrintSheet({
  sheet,
  state,
  glossary,
  mode,
  session,
  printedAt,
}: {
  sheet: SheetSummary;
  state: CharacterState;
  glossary: Record<string, string>;
  mode: TermMode;
  session: number;
  printedAt: Date;
}): JSX.Element {
  const term = (kind: TermKind, english: string): string => showTerm(glossary, mode, kind, english);
  const d = sheet.details;
  // A hand edit on a number is marked, as on the GM card (F-043): paper must not hide it.
  const edited = (key: string): string =>
    sheet.handEdits.some((h) => h.key === key && h.verdict !== 'customItem') ? '✎' : '';
  const lost = num(state.hitPointsLost);
  const conditions = (Array.isArray(state.conditions) ? state.conditions : []) as string[];

  const classLine = sheet.classes
    .map((c) => `${term('class', c.name)} ${c.levels}${c.archetype === undefined ? '' : ` · ${term('archetype', c.archetype)}`}`)
    .join(' / ');

  return (
    <article className="a4">
      <header className="p-head">
        <div>
          <h1>{sheet.name}</h1>
          <p>
            {[sheet.species === null ? null : term('species', sheet.species), classLine].filter((x) => x !== null).join(' · ')}
          </p>
          <p className="p-sub">
            {[
              d.background === null ? null : `Передісторія: ${term('background', d.background)}`,
              d.alignment === null ? null : `Світогляд: ${d.alignment}`,
            ].filter((x) => x !== null).join(' · ')}
          </p>
        </div>
        <div className="p-head-right">
          <Box label="рівень">{d.level}</Box>
          <Box label="майстерність">{signed(sheet.proficiencyBonus)}</Box>
          <Box label="натхнення">{state.hasInspiration === true ? '★' : '☐'}</Box>
        </div>
      </header>

      <section className="p-vitals">
        <Box label="КБ">{sheet.armorClass}{edited('armorClass')}</Box>
        <Box label="ініціатива">{signed(sheet.initiative)}</Box>
        <Box label="швидкість" wide>
          {d.speed.walk === null ? '—' : feet(d.speed.walk)}
          {d.speed.other.map((o) => <small key={o.kind}><br />{MOVE[o.kind] ?? o.kind} {feet(o.feet)}</small>)}
        </Box>
        <Box label="пасивна увага">{sheet.passivePerception}</Box>
        <Box label="максимум ХП" wide>
          {sheet.maxHitPoints}{edited('hitPoints')}
          <small><br />зараз: ______ тимч.: ____</small>
        </Box>
        <Box label="кубики здоровʼя" wide>
          {sheet.hitDice.map((h) => (
            <span key={h.size}>{h.count} × {h.size} {boxes(h.count, usedOf(state.hitDiceUsed, h.size))} </span>
          ))}
        </Box>
        <Box label="рятівні від смерті" wide>
          <small>успіх ○○○ · провал ○○○</small>
        </Box>
      </section>

      <section className="p-abilities">
        {ABILITIES.map(({ key }) => (
          <div key={key} className="p-ability">
            <div className="p-label">{term('ability', key)}</div>
            <div className="p-mod">{signed(sheet.abilityModifiers[key] ?? 0)}{edited(`ability:${key}`)}</div>
            <div className="p-score">{d.abilityScores[key]}</div>
            <div className="p-save">
              {d.proficientSaves.includes(key) ? '●' : '○'} сейв {signed(sheet.savingThrows[key] ?? 0)}
            </div>
          </div>
        ))}
      </section>

      <div className="p-columns">
        <section className="p-skills">
          <h2>Навички</h2>
          <ul>
            {sheet.skills.map((k) => (
              <li key={k.name}>
                <span className="mark">{k.proficiency === 'Expertise' ? '◆' : k.proficiency === 'Proficient' ? '●' : '○'}</span>
                <span className="what">{term('skill', k.name)}</span>
                <span className="ab">{SKILL_ABILITY[k.name] ?? ''}</span>
                <b>{signed(k.modifier)}</b>
              </li>
            ))}
          </ul>
          <p className="p-legend">● володіння · ◆ експертиза</p>
        </section>

        <div className="p-right">
          <section>
            <h2>Атаки</h2>
            <table className="p-attacks">
              <thead>
                <tr><th>Зброя</th><th>Влучання</th><th>Шкода</th><th>Властивості</th></tr>
              </thead>
              <tbody>
                {sheet.attacks.map((a, i) => (
                  <tr key={a.name}>
                    <td>{term('weapon', a.name)}</td>
                    <td>{signed(a.toHit)}{edited(`attack:${i}`)}</td>
                    <td>{a.damageDice} {term('damage', a.damageType)}</td>
                    <td className="props">{a.properties.map((p) => propertyText(term, p)).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {d.casting.map((c) => (
            <section key={`${c.kind}-${c.source}`} className="p-casting">
              <h2>
                {c.kind === 'force' ? 'Сила' : 'Техніка'}{' '}
                <small>· {term(sheet.classes.some((k) => k.name === c.source) ? 'class' : 'archetype', c.source)}</small>
              </h2>
              <p>
                Поінти <b>{c.points}</b> · витрачено ______ · DC <b>{c.saveDC}</b> · атака <b>{c.attack}</b> · найвищий
                рівень <b>{levelNumber(c.maxPowerLevel)}</b>
              </p>
              <p className="p-list">
                {[...c.powers.map((p) => term('power', p)), ...c.customPowers.map((p) => `${term('power', p)}*`)].join(' · ')}
              </p>
              {c.customPowers.length > 0 && <p className="p-legend">* вписано руками, понад книгу</p>}
            </section>
          ))}

          {sheet.superiority !== undefined && (
            <section className="p-casting">
              <h2>Суперіориті</h2>
              <p>
                Кубики <b>{sheet.superiority.quantity} × {sheet.superiority.size}</b>{' '}
                {boxes(sheet.superiority.quantity, num(state.superiorityDiceUsed))}
              </p>
              <ul className="p-maneuvers">
                {sheet.maneuvers.map((m) => (
                  <li key={m.name}>
                    <span className="what">{term('maneuver', m.name)}</span>
                    <span>{m.cost === 0 ? '—' : `${m.cost} куб.`}</span>
                    <b>{m.saveDC === null ? '' : `DC ${m.saveDC}`}</b>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2>Риси, здібності, мови</h2>
            {d.feats.length > 0 && <p><b>Риси:</b> {d.feats.map((f) => term('feat', f)).join(' · ')}</p>}
            {d.customFeatures.length > 0 && <p><b>Власні здібності:</b> {d.customFeatures.join(' · ')}</p>}
            {d.languages.length > 0 && <p><b>Мови:</b> {d.languages.join(', ')}</p>}
          </section>
        </div>
      </div>

      <footer className="p-foot">
        <p>
          <b>На момент друку:</b> ХП {Math.max(0, sheet.maxHitPoints - lost)} з {sheet.maxHitPoints}
          {num(state.temporaryHitPoints) > 0 ? ` (+${num(state.temporaryHitPoints)} тимч.)` : ''}
          {sheet.forcePoints !== undefined ? ` · Сила ${Math.max(0, sheet.forcePoints.max - num(state.forcePointsUsed))}/${sheet.forcePoints.max}` : ''}
          {sheet.techPoints !== undefined ? ` · Техніка ${Math.max(0, sheet.techPoints.max - num(state.techPointsUsed))}/${sheet.techPoints.max}` : ''}
          {num(state.exhaustion) > 0 ? ` · виснаження ${num(state.exhaustion)}` : ''}
          {conditions.length > 0 ? ` · ${conditions.map((c) => term('condition', c)).join(', ')}` : ''}
        </p>
        <p className="p-legend">
          Надруковано {printedAt.toLocaleDateString('uk-UA')} · сесія {String(session).padStart(2, '0')} · числа
          рахує рушій Holotable{sheet.handEdits.some((h) => h.verdict !== 'customItem') ? ' · ✎ — ручна правка, див. екран майстра' : ''}
        </p>
      </footer>
    </article>
  );
}
