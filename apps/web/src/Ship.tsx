// The ship at the table (F-060): the GM's panel and the strip on every phone.
//
// One ship's state, everyone's to see: shields falling and the hull holding are table
// news, not the GM's secret. The GM deals damage — the shields take it first, as the book
// says — and repairs; the phones only show.
import { useState, type JSX } from 'react';
import { SHIP_SYSTEM_NAMES, type ShipState, type ShipSummary } from '@holotable/protocol';
import { name } from './characters.js';

const ABILITY_SHORT: Record<string, string> = {
  Strength: 'СИЛ', Dexterity: 'СПР', Constitution: 'СТА', Intelligence: 'ІНТ', Wisdom: 'МУД', Charisma: 'ХАР',
};

const SYSTEM_UK: Record<string, string> = {
  communications: 'звʼязок', engines: 'двигуни', shields: 'щити', sensors: 'сенсори', weapons: 'зброя',
};

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/** What is left of each pool: what the screens show, never what is stored. */
export function shipLeft(summary: ShipSummary, state: ShipState) {
  const used = state.powerDiceUsed ?? {};
  return {
    hull: summary.hull.max - (state.hullPointsLost ?? 0),
    shields: (summary.shields?.max ?? 0) - (state.shieldPointsLost ?? 0),
    fuel: (summary.fuelCapacity ?? 0) - (state.fuelUsed ?? 0),
    central: summary.power.central - (used.central ?? 0),
    system: (s: string): number => summary.power.perSystem - (used.systems?.[s] ?? 0),
  };
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

/** The phone: one line with what matters, the rest folded — and the player's own station. */
export function ShipStrip({ summary, state, character }: { summary: ShipSummary; state: ShipState; character?: string }): JSX.Element {
  const left = shipLeft(summary, state);
  const station = summary.crew.find((c) => c.character === character)?.deployment;
  return (
    <details className="ship-strip">
      <summary>
        <b>{summary.name}</b> · корпус {left.hull}/{summary.hull.max}
        {summary.shields !== null && <> · щити {left.shields}/{summary.shields.max}</>}
        {station !== undefined && <small> · ти — {station}</small>}
      </summary>
      <Bar label="Корпус" left={left.hull} max={summary.hull.max} kind="hull" />
      {summary.shields !== null && <Bar label="Щити" left={left.shields} max={summary.shields.max} kind="shields" />}
      <p className="ship-line">
        КБ {summary.armorClass} · зменшення шкоди {summary.damageReduction} · паливо {left.fuel}/{summary.fuelCapacity ?? 0}
        {(state.conditions ?? []).length > 0 && <> · {(state.conditions ?? []).join(', ')}</>}
      </p>
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
}: {
  summary: ShipSummary;
  state: ShipState;
  damage: (amount: number) => void;
  set: (changes: ShipState) => void;
}): JSX.Element {
  const [amount, setAmount] = useState('');
  const left = shipLeft(summary, state);
  const lost = { hull: state.hullPointsLost ?? 0, shields: state.shieldPointsLost ?? 0, fuel: state.fuelUsed ?? 0 };
  const clamp = (n: number, max: number): number => Math.max(0, Math.min(max, n));
  const step = (field: 'hullPointsLost' | 'shieldPointsLost' | 'fuelUsed', now: number, max: number, by: number) => (
    <button type="button" onClick={() => set({ [field]: clamp(now + by, max) })} disabled={clamp(now + by, max) === now}>
      {by > 0 ? `−${by}` : `+${-by}`}
    </button>
  );
  const used = state.powerDiceUsed ?? {};
  const setPower = (central: number | undefined, system?: [string, number]): void =>
    set({
      powerDiceUsed: {
        central: central ?? used.central ?? 0,
        systems: system === undefined ? { ...(used.systems ?? {}) } : { ...(used.systems ?? {}), [system[0]]: system[1] },
      },
    });
  return (
    <section className="ship-panel">
      <h2>Корабель — {summary.name}</h2>
      <p className="hint">
        {[summary.model, summary.size, `тір ${summary.tier}`, summary.role].filter((x) => x !== undefined).join(' · ')}
      </p>
      <div className="ship-pools">
        <div className="ship-pool">
          <Bar label="Корпус" left={left.hull} max={summary.hull.max} kind="hull" />
          <span className="ship-steps">
            {step('hullPointsLost', lost.hull, summary.hull.max, 5)}
            {step('hullPointsLost', lost.hull, summary.hull.max, 1)}
            {step('hullPointsLost', lost.hull, summary.hull.max, -1)}
            {step('hullPointsLost', lost.hull, summary.hull.max, -5)}
          </span>
          <small>кубики корпусу: {summary.hull.dice.count}{summary.hull.dice.size}</small>
        </div>
        {summary.shields !== null && (
          <div className="ship-pool">
            <Bar label="Щити" left={left.shields} max={summary.shields.max} kind="shields" />
            <span className="ship-steps">
              {step('shieldPointsLost', lost.shields, summary.shields.max, 5)}
              {step('shieldPointsLost', lost.shields, summary.shields.max, 1)}
              {step('shieldPointsLost', lost.shields, summary.shields.max, -1)}
              <button type="button" disabled={lost.shields === 0} onClick={() => set({ shieldPointsLost: 0 })}>повні</button>
            </span>
            <small>регенерація {summary.shields.regeneration} · ємність {summary.shields.capacity}</small>
          </div>
        )}
        <form
          className="ship-damage"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(amount);
            if (Number.isInteger(n) && n > 0) damage(n);
            setAmount('');
          }}
        >
          <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="шкода" aria-label="Шкода кораблю" />
          <button type="submit">завдати</button>
          <small>спершу щити, решта — корпусу</small>
        </form>
      </div>
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
        <span className="ship-power-pool">
          центр <b>{left.central}</b>/{summary.power.central}
          <button type="button" disabled={left.central === 0} onClick={() => setPower((used.central ?? 0) + 1)}>−</button>
          <button type="button" disabled={(used.central ?? 0) === 0} onClick={() => setPower((used.central ?? 0) - 1)}>+</button>
        </span>
        {summary.power.perSystem > 0 && SHIP_SYSTEM_NAMES.map((s) => (
          <span key={s} className="ship-power-pool">
            {SYSTEM_UK[s]} <b>{left.system(s)}</b>/{summary.power.perSystem}
            <button type="button" disabled={left.system(s) === 0} onClick={() => setPower(undefined, [s, (used.systems?.[s] ?? 0) + 1])}>−</button>
            <button type="button" disabled={(used.systems?.[s] ?? 0) === 0} onClick={() => setPower(undefined, [s, (used.systems?.[s] ?? 0) - 1])}>+</button>
          </span>
        ))}
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
      <p className="ship-line">Екіпаж: {summary.crew.map((c) => `${name(c.character)} — ${c.deployment}`).join(' · ')}</p>
      {summary.warnings.map((w) => (
        <p key={w} className="refusal">{w}</p>
      ))}
    </section>
  );
}
