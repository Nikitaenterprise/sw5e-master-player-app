import { useEffect, useRef, useState } from 'react';
import type { CharacterState, GameEvent, SessionClosed, SheetSummary } from '@holotable/protocol';
import {
  connect,
  roleFromUrl,
  EMPTY,
  type Snapshot,
  type Controls,
} from './connection.js';
import { name, LABELS } from './characters.js';
import { spendHitDie, rollHint } from './hitDice.js';
import { usedOf } from '@holotable/protocol';
import {
  collapse, valueText, authorText, subjectText, undoOf, undoNote, whenText, type FeedRow,
} from './feed.js';

export function App(): JSX.Element {
  const { role, character } = roleFromUrl(location.search);
  const [snapshot, onChange] = useState<Snapshot>(EMPTY);
  const controls = useRef<Controls | null>(null);

  useEffect(() => {
    const k = connect(role, character, onChange);
    controls.current = k;
    // The four-screen demo cuts a panel's wifi through a message from the parent page.
    const listen = (ev: MessageEvent): void => {
      if (ev.origin !== location.origin) return;
      const data = ev.data as { holotable?: unknown; cut?: unknown } | null;
      if (data?.holotable === 'wifi' && typeof data.cut === 'boolean') k.setCut(data.cut);
    };
    window.addEventListener('message', listen);
    return () => {
      window.removeEventListener('message', listen);
      k.disconnect();
    };
  }, [role, character]);

  const gm = role === 'gm';
  const header = gm ? 'Екран майстра' : name(character);

  return (
    <main className={gm ? 'gm' : 'player'}>
      <header>
        <h1>{header}</h1>
        <Indicator snapshot={snapshot} />
      </header>

      {snapshot.demo && <DemoBanner />}

      {snapshot.refusal !== null && <p className="refusal">{snapshot.refusal}</p>}

      {gm ? (
        <section>
          <h2>Партія — {Object.keys(snapshot.characters).length}</h2>
          <div className="cards">
            {Object.entries(snapshot.characters)
              .sort(([a], [b]) => name(a).localeCompare(name(b), 'uk'))
              .map(([slug, state]) => (
                <Card key={slug} slug={slug} state={state} sheet={snapshot.sheets[slug]} />
              ))}
          </div>
        </section>
      ) : (
        <PlayerSheet character={character} snapshot={snapshot} controls={controls} />
      )}

      {gm && <Rests rest={(kind) => controls.current?.sendRest(kind)} />}

      {gm && (
        <Session
          session={snapshot.session}
          lastClosed={snapshot.lastClosed}
          close={() => controls.current?.closeSession()}
        />
      )}

      {gm && (
        <Feed
          events={snapshot.events}
          undo={(row) =>
            // Relative to where the run ended: undo takes back THIS change, and what
            // others did since stays (F-045).
            controls.current?.sendChange(row.character, undoOf(row), undoNote(row), { [row.field]: row.to })
          }
        />
      )}

      <section>
        <h2>За столом — {snapshot.clients.length}</h2>
        <ul className="who-here">
          {snapshot.clients.map((k) => (
            <li key={k.id} className={k.id === snapshot.me ? 'це-я' : undefined}>
              <span className={`role role-${k.role}`}>{k.role === 'gm' ? 'М' : 'Г'}</span>
              <span className="name">{k.role === 'gm' ? 'Майстер' : name(k.character)}</span>
              {k.id === snapshot.me && <span className="tag">це ти</span>}
            </li>
          ))}
        </ul>
      </section>

      <footer>
        Фаза 1 · F-045. Числа на карточках рахує рушій при старті сервера, на диску
        їх немає (ADR 0003). Відкат — не стирання: це така сама зміна, дописана
        в журнал (ADR 0002).
      </footer>
    </main>
  );
}

function PlayerSheet({
  character,
  snapshot,
  controls,
}: {
  character: string | undefined;
  snapshot: Snapshot;
  controls: React.RefObject<Controls | null>;
}): JSX.Element {
  if (character === undefined) {
    return (
      <section>
        <p className="hint">
          Відкрий сторінку з іменем персонажа в адресі, наприклад
          <code> ?as=player&amp;character=krinzh-dor</code>
        </p>
      </section>
    );
  }
  const state = snapshot.characters[character];
  if (state === undefined) {
    return (
      <section>
        <p className="hint">Чекаю стан від сервера…</p>
      </section>
    );
  }
  const sendChange = (changes: CharacterState): void => {
    controls.current?.sendChange(character, changes);
  };
  const sheet = snapshot.sheets[character];

  return (
    <section>
      <h2>Мій стан</h2>
      <Managed state={state} sendChange={sendChange} />
      {sheet !== undefined && sheet.hitDice.length > 0 && (
        <HitDice
          state={state}
          dice={sheet.hitDice}
          constitutionModifier={sheet.abilityModifiers['Constitution'] ?? 0}
          send={(changes, note) => controls.current?.sendChange(character, changes, note)}
        />
      )}
    </section>
  );
}

/** Numeric state fields, with the steps people actually use at the table. */
const STEPS: Array<{ field: 'hitPointsLost' | 'temporaryHitPoints' | 'forcePointsUsed' | 'techPointsUsed' | 'superiorityDiceUsed' | 'exhaustion'; steps: number[] }> = [
  { field: 'hitPointsLost', steps: [-5, -1, 1, 5] },
  { field: 'temporaryHitPoints', steps: [-1, 1] },
  { field: 'forcePointsUsed', steps: [-1, 1] },
  { field: 'techPointsUsed', steps: [-1, 1] },
  { field: 'superiorityDiceUsed', steps: [-1, 1] },
  { field: 'exhaustion', steps: [-1, 1] },
];

function Managed({
  state,
  sendChange,
}: {
  state: CharacterState;
  sendChange: (changes: CharacterState) => void;
}): JSX.Element {
  const [fresh, setFresh] = useState('');
  const conditions = Array.isArray(state.conditions) ? state.conditions : [];

  const addCondition = (): void => {
    const cleaned = fresh.trim();
    if (cleaned === '' || conditions.includes(cleaned)) {
      setFresh('');
      return;
    }
    sendChange({ conditions: [...conditions, cleaned] });
    setFresh('');
  };

  return (
    <div className="managed">
      {STEPS.map(({ field, steps }) => {
        const now = typeof state[field] === 'number' ? (state[field] as number) : 0;
        return (
          <div key={field} className="state-row">
            <span className="label">{LABELS[field]}</span>
            <b className="value">{now}</b>
            <span className="buttons">
              {steps.map((step) => (
                <button
                  key={step}
                  type="button"
                  disabled={now + step < 0}
                  onClick={() => sendChange({ [field]: Math.max(0, now + step) })}
                >
                  {step > 0 ? `+${step}` : step}
                </button>
              ))}
            </span>
          </div>
        );
      })}

      <div className="state-row">
        <span className="label">{LABELS.hasInspiration}</span>
        <b className="value">{state.hasInspiration === true ? 'так' : 'ні'}</b>
        <span className="buttons">
          <button
            type="button"
            onClick={() => sendChange({ hasInspiration: state.hasInspiration !== true })}
          >
            {state.hasInspiration === true ? 'прибрати' : 'дати'}
          </button>
        </span>
      </div>

      <div className="conditions-block">
        <span className="label">{LABELS.conditions}</span>
        <div className="chips">
          {conditions.length === 0 && <span className="empty">немає</span>}
          {conditions.map((u) => (
            <button
              key={u}
              type="button"
              className="chip"
              onClick={() => sendChange({ conditions: conditions.filter((i) => i !== u) })}
            >
              {u} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
        <form
          className="add"
          onSubmit={(ev) => {
            ev.preventDefault();
            addCondition();
          }}
        >
          <input
            value={fresh}
            onChange={(ev) => setFresh(ev.target.value)}
            placeholder="додати умову"
            aria-label="Нова умова"
          />
          <button type="submit">+</button>
        </form>
      </div>
    </div>
  );
}

/**
 * Hit dice (F-044). The player spends one at the end of a short rest: rolls it by hand,
 * types what came up, and the app adds Constitution and heals. One message carries both
 * the spent die and the healed hit points, so the log never holds one without the other.
 */
export function HitDice({
  state,
  dice,
  constitutionModifier,
  send,
}: {
  state: CharacterState;
  dice: { size: string; count: number }[];
  constitutionModifier: number;
  send: (changes: CharacterState, note?: string) => void;
}): JSX.Element {
  const [rolling, setRolling] = useState<string | null>(null);
  const [roll, setRoll] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (size: string, count: number): void => {
    const result = spendHitDie(state, size, count, Number(roll), constitutionModifier);
    if (typeof result === 'string') {
      setProblem(result);
      return;
    }
    send(result.changes, result.note);
    setRolling(null);
    setRoll('');
    setProblem(null);
  };

  return (
    <div className="hit-dice">
      <h3>Кубики здоровʼя</h3>
      {dice.map(({ size, count }) => {
        const used = usedOf(state.hitDiceUsed, size);
        const left = Math.max(0, count - used);
        return (
          <div key={size} className="state-row">
            <span className="label">{size}</span>
            <b className="value">
              {left}
              <i>/{count}</i>
            </b>
            <span className="buttons">
              <button
                type="button"
                disabled={left === 0}
                onClick={() => {
                  setRolling(rolling === size ? null : size);
                  setProblem(null);
                }}
              >
                витратити
              </button>
            </span>
            {rolling === size && (
              <form
                className="add roll"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  submit(size, count);
                }}
              >
                <span className="hint">{rollHint(size, constitutionModifier)}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={Number(size.slice(1))}
                  value={roll}
                  onChange={(ev) => setRoll(ev.target.value)}
                  aria-label={`Що випало на ${size}`}
                  autoFocus
                />
                <button type="submit">лікуватись</button>
                {problem !== null && <span className="refusal">{problem}</span>}
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The rest buttons. One announcement at the table is one button here, for everyone.
 *
 * What a rest gives back is not the same for everyone, and the app does not guess: the
 * server reads each character's own class text. Hit dice are deliberately left alone —
 * spending them is the player's choice and the player's roll.
 */
function Rests({ rest }: { rest: (kind: 'short' | 'long') => void }): JSX.Element {
  return (
    <section className="rests">
      <h2>Відпочинок</h2>
      <div className="buttons">
        <button type="button" onClick={() => rest('short')}>
          Короткий
          <small>повертає те, що повертає короткий: техніку, суперіориті</small>
        </button>
        <button type="button" onClick={() => rest('long')}>
          Довгий
          <small>ХП, усі пули, половина кубиків здоровʼя, виснаження −1</small>
        </button>
      </div>
      <p className="hint">
        Кубики здоровʼя витрачають гравці: скільки й що випало — вирішують вони.
        Довгий відпочинок повертає половину від усіх (мінімум один).
      </p>
    </section>
  );
}

/** Shown on every demo screen, so nobody mistakes demo clicks for the real session. */
export function DemoBanner(): JSX.Element {
  return (
    <p className="demo-banner">
      ДЕМО · зміни йдуть в окремий журнал і зникають при наступному запуску.
      Справжні сесії не зачеплені.
    </p>
  );
}

const nn = (n: number): string => String(n).padStart(2, '0');

/** One sentence about the last session closing — what the GM sees after the button. */
export function closedText(c: SessionClosed): string {
  const head = `Сесію ${nn(c.closed)} закрито, почалась сесія ${nn(c.opened)}.`;
  return c.save.saved
    ? `${head} Збережено в git: коміт ${c.save.commit}.`
    : `${head} У git НЕ збережено: ${c.save.reason}.`;
}

/**
 * End of the evening. The log rolls over to the next session and state/ is committed
 * to git, so the campaign has a history the owner can push and restore. Nobody's hit
 * points change: state carries over, only the log file is new.
 */
export function Session({
  session,
  lastClosed,
  close,
}: {
  session: number;
  lastClosed: SessionClosed | null;
  close: () => void;
}): JSX.Element {
  return (
    <section className="session">
      <h2>Сесія {session === 0 ? '…' : nn(session)}</h2>
      {lastClosed !== null && (
        <p className={lastClosed.save.saved ? 'saved' : 'refusal'}>{closedText(lastClosed)}</p>
      )}
      <div className="buttons">
        <button
          type="button"
          disabled={session === 0}
          onClick={() => {
            if (confirm(`Закрити сесію ${nn(session)} і зберегти її в git?`)) close();
          }}
        >
          Закрити сесію
          <small>зберегти в git і почати наступну; ХП і пули не скидаються</small>
        </button>
      </div>
    </section>
  );
}

/**
 * What has happened, newest first — the GM's notification feed.
 *
 * It is not a separate mechanism: every line is already in the event log (ADR 0002),
 * and undo is an ordinary change back to where the run started, written as a new line.
 * Nothing in the log is ever rewritten.
 */
export function Feed({
  events,
  undo,
}: {
  events: GameEvent[];
  undo: (row: FeedRow) => void;
}): JSX.Element {
  const now = Date.now();
  const rows = collapse(events).slice(0, 12);
  return (
    <section className="feed">
      <h2>Що сталося</h2>
      {rows.length === 0 ? (
        <p className="hint">Поки ніхто нічого не змінив.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={`${row.id}-${row.field}`} className={row.isUndo ? 'undone' : undefined}>
              <span className="who">{authorText(row.author, name)}</span>
              <span className="what">
                {subjectText(row, LABELS[row.field], name)}
                {row.isUndo && <i className="mark"> ↩ відкат</i>}
              </span>
              <span className="change">
                {valueText(row.from)} → <b>{valueText(row.to)}</b>
                {row.count > 1 && <i className="times"> ×{row.count}</i>}
              </span>
              <span className="when">{whenText(row.at, now)}</span>
              <button type="button" className="undo" onClick={() => undo(row)}>
                відкотити
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ABILITY_SHORT: { key: string; label: string }[] = [
  { key: 'Strength', label: 'СИЛ' },
  { key: 'Dexterity', label: 'СПР' },
  { key: 'Constitution', label: 'СТА' },
  { key: 'Intelligence', label: 'ІНТ' },
  { key: 'Wisdom', label: 'МУД' },
  { key: 'Charisma', label: 'ХАР' },
];

const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));

const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);

/**
 * One character, as the GM needs them at the table: how much they can still take, what
 * they roll, what they have left to spend. The computed numbers come from the server,
 * the spent ones from live state, and the two are kept visibly apart — a pool always
 * reads "left of max", never a bare number nobody can check.
 */
export function Card({
  slug,
  state,
  sheet,
}: {
  slug: string;
  state: CharacterState;
  sheet: SheetSummary | undefined;
}): JSX.Element {
  const conditions = Array.isArray(state.conditions) ? state.conditions : [];
  const lost = asNumber(state.hitPointsLost);
  const temporary = asNumber(state.temporaryHitPoints);
  const exhaustion = asNumber(state.exhaustion);

  if (sheet === undefined) {
    // The server has not sent the sheets yet, or there is no source export for this
    // character. Say so rather than drawing an empty card.
    return (
      <article className="card">
        <h3>{name(slug)}</h3>
        <p className="hint">Обчислені числа ще не прийшли від сервера…</p>
      </article>
    );
  }

  const left = Math.max(0, sheet.maxHitPoints - lost);
  const share = sheet.maxHitPoints === 0 ? 0 : left / sheet.maxHitPoints;
  const hpClass = left === 0 ? 'hp down' : share <= 0.25 ? 'hp low' : share <= 0.5 ? 'hp half' : 'hp';

  return (
    <article className={`card${left === 0 ? ' is-down' : ''}`}>
      <h3>
        {name(slug)}
        {state.hasInspiration === true && <span className="inspiration" title="Натхнення">★</span>}
        {sheet.warnings.length > 0 && (
          <span className="warn" title={sheet.warnings.join('\n')}>
            ⚠ {sheet.warnings.length}
          </span>
        )}
      </h3>
      <p className="line">{sheet.line}</p>

      <div className="big">
        <span className={hpClass}>
          <b>{left}</b>
          <small>з {sheet.maxHitPoints} ХП{temporary > 0 ? ` +${temporary}` : ''}</small>
        </span>
        <span>
          <b>{sheet.armorClass}</b>
          <small>КБ</small>
        </span>
        <span>
          <b>{signed(sheet.initiative)}</b>
          <small>ініціатива</small>
        </span>
        <span>
          <b>{sheet.passivePerception}</b>
          <small>пас. увага</small>
        </span>
      </div>

      <table className="abilities">
        <tbody>
          <tr>
            {ABILITY_SHORT.map(({ key, label }) => (
              <th key={key}>{label}</th>
            ))}
          </tr>
          <tr>
            {ABILITY_SHORT.map(({ key }) => (
              <td key={key}>{signed(sheet.abilityModifiers[key] ?? 0)}</td>
            ))}
          </tr>
          <tr className="saves">
            {ABILITY_SHORT.map(({ key }) => (
              <td key={key} title="сейв">{signed(sheet.savingThrows[key] ?? 0)}</td>
            ))}
          </tr>
        </tbody>
      </table>

      <div className="pools">
        {sheet.forcePoints !== undefined && (
          <Pool
            label="Сила"
            left={Math.max(0, sheet.forcePoints.max - asNumber(state.forcePointsUsed))}
            max={sheet.forcePoints.max}
            note={
              sheet.forcePoints.dcLight === sheet.forcePoints.dcDark
                ? `DC ${sheet.forcePoints.dcLight}`
                : `DC ${sheet.forcePoints.dcLight}/${sheet.forcePoints.dcDark}`
            }
          />
        )}
        {sheet.techPoints !== undefined && (
          <Pool
            label="Техніка"
            left={Math.max(0, sheet.techPoints.max - asNumber(state.techPointsUsed))}
            max={sheet.techPoints.max}
            note={`DC ${sheet.techPoints.dc}`}
          />
        )}
        {sheet.superiority !== undefined && (
          <Pool
            label="Суперіориті"
            left={Math.max(0, sheet.superiority.quantity - asNumber(state.superiorityDiceUsed))}
            max={sheet.superiority.quantity}
            note={sheet.superiority.size}
          />
        )}
        {sheet.hitDice.map((d) => (
          <Pool
            key={d.size}
            label="Кубики ХП"
            left={Math.max(0, d.count - usedOf(state.hitDiceUsed, d.size))}
            max={d.count}
            note={d.size}
          />
        ))}
        {exhaustion > 0 && <Pool label="Виснаження" left={exhaustion} max={6} note="рівнів" />}
      </div>

      {sheet.attacks.length > 0 && (
        <ul className="attacks">
          {sheet.attacks.map((a) => (
            <li key={a.name}>
              <span className="what">{a.name}</span>
              <span className="hit">{signed(a.toHit)}</span>
              <span className="dmg">{a.damage}</span>
            </li>
          ))}
        </ul>
      )}

      {sheet.maneuvers.length > 0 && (
        <ul className="maneuvers">
          {sheet.maneuvers.map((m) => (
            <li key={m.name}>
              <span className="what">{m.name}</span>
              <span className="cost">{m.cost === 0 ? '—' : `${m.cost} куб.`}</span>
              {m.saveDC !== null && <span className="dc">DC {m.saveDC}</span>}
            </li>
          ))}
        </ul>
      )}

      {conditions.length > 0 && <p className="conditions">{conditions.join(', ')}</p>}
    </article>
  );
}

function Pool({
  label,
  left,
  max,
  note,
}: {
  label: string;
  left: number;
  max: number;
  note: string;
}): JSX.Element {
  return (
    <span className={`pool${left === 0 ? ' empty' : ''}`}>
      <small>{label}</small>
      <b>
        {left}<i>/{max}</i>
      </b>
      <small className="note">{note}</small>
    </span>
  );
}


function Fields({ state }: { state: CharacterState }): JSX.Element {
  return (
    <dl className="fields">
      {Object.entries(LABELS).map(([field, label]) => {
        const value = state[field as keyof CharacterState];
        return (
          <div key={field}>
            <dt>{label}</dt>
            <dd>
              {Array.isArray(value)
                ? value.length === 0
                  ? '—'
                  : value.join(', ')
                : typeof value === 'boolean'
                  ? value
                    ? 'так'
                    : 'ні'
                  : typeof value === 'number'
                    ? value
                    : '—'}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Indicator({ snapshot }: { snapshot: Snapshot }): JSX.Element {
  return (
    <>
      <Link snapshot={snapshot} />
      {snapshot.pending > 0 && (
        <p className="conn waiting">
          не надіслано: {snapshot.pending} — дійде, щойно буде звʼязок
        </p>
      )}
    </>
  );
}

function Link({ snapshot }: { snapshot: Snapshot }): JSX.Element {
  const z = snapshot.connection;
  switch (z.status) {
    case 'online':
      return <p className="conn good">підключено</p>;
    case 'connecting':
      return <p className="conn waiting">підключаюсь…</p>;
    case 'dropped':
      return (
        <p className="conn bad">
          звʼязок обірвано, пробую знову за {Math.round(z.afterMs / 100) / 10} с
        </p>
      );
    case 'cut':
      return <p className="conn bad">звʼязку немає — обірвано в демо</p>;
    case 'error':
      return <p className="conn bad">помилка: {z.text}</p>;
  }
}
