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
  POWER_SPENT,
  SHIP_DAMAGE_TYPES,
  SHIP_DESTROYED,
  SHIP_DISABLED,
  SHIP_STABLE,
  SHIP_SYSTEM_NAMES,
  exhaustionEffects,
  shipMaxima,
  type CharacterState,
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
}: {
  summary: ShipSummary;
  state: ShipState;
  damage: (amount: number, options: ShipDamageOptions) => void;
  set: (changes: ShipState) => void;
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
        className="ship-damage"
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
        <div className="ship-turn">
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
