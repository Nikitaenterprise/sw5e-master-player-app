// The ship at the table (F-060) and in a space fight (F-063): the GM's panel and the
// strip on every phone.
//
// One ship's state, everyone's to see: shields falling and the hull holding are table
// news, not the GM's secret. The GM deals damage — by the book: the armour, then the
// shields, then the hull, each damage type at its own rate — starts the ship's turn and
// rolls destruction saves typed in by hand. The crew moves power dice between storages
// from their phones; which station takes which action is the owner's call (step L-05 in
// docs/ЩО-МУСИТЬ-ЛЮДИНА.md), so no
// screen pretends to know it.
import { useState, type JSX } from 'react';
import {
  DEPLOYMENTS,
  ENEMY_SHIP_SIZES,
  POWER_SPENT,
  SHIP_DAMAGE_TYPES,
  SHIP_DESTROYED,
  SHIP_DISABLED,
  SHIP_STABLE,
  SHIP_SYSTEM_NAMES,
  exhaustionEffects,
  shipMaxima,
  type CharacterState,
  type CombatState,
  type EnemyShipSize,
  type ShipDamageOptions,
  type ShipState,
  type ShipSummary,
} from '@holotable/protocol';
import { name } from './characters.js';

const ABILITY_SHORT: Record<string, string> = {
  Strength: 'СИЛ', Dexterity: 'СПР', Constitution: 'СТА', Intelligence: 'ІНТ', Wisdom: 'МУД', Charisma: 'ХАР',
};

const POOL_UK: Record<string, string> = {
  central: 'центр', communications: 'звʼязок', engines: 'двигуни', shields: 'щити', sensors: 'сенсори', weapons: 'зброя',
};

const DAMAGE_UK: Record<string, string> = {
  energy: 'енергетична', kinetic: 'кінетична', force: 'Сила', true: 'істинна', acid: 'кислота', cold: 'холод',
  fire: 'вогонь', ion: 'іонна', lightning: 'блискавка', necrotic: 'некротична', poison: 'отрута', psychic: 'психічна',
  sonic: 'звукова',
};

const CONDITION_UK: Record<string, string> = {
  [SHIP_DISABLED]: 'вимкнений', [SHIP_STABLE]: 'стабільний', [SHIP_DESTROYED]: 'знищений',
};

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/** What is left of each pool now — what the screens show, never what is stored. */
export function shipLeft(summary: ShipSummary, state: ShipState) {
  const used = state.powerDiceUsed ?? {};
  const max = shipMaxima(summary, state);
  return {
    max,
    hull: Math.max(0, max.hull - (state.hullPointsLost ?? 0)),
    shields: Math.max(0, max.shields - (state.shieldPointsLost ?? 0)),
    fuel: (summary.fuelCapacity ?? 0) - (state.fuelUsed ?? 0),
    pool: (p: string): number => (p === 'central' ? summary.power.central - (used.central ?? 0) : summary.power.perSystem - (used.systems?.[p] ?? 0)),
  };
}

/** The ship's condition in words: disabled, stable, destroyed — and system damage with what it does. */
export function shipStatusText(state: ShipState, levels: string[]): string[] {
  const out = (state.conditions ?? []).map((c) => CONDITION_UK[c] ?? c);
  const level = state.systemDamage ?? 0;
  if (level > 0) out.push(`пошкодження систем ${level}: ${exhaustionEffects(levels, level).join('; ')}`);
  return out;
}

/** A crew member at their station, with what exhaustion does to their rolls there. */
export function crewLine(slug: string, deployment: string, character: CharacterState | undefined, exhaustionLevels: string[]): string {
  const level = typeof character?.exhaustion === 'number' ? character.exhaustion : 0;
  const tired = level > 0 ? ` · виснаження ${level}: ${exhaustionEffects(exhaustionLevels, level).join('; ')}` : '';
  return `${name(slug)} — ${deployment}${tired}`;
}

function Bar({ label, left, max, kind }: { label: string; left: number; max: number; kind: string }): JSX.Element {
  const share = max === 0 ? 0 : Math.max(0, Math.min(1, left / max));
  return (
    <div className={`ship-bar ${kind}`}>
      <span className="ship-bar-label">{label}</span>
      <span className="ship-bar-track"><span style={{ width: `${Math.round(share * 100)}%` }} /></span>
      <b>{left}</b>
      <small>/{max}</small>
    </div>
  );
}

/** Moving one power die from a storage to another: the crew's call, the book says. */
function PowerMove({ summary, state, move }: { summary: ShipSummary; state: ShipState; move: (from: string, to: string) => void }): JSX.Element | null {
  const pools = ['central', ...(summary.power.perSystem > 0 ? SHIP_SYSTEM_NAMES : [])];
  const [from, setFrom] = useState('central');
  const [to, setTo] = useState('engines');
  if (pools.length < 2) return null;
  const left = shipLeft(summary, state);
  return (
    <span className="ship-power-move">
      перекинути кубик:
      <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Звідки">
        {pools.map((p) => <option key={p} value={p}>{POOL_UK[p]} ({left.pool(p)})</option>)}
      </select>
      →
      <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Куди">
        {pools.map((p) => <option key={p} value={p}>{POOL_UK[p]}</option>)}
      </select>
      <button type="button" onClick={() => move(from, to)}>перекинути</button>
    </span>
  );
}

/** Power dice by storage, in one line: each storage with what it holds now and at most. */
function powerText(summary: ShipSummary, state: ShipState): string {
  const left = shipLeft(summary, state);
  const pools = ['central', ...(summary.power.perSystem > 0 ? SHIP_SYSTEM_NAMES : [])];
  return pools.map((p) => `${POOL_UK[p]} ${left.pool(p)}/${p === 'central' ? summary.power.central : summary.power.perSystem}`).join(' · ');
}

/** The phone: one line with what matters, the rest folded — the player's station, and power for the crew. */
export function ShipStrip({
  summary,
  state,
  character,
  crewState,
  exhaustionLevels = [],
  systemDamageLevels = [],
  move,
}: {
  summary: ShipSummary;
  state: ShipState;
  character?: string;
  crewState?: CharacterState;
  exhaustionLevels?: string[];
  systemDamageLevels?: string[];
  move?: (from: string, to: string) => void;
}): JSX.Element {
  const left = shipLeft(summary, state);
  const station = summary.crew.find((c) => c.character === character)?.deployment;
  const status = shipStatusText(state, systemDamageLevels);
  return (
    <details className="ship-strip">
      <summary>
        <b>{summary.name}</b> · корпус {left.hull}/{left.max.hull}
        {summary.shields !== null && <> · щити {left.shields}/{left.max.shields}</>}
        {station !== undefined && <small> · ти — {station}</small>}
        {status.length > 0 && <small className="ship-alarm"> · {status.join(' · ')}</small>}
      </summary>
      <Bar label="Корпус" left={left.hull} max={left.max.hull} kind="hull" />
      {summary.shields !== null && <Bar label="Щити" left={left.shields} max={left.max.shields} kind="shields" />}
      <p className="ship-line">
        КБ {summary.armorClass} · зменшення шкоди {summary.damageReduction} · паливо {left.fuel}/{summary.fuelCapacity ?? 0}
      </p>
      {station !== undefined && character !== undefined && (
        <p className="ship-line">Твоя станція: {crewLine(character, station, crewState, exhaustionLevels)}</p>
      )}
      <p className="ship-line">Живлення: {powerText(summary, state)}</p>
      {station !== undefined && move !== undefined && <PowerMove summary={summary} state={state} move={move} />}
      <p className="ship-line">Екіпаж: {summary.crew.map((c) => `${name(c.character)} — ${c.deployment}`).join(' · ')}</p>
    </details>
  );
}

/**
 * The GM's seating plan (F-061): six stations, one person each. Changing a station is
 * one click; nobody is seated twice, because seating a person who already sits
 * somewhere moves them, and the ship's strip on their phone says where they now are.
 */
export function Stations({
  summary,
  party,
  seat,
}: {
  summary: ShipSummary;
  party: Record<string, CharacterState>;
  seat: (deployment: string, character: string | null) => void;
}): JSX.Element {
  const slugs = Object.keys(party).sort((a, b) => name(a).localeCompare(name(b), 'uk'));
  return (
    <div className="ship-stations">
      <h3>Станції</h3>
      {DEPLOYMENTS.map((deployment) => {
        const here = summary.crew.find((c) => c.deployment === deployment);
        return (
          <label key={deployment} className="ship-station">
            <span className="ship-station-name">{deployment}</span>
            <select
              value={here?.character ?? ''}
              onChange={(e) => seat(deployment, e.target.value === '' ? null : e.target.value)}
            >
              <option value="">вільна</option>
              {slugs.map((slug) => <option key={slug} value={slug}>{name(slug)}</option>)}
            </select>
          </label>
        );
      })}
      <p className="hint">
        Одна станція — одна людина. Хто вже стоїть на іншій станції, той на неї переходить,
        а не роздвоюється. Картка станції зʼявляється в того, кого посадили, на телефоні.
      </p>
    </div>
  );
}

/**
 * A space fight, step by step (F-112). The mechanics were there (F-060, F-063, F-061);
 * what the table lacked was the way through them. One button starts it — the crew roll
 * initiative on their phones as in any fight, and the ship acts on the lowest of them
 * (F-063). Then the book's round in order: the ship's turn, each station in turn, a hit
 * that takes the shields first and then the hull, and the end, which leaves the damage.
 */
export function SpaceFight({
  summary,
  combat,
  initiative,
  start,
  end,
  turn,
  enemies,
}: {
  summary: ShipSummary;
  combat: CombatState | null;
  initiative: { value: number; by: string } | null;
  start: () => void;
  end: () => void;
  turn: () => void;
  /** Enemy ships (F-124). Absent — the block is not shown. */
  enemies?: { add: (size: EnemyShipSize, tier: number, count: number, name?: string) => void; damage: (enemy: string, amount: number) => void; remove: (enemy: string) => void };
}): JSX.Element {
  const [acted, setActed] = useState<string[]>([]);
  const [ending, setEnding] = useState(false);
  // A ground fight is on: the space one starts when it is over (F-123).
  if (combat !== null && combat.space !== true) {
    return (
      <section className="space-fight">
        <p className="hint">Зараз іде наземний бій. Космічний почнеш, коли його завершиш (вкладка «Бій»).</p>
      </section>
    );
  }
  if (combat === null) {
    return (
      <section className="space-fight">
        <button type="button" className="next-turn" onClick={start}>
          Почати космічний бій
          <small>екіпаж кидає ініціативу на телефонах</small>
        </button>
        <ol className="space-steps idle">
          <li><b>Ініціатива</b> — кожен за станцією кидає d20; корабель ходить на найнижчому.</li>
          <li><b>Хід корабля</b> — щити й реактор, тоді станції по черзі.</li>
          <li><b>Влучання</b> — шкода йде спершу в щити, потім у корпус.</li>
          <li><b>Кінець бою</b> — черга зникає, пошкодження лишається.</li>
        </ol>
      </section>
    );
  }
  const crew = summary.crew.map((c) => c.character);
  const waiting = combat.order.filter((f) => f.kind === 'character' && crew.includes(f.character) && f.total === null);
  const toggle = (deployment: string): void =>
    setActed(acted.includes(deployment) ? acted.filter((d) => d !== deployment) : [...acted, deployment]);
  return (
    <section className="space-fight on">
      <h3>Космічний бій · раунд {combat.round}</h3>
      {enemies !== undefined && <EnemyShips combat={combat} add={enemies.add} damage={enemies.damage} remove={enemies.remove} />}
      <ol className="space-steps">
        <li className={initiative === null ? 'now' : 'done'}>
          <b>1 · Ініціатива</b>
          {initiative === null
            ? <span> — чекаємо кидків: {waiting.length === 0 ? 'хтось зі станцій ще не в черзі' : waiting.map((f) => name(f.character)).join(', ')}.</span>
            : <span> — Ініціатива корабля: <b>{initiative.value}</b> <small>(найнижча — {name(initiative.by)})</small></span>}
        </li>
        <li className={initiative === null ? '' : 'now'}>
          <b>2 · Хід корабля</b>
          <span className="space-row">
            {/^\d+$/.test(summary.power.recovery) ? (
              <button
                type="button"
                onClick={() => {
                  turn();
                  setActed([]);
                }}
              >
                Почати хід корабля
                <small>щити регенерують, реактор дає +{summary.power.recovery} живлення</small>
              </button>
            ) : (
              // A reactor that rolls its dice needs the number first: the panel below asks it.
              <a href="#ship-turn" onClick={() => setActed([])}>Почати хід корабля ↓ — спершу впиши, що дав реактор ({summary.power.recovery})</a>
            )}
          </span>
          <ul className="space-stations">
            {summary.crew.map((c) => (
              <li key={c.deployment}>
                <label>
                  <input type="checkbox" checked={acted.includes(c.deployment)} onChange={() => toggle(c.deployment)} />
                  {' '}{c.deployment} — {name(c.character)}
                </label>
              </li>
            ))}
          </ul>
          <small className="hint">Станції ходять по черзі; познач, хто вже походив. Що кожна може — у них на телефонах.</small>
        </li>
        <li>
          <b>3 · Влучання</b>
          <span> — шкода йде спершу щити, потім корпус: </span>
          <a href="#ship-damage">завдати шкоди кораблю ↓</a>
        </li>
        <li>
          <b>4 · Кінець бою</b>
          {ending ? (
            <span className="space-row">
              <button type="button" onClick={() => { setEnding(false); end(); }}>так, завершити</button>
              <button type="button" onClick={() => setEnding(false)}>ні</button>
            </span>
          ) : (
            <span className="space-row">
              <button type="button" onClick={() => setEnding(true)}>
                Завершити космічний бій
                <small>черга зникає; пошкодження лишається</small>
              </button>
            </span>
          )}
        </li>
      </ol>
    </section>
  );
}

const SIZE_UK: Record<string, string> = {
  Tiny: 'крихітний', Small: 'малий', Medium: 'середній', Large: 'великий', Huge: 'величезний', Gargantuan: 'гігантський',
};

/**
 * Enemy ships in a space fight (F-124): the GM generates them by size and tier — the book
 * puts the rest together — and deals each hit, which takes armour, then shields, then hull.
 */
export function EnemyShips({
  combat,
  add,
  damage,
  remove,
}: {
  combat: CombatState;
  add: (size: EnemyShipSize, tier: number, count: number, name?: string) => void;
  damage: (enemy: string, amount: number) => void;
  remove: (enemy: string) => void;
}): JSX.Element {
  const [size, setSize] = useState<EnemyShipSize>('Small');
  const [tier, setTier] = useState('0');
  const [count, setCount] = useState('1');
  const [label, setLabel] = useState('');
  const [hits, setHits] = useState<Record<string, string>>({});
  const ships = combat.order.filter((f) => f.enemy?.ship !== undefined);
  return (
    <div className="enemy-ships">
      <h4>Ворожі кораблі</h4>
      <form
        className="add"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          const n = Number(count);
          if (!Number.isInteger(n) || n < 1 || n > 10) return;
          add(size, Number(tier), n, label.trim() === '' ? undefined : label.trim());
        }}
      >
        <b>Додати ворожий корабель</b>
        <label className="roll-field">
          <span>Розмір</span>
          <select value={size} onChange={(ev) => setSize(ev.target.value as EnemyShipSize)}>
            {ENEMY_SHIP_SIZES.map((s) => <option key={s} value={s}>{SIZE_UK[s]} ({s})</option>)}
          </select>
        </label>
        <label className="roll-field">
          <span>Тір</span>
          <select value={tier} onChange={(ev) => setTier(ev.target.value)}>
            {[0, 1, 2, 3, 4, 5].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="roll-field">
          <span>Скільки</span>
          <input type="number" min={1} max={10} value={count} onChange={(ev) => setCount(ev.target.value)} />
        </label>
        <label className="roll-field">
          <span>Назва</span>
          <input value={label} onChange={(ev) => setLabel(ev.target.value)} placeholder="Ворожий корабель" maxLength={40} />
        </label>
        <button type="submit">додати в бій</button>
      </form>
      <p className="hint">Корабель складається за книгою: розмір і тір дають корпус, щити й КБ; зброя — під розмір. Ініціативу за нього кидаєш ти — у черзі на вкладці «Бій».</p>
      {ships.length > 0 && (
        <ul className="enemy-ship-list">
          {ships.map((f) => {
            const e = f.enemy;
            const s = e?.ship;
            if (e === undefined || s === undefined) return null;
            return (
              <li key={f.id} className={e.hp === 0 ? 'down' : undefined}>
                <b>{f.name}</b>
                <small> {SIZE_UK[s.size] ?? s.size} · {s.role} · тір {s.tier}</small>
                <span className="ship-line">
                  КБ {e.ac} · щити {s.shields}/{s.maxShields} · корпус {e.hp}/{e.maxHp} · броня −{s.damageReduction}
                  {f.total !== null && <> · ініціатива {f.total}</>}
                </span>
                <span className="ship-line">
                  {e.attacks.map((a, i) => <span key={`${a.name}-${i}`} className="ship-gun">{a.name} +{a.toHit} <small>({a.text.split(' · ')[0]})</small></span>)}
                </span>
                <form
                  className="add"
                  noValidate
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    const n = Number(hits[f.id] ?? '');
                    if (Number.isInteger(n) && n > 0) damage(f.id, n);
                    setHits({ ...hits, [f.id]: '' });
                  }}
                >
                  <input type="number" min={1} value={hits[f.id] ?? ''} onChange={(ev) => setHits({ ...hits, [f.id]: ev.target.value })} placeholder="шкода" aria-label={`Шкода кораблю ${f.name}`} />
                  <button type="submit">влучили</button>
                  <button type="button" onClick={() => remove(f.id)}>прибрати</button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The GM's panel: the numbers from the rules, the state now, and the buttons that change it. */
export function ShipPanel({
  summary,
  state,
  damage,
  set,
  turn,
  destructionSave,
  move,
  initiative = null,
  fighting = false,
  party = {},
  exhaustionLevels = [],
  systemDamageLevels = [],
  seat,
}: {
  summary: ShipSummary;
  state: ShipState;
  damage: (amount: number, options: ShipDamageOptions) => void;
  set: (changes: ShipState) => void;
  /** Seating someone at a station, or freeing it with null (F-061). */
  seat?: (deployment: string, character: string | null) => void;
  turn?: (regenerate: boolean, recovered?: number) => void;
  destructionSave?: (roll: number) => void;
  move?: (from: string, to: string) => void;
  /** The ship's initiative: the lowest of the crew's (F-063). */
  initiative?: { value: number; by: string } | null;
  fighting?: boolean;
  party?: Record<string, CharacterState>;
  exhaustionLevels?: string[];
  systemDamageLevels?: string[];
}): JSX.Element {
  const [amount, setAmount] = useState('');
  const [type, setType] = useState('energy');
  const [attack, setAttack] = useState(true);
  const [critical, setCritical] = useState(false);
  const [disable, setDisable] = useState(false);
  const [regenerate, setRegenerate] = useState(true);
  const [recovered, setRecovered] = useState('');
  const [roll, setRoll] = useState('');
  const left = shipLeft(summary, state);
  const lost = { hull: state.hullPointsLost ?? 0, shields: state.shieldPointsLost ?? 0, fuel: state.fuelUsed ?? 0 };
  const clamp = (n: number, max: number): number => Math.max(0, Math.min(max, n));
  const step = (field: 'hullPointsLost' | 'shieldPointsLost' | 'fuelUsed', now: number, max: number, by: number) => (
    <button type="button" onClick={() => set({ [field]: clamp(now + by, max) })} disabled={clamp(now + by, max) === now}>
      {by > 0 ? `−${by}` : `+${-by}`}
    </button>
  );
  const conditions = state.conditions ?? [];
  const status = shipStatusText(state, systemDamageLevels);
  const needsSave = left.hull === 0 && !conditions.includes(SHIP_STABLE) && !conditions.includes(SHIP_DESTROYED);
  const saves = state.destructionSaves ?? { successes: 0, failures: 0 };
  const rolledRecovery = !/^\d+$/.test(summary.power.recovery);
  return (
    <section className="ship-panel">
      <h2>Корабель — {summary.name}</h2>
      <p className="hint">
        {[summary.model, summary.size, `тір ${summary.tier}`, summary.role].filter((x) => x !== undefined).join(' · ')}
      </p>
      {status.length > 0 && <p className="ship-alarm">{status.join(' · ')}</p>}
      {fighting && (
        <p className="ship-line">
          Ініціатива корабля:{' '}
          {initiative === null ? 'чекає кидків усього екіпажу' : <><b>{initiative.value}</b> <small>(найнижча в екіпажі — {name(initiative.by)})</small></>}
        </p>
      )}
      <div className="ship-pools">
        <div className="ship-pool">
          <Bar label="Корпус" left={left.hull} max={left.max.hull} kind="hull" />
          <span className="ship-steps">
            {step('hullPointsLost', lost.hull, left.max.hull, 5)}
            {step('hullPointsLost', lost.hull, left.max.hull, 1)}
            {step('hullPointsLost', lost.hull, left.max.hull, -1)}
            {step('hullPointsLost', lost.hull, left.max.hull, -5)}
          </span>
          <small>кубики корпусу: {summary.hull.dice.count}{summary.hull.dice.size}</small>
        </div>
        {summary.shields !== null && (
          <div className="ship-pool">
            <Bar label="Щити" left={left.shields} max={left.max.shields} kind="shields" />
            <span className="ship-steps">
              {step('shieldPointsLost', lost.shields, left.max.shields, 5)}
              {step('shieldPointsLost', lost.shields, left.max.shields, 1)}
              {step('shieldPointsLost', lost.shields, left.max.shields, -1)}
              <button type="button" disabled={lost.shields === 0} onClick={() => set({ shieldPointsLost: 0 })}>повні</button>
            </span>
            <small>регенерація {left.max.regeneration} · ємність {summary.shields.capacity}</small>
          </div>
        )}
      </div>
      <form
        id="ship-damage"
        className="ship-damage"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(amount);
          if (Number.isInteger(n) && n > 0) {
            damage(n, { type, ...(attack ? { attack: true } : {}), ...(critical ? { critical: true } : {}), ...(disable ? { disable: true } : {}) });
          }
          setAmount('');
          setCritical(false);
          setDisable(false);
        }}
      >
        <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="шкода" aria-label="Шкода кораблю" />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Тип шкоди">
          {Object.keys(SHIP_DAMAGE_TYPES).map((t) => <option key={t} value={t}>{DAMAGE_UK[t] ?? t} ({t})</option>)}
        </select>
        <label><input type="checkbox" checked={attack} onChange={(e) => setAttack(e.target.checked)} /> влучання атакою (броня −{summary.damageReduction})</label>
        <label><input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} /> критичне</label>
        <label><input type="checkbox" checked={disable} onChange={(e) => setDisable(e.target.checked)} /> вимкнути, а не знищити</label>
        <button type="submit">завдати</button>
        <small>спершу щити, решта — корпусу; тип шкоди — за книгою</small>
      </form>
      {turn !== undefined && (
        <div className="ship-turn" id="ship-turn">
          <button type="button" onClick={() => turn(regenerate, rolledRecovery ? Number(recovered) || 0 : undefined)}>Початок ходу корабля</button>
          <label><input type="checkbox" checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)} /> з регенерацією щитів (+{left.max.regeneration})</label>
          {rolledRecovery && (
            <input type="number" min={0} value={recovered} onChange={(e) => setRecovered(e.target.value)} placeholder={summary.power.recovery} aria-label="Скільки дав реактор" />
          )}
          <small>реактор: +{summary.power.recovery} у центр</small>
        </div>
      )}
      {needsSave && destructionSave !== undefined && (
        <form
          className="ship-turn"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(roll);
            if (Number.isInteger(n) && n >= 1 && n <= 20) destructionSave(n);
            setRoll('');
          }}
        >
          <b>Кидок на руйнування</b>
          <small>успіхів {saves.successes}/3 · провалів {saves.failures}</small>
          <input type="number" min={1} max={20} value={roll} onChange={(e) => setRoll(e.target.value)} placeholder="d20" aria-label="Кидок на руйнування" />
          <button type="submit">кинуто</button>
          <small>лише кубик: до цього кидка нічого не додається</small>
        </form>
      )}
      <p className="ship-line">
        КБ <b>{summary.armorClass}</b> · зменшення шкоди {summary.damageReduction} · швидкість {summary.speed ?? '—'} · поворот {summary.turning ?? '—'}
        {' '}· трюм {summary.cargoTons ?? '—'} т · мінімальний екіпаж {summary.minimumCrew ?? '—'}
      </p>
      <div className="ship-line ship-fuel">
        Паливо <b>{left.fuel}</b>/{summary.fuelCapacity ?? 0}
        {step('fuelUsed', lost.fuel, summary.fuelCapacity ?? 0, 1)}
        {step('fuelUsed', lost.fuel, summary.fuelCapacity ?? 0, -1)}
      </div>
      <div className="ship-line ship-power">
        Кубики живлення ({summary.power.die}, +{summary.power.recovery} за хід):
        {(['central', ...(summary.power.perSystem > 0 ? SHIP_SYSTEM_NAMES : [])] as string[]).map((p) => {
          const used = state.powerDiceUsed ?? {};
          const spent = p === 'central' ? (used.central ?? 0) : (used.systems?.[p] ?? 0);
          const capacity = p === 'central' ? summary.power.central : summary.power.perSystem;
          // Spending a die is what a station's ability does; the GM marks it by hand — as a
          // step, not a number, so a crew member moving dice at the same moment is not undone.
          return (
            <span key={p} className="ship-power-pool">
              {POOL_UK[p]} <b>{capacity - spent}</b>/{capacity}
              <button type="button" title="витрачено" disabled={move === undefined || spent >= capacity} onClick={() => move?.(p, POWER_SPENT)}>−</button>
              <button type="button" title="повернуто" disabled={move === undefined || spent === 0} onClick={() => move?.(POWER_SPENT, p)}>+</button>
            </span>
          );
        })}
        {move !== undefined && <PowerMove summary={summary} state={state} move={move} />}
      </div>
      <p className="ship-line">
        Сейви (без бонусу людини за станцією):{' '}
        {Object.entries(summary.savingThrows).map(([a, t]) => `${ABILITY_SHORT[a] ?? a} ${signed(t.modifier)}${t.proficient ? ' ●' : ''}`).join(' · ')}
      </p>
      <ul className="ship-weapons">
        {summary.weapons.map((w, i) => (
          <li key={i}>
            {w.name}{w.turret ? ' (турель)' : ''} — {w.damage} {w.damageType}
            {w.range !== null && <small> · {w.range.normal}/{w.range.long}</small>}
            <small> · атака: Мудрість {signed(summary.weaponAbilityModifier)} + бонус навідника</small>
          </li>
        ))}
      </ul>
      {seat !== undefined && <Stations summary={summary} party={party} seat={seat} />}
      <ul className="ship-crew">
        {summary.crew.map((c) => (
          <li key={c.character}>{crewLine(c.character, c.deployment, party[c.character], exhaustionLevels)}</li>
        ))}
      </ul>
      {summary.warnings.map((w) => (
        <p key={w} className="refusal">{w}</p>
      ))}
    </section>
  );
}
