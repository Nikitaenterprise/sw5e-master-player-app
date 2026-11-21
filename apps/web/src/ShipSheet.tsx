// The ship's sheet (F-031): every number of «Мандрівна Зоря» in one place. /?as=ship
//
// Until now the ship lived in a PowerPoint slide and, since F-060, in the GM's panel —
// which shows what is happening (hull, shields, power) but not what the ship IS. This
// page is the other half: the sheet, the way F-030 is the sheet for a character.
//
// Same rules as the paper sheets: one HTTP request, the engine's numbers (ADR 0003),
// no socket and no place at the table. The markup is deliberately print-ready — F-062
// adds the button and the role cards on top of it, and nothing here has to move.
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import {
  showTerm,
  shipMaxima,
  type CharacterState,
  type DeploymentSummary,
  type PrintData,
  type ShipState,
  type ShipSummary,
  type TermKind,
  type TermMode,
} from '@holotable/protocol';
import { name } from './characters.js';
import { feet } from './Print.js';
import { readMode } from './terms.js';

const ABILITIES: { key: string; short: string }[] = [
  { key: 'Strength', short: 'СИЛ' },
  { key: 'Dexterity', short: 'СПР' },
  { key: 'Constitution', short: 'СТА' },
  { key: 'Intelligence', short: 'ІНТ' },
  { key: 'Wisdom', short: 'МУД' },
  { key: 'Charisma', short: 'ХАР' },
];

const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));

/** A line of the sheet: what it is called, and what it says. */
function Line({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <p className="s-line">
      <b>{label}:</b> {children}
    </p>
  );
}

/**
 * The sheet of one ship. Everything comes from the engine's summary and the state the
 * server sent with it; the only arithmetic here is "what is left", which the GM's panel
 * does the same way.
 */
export function ShipSheet({
  summary,
  state,
  deployments,
  party,
  glossary,
  mode,
  session,
  printedAt,
  problems = [],
}: {
  summary: ShipSummary;
  state: ShipState;
  /** Deployment sheets by character slug: who is at which station, and what they took. */
  deployments: Record<string, DeploymentSummary[]>;
  party: Record<string, CharacterState>;
  glossary: Record<string, string>;
  mode: TermMode;
  session: number;
  printedAt: Date;
  /** What is wrong with the owner's files, in the checker's own words. */
  problems?: string[];
}): JSX.Element {
  const term = (kind: TermKind, english: string): string => showTerm(glossary, mode, kind, english);
  const max = shipMaxima(summary, state);
  const left = {
    hull: Math.max(0, max.hull - (state.hullPointsLost ?? 0)),
    shields: Math.max(0, max.shields - (state.shieldPointsLost ?? 0)),
    fuel: (summary.fuelCapacity ?? 0) - (state.fuelUsed ?? 0),
  };
  const head = [summary.model, summary.size, `тір ${summary.tier}`, summary.role]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ');

  return (
    <article className="s-sheet">
      <header className="s-head">
        <h1>{summary.name}</h1>
        <p className="s-sub">{head}</p>
      </header>

      <div className="s-grid">
        <section className="s-block">
          <h2>Корпус і щити</h2>
          <Line label="Корпус">
            <b>{max.hull}</b> ({summary.hull.dice.count}{summary.hull.dice.size}) · зараз {left.hull}
          </Line>
          {summary.shields === null ? (
            <Line label="Щити">немає</Line>
          ) : (
            <Line label="Щити">
              <b>{max.shields}</b> · регенерація {max.regeneration} за хід · зараз {left.shields}
              {summary.shields.capacity !== '' && (
                <small> · множник ємності з книги {summary.shields.capacity} — максимум уже порахований із ним</small>
              )}
            </Line>
          )}
          <Line label="КБ"><b>{summary.armorClass}</b></Line>
          <Line label="Зменшення шкоди"><b>{summary.damageReduction}</b></Line>
        </section>

        <section className="s-block">
          <h2>Характеристики й сейви</h2>
          <table className="s-abilities">
            <thead>
              <tr>
                <th />
                {ABILITIES.map((a) => <th key={a.key}>{a.short}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>значення</th>
                {ABILITIES.map((a) => <td key={a.key}>{summary.abilities[a.key]?.score ?? '—'}</td>)}
              </tr>
              <tr>
                <th>модифікатор</th>
                {ABILITIES.map((a) => <td key={a.key}>{signed(summary.abilities[a.key]?.modifier ?? 0)}</td>)}
              </tr>
              <tr className="s-saves">
                <th>сейв</th>
                {ABILITIES.map((a) => (
                  <td key={a.key} className={summary.savingThrows[a.key]?.proficient === true ? 'proficient' : undefined}>
                    {signed(summary.savingThrows[a.key]?.modifier ?? 0)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          {ABILITIES.some((a) => summary.savingThrows[a.key]?.proficient === true) ? (
            <p className="s-legend">● — володіння сейвом від тіра корабля</p>
          ) : (
            <p className="s-legend">Володінь сейвами немає: їх дає тір корабля, а він нульовий.</p>
          )}
        </section>

        <section className="s-block">
          <h2>Рух</h2>
          <Line label="Швидкість">{summary.speed === null ? '—' : feet(summary.speed)}</Line>
          <Line label="Поворотність">{summary.turning === null ? '—' : feet(summary.turning)}</Line>
        </section>

        <section className="s-block">
          <h2>Живлення</h2>
          <Line label="Кубик">{summary.power.die}</Line>
          <Line label="Відновлення за хід">{summary.power.recovery}</Line>
          <Line label="Центральний запас">{summary.power.central}</Line>
          <Line label="На кожну систему">{summary.power.perSystem}</Line>
        </section>

        <section className="s-block s-wide">
          <h2>Зброя</h2>
          {summary.weapons.length === 0 ? (
            <p className="s-line">Зброї в листі немає.</p>
          ) : (
            <table className="s-weapons">
              <thead>
                <tr><th>Зброя</th><th>Влучання</th><th>Шкода</th><th>Установка</th><th>Дистанція</th><th>Властивості</th></tr>
              </thead>
              <tbody>
                {summary.weapons.map((w) => (
                  <tr key={`${w.name}-${w.mounting}`}>
                    <td>{w.name}</td>
                    <td>{signed(summary.weaponAbilityModifier)}</td>
                    <td>{w.damage} {term('damage', w.damageType)}</td>
                    <td>{w.mounting}{w.turret ? ' · турель' : ''}</td>
                    <td>{w.range === null ? '—' : `${w.range.normal}/${w.range.long}`}</td>
                    <td className="s-props">{w.properties.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="s-legend">
            Влучання — від екіпажу на станції, а не від корабля: це те саме число, яким кидає навідник.
            Корабельні назви тут англійською, як у книзі: глосарій їх поки не знає (F-091).
          </p>
        </section>

        <section className="s-block">
          <h2>Місткість</h2>
          <Line label="Трюм">{summary.cargoTons === null ? '—' : `${summary.cargoTons} т`}</Line>
          <Line label="Паливо">
            {summary.fuelCapacity === null ? '—' : <>{summary.fuelCapacity} · зараз {left.fuel}</>}
          </Line>
          <Line label="Мінімальний екіпаж">{summary.minimumCrew === null ? '—' : summary.minimumCrew}</Line>
          <Line label="Сюїти">
            {summary.suites.used} з {summary.suites.max}
            {summary.suites.capacity === null ? '' : ` · селять ${summary.suites.capacity}`}
          </Line>
          <Line label="Слоти модифікацій">
            зайнято {summary.modificationSlots.used}, вільно {Math.max(0, summary.modificationSlots.max - summary.modificationSlots.used)} з {summary.modificationSlots.max}
          </Line>
        </section>

        <section className="s-block s-wide">
          <h2>Екіпаж і станції</h2>
          {summary.crew.length === 0 ? (
            <p className="s-line">У листі корабля екіпаж не розставлений.</p>
          ) : (
            <ul className="s-crew">
              {summary.crew.map((c) => {
                const own = (deployments[c.character] ?? []).find((d) => d.deployment === c.deployment)
                  ?? (deployments[c.character] ?? [])[0];
                const tired = typeof party[c.character]?.exhaustion === 'number' ? (party[c.character]?.exhaustion as number) : 0;
                return (
                  <li key={c.character}>
                    <b>{name(c.character)}</b> — {c.deployment}
                    {own === undefined ? (
                      <small> · листа посади немає</small>
                    ) : (
                      <>
                        <small> · ранг {own.rank}{own.specialty ? ' · спеціальність' : ''}</small>
                        {own.techniques.length > 0 && (
                          <div className="s-crew-line">
                            Прийоми: {own.techniques.join(' · ')}
                          </div>
                        )}
                        {own.ventures.length > 0 && (
                          <div className="s-crew-line">
                            Авантюри: {own.ventures.join(' · ')}
                          </div>
                        )}
                        <div className="s-crew-line s-quiet">
                          На ранзі {own.rank} книга дає прийомів {own.allowed.techniques}, авантюр {own.allowed.ventures}.
                        </div>
                      </>
                    )}
                    {tired > 0 && <small className="s-alarm"> · виснаження {tired}</small>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {(summary.warnings.length > 0 || problems.length > 0) && (
        <section className="s-block s-wide s-warnings">
          <h2>Застереження рушія</h2>
          <ul>
            {[...summary.warnings, ...problems].map((w) => <li key={w}>{w}</li>)}
          </ul>
        </section>
      )}

      <footer className="s-foot">
        <p>
          <b>На момент друку:</b> корпус {left.hull}/{max.hull}
          {summary.shields === null ? '' : ` · щити ${left.shields}/${max.shields}`}
          {summary.fuelCapacity === null ? '' : ` · паливо ${left.fuel}/${summary.fuelCapacity}`}
          {(state.conditions ?? []).length > 0 ? ` · ${(state.conditions ?? []).join(', ')}` : ''}
          {(state.systemDamage ?? 0) > 0 ? ` · пошкодження систем ${state.systemDamage ?? 0}` : ''}
        </p>
        <p className="s-legend">
          Надруковано {printedAt.toLocaleDateString('uk-UA')} · сесія {String(session).padStart(2, '0')} · числа
          рахує рушій Holotable з листа в `state/ships/` і правил книги
        </p>
      </footer>
    </article>
  );
}

/** The page: every ship the owner's folder holds, newest state, ready for paper. */
export function ShipSheetPage(): JSX.Element {
  const [data, setData] = useState<PrintData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const only = new URLSearchParams(location.search).get('ship');

  useEffect(() => {
    fetch('/sheets.json')
      .then((r) => (r.ok ? (r.json() as Promise<PrintData>) : Promise.reject(new Error(`сервер відповів ${r.status}`))))
      .then(setData)
      .catch((e: unknown) => setError(String((e as Error).message ?? e)));
  }, []);

  if (error !== null) return <p className="print-message">Не вдалося взяти лист корабля в сервера: {error}</p>;
  if (data === null) return <p className="print-message">Беру лист корабля в сервера…</p>;
  const ships = data.ships ?? {};
  const slugs = Object.keys(ships).filter((s) => only === null || s === only);
  if (slugs.length === 0) {
    return <p className="print-message">У `state/ships/` немає жодного листа корабля — покласти його туди може лише власник.</p>;
  }
  return (
    <div className="print-root s-root">
      <div className="print-toolbar">
        <button type="button" onClick={() => window.print()}>Друкувати</button>
        <span>
          {slugs.length === 1 ? 'Один аркуш' : `${slugs.length} аркушів`} A4: лист корабля з числами рушія.
          У вікні друку — «Зберегти як PDF».
        </span>
      </div>
      {slugs.map((slug) => (
        <ShipSheet
          key={slug}
          summary={(ships[slug] as { summary: ShipSummary }).summary}
          state={(ships[slug] as { state: ShipState }).state}
          deployments={data.deployments ?? {}}
          party={data.characters}
          glossary={data.glossary}
          mode={readMode()}
          session={data.session}
          printedAt={new Date()}
          problems={data.shipProblems ?? []}
        />
      ))}
    </div>
  );
}
