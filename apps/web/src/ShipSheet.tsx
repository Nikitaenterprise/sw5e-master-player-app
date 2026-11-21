// The ship's sheet (F-031): every number of «Мандрівна Зоря» in one place. /?as=ship
//
// Until now the ship lived in a PowerPoint slide and, since F-060, in the GM's panel —
// which shows what is happening (hull, shields, power) but not what the ship IS. This
// page is the other half: the sheet, the way F-030 is the sheet for a character.
//
// Same rules as the paper sheets: one HTTP request, the engine's numbers (ADR 0003),
// no socket and no place at the table. The markup is print-ready; the six station cards
// (F-032) are printed from this page too, after the sheet, and F-062 adds the button on
// the GM's screen that opens it.
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import {
  DEPLOYMENTS,
  showTerm,
  shipMaxima,
  type CharacterState,
  type DeploymentSummary,
  type PrintData,
  type ShipState,
  type ShipSummary,
  type SheetSummary,
  type RoleCard,
  type TermKind,
  type TermMode,
} from '@holotable/protocol';
import { name } from './characters.js';
import { feet } from './Print.js';
import { readMode } from './terms.js';
import { RoleCards } from './RoleCards.js';

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
  sheets = {},
  party,
  glossary,
  mode,
  session,
  printedAt,
  problems = [],
}: {
  summary: ShipSummary;
  state: ShipState;
  /** The party's computed sheets: a station's roll adds the bonus of whoever mans it. */
  sheets?: Record<string, SheetSummary>;
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
  // The attack number of a ship weapon is the ship's Wisdom plus the proficiency bonus
  // of the gunner at the station (SotG; docs/ЗВІРКА-КОРАБЛЯ.md says the paper sheet got
  // this wrong by writing the ship's half alone). With the station free there is no full
  // number to write, and the sheet says so instead of printing half of one.
  const gunnerSeat = summary.crew.find((c) => c.deployment === 'Gunner');
  const gunnerBonus = gunnerSeat === undefined ? null : sheets[gunnerSeat.character]?.proficiencyBonus ?? null;
  const gun = {
    who: gunnerSeat === undefined ? null : sheets[gunnerSeat.character]?.name ?? gunnerSeat.character,
    bonus: gunnerBonus,
    total: gunnerBonus === null ? null : summary.weaponAbilityModifier + gunnerBonus,
  };
  // System damage of 4 or more halves the maxima (the book's table). The sheet shows
  // what the ship IS, so a halved number must say why it is halved.
  const halved = max.hull < summary.hull.max;
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
          {halved && (
            <p className="s-line s-alarm">
              Пошкодження систем {state.systemDamage ?? 0}: максимуми корпусу, щитів і регенерації тут
              <b> різані навпіл</b>, як велить книга. Паспортні числа корабля — удвічі більші.
            </p>
          )}
          <Line label="Корпус">
            <b>{max.hull}</b> ({summary.hull.dice.count}{summary.hull.dice.size}
            {halved ? ', повний корпус' : ''}
            {halved ? ` ${summary.hull.max}` : ''}) · зараз {left.hull}
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
          <p className="s-legend">
            Це <b>частка корабля</b>. Сейв кидає той, хто за станцією, і додає до цього числа свій бонус
            майстерності — за книгою корабельний сейв складається з обох.
            {ABILITIES.some((a) => summary.savingThrows[a.key]?.proficient === true)
              ? ' ● — володіння сейвом, як вписано в лист корабля.'
              : ' Володінь сейвами в листі корабля не вписано.'}
          </p>
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
                <tr><th>Зброя</th><th>Влучання</th><th>Шкода</th><th>Кріплення</th><th>Дистанція</th><th>Властивості</th></tr>
              </thead>
              <tbody>
                {summary.weapons.map((w, i) => (
                  <tr key={`${w.name}-${i}`}>
                    <td>{w.name}</td>
                    <td>{gun.total === null ? `${signed(summary.weaponAbilityModifier)} + ?` : signed(gun.total)}</td>
                    <td>{w.damage} {term('damage', w.damageType)}</td>
                    <td>{w.turret ? 'турельна' : 'нерухома'} · {w.mounting}</td>
                    <td>{w.range === null ? '—' : `${w.range.normal}/${w.range.long}`}</td>
                    <td className="s-props">{w.properties.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="s-legend">
            {gun.total === null ? (
              <>
                Влучання: Мудрість корабля {signed(summary.weaponAbilityModifier)} <b>плюс бонус майстерності
                того, хто стане до гармати</b>. Поки станція Gunner вільна, повного числа немає — тому тут «+ ?».
              </>
            ) : (
              <>
                Влучання {signed(gun.total)} = Мудрість корабля {signed(summary.weaponAbilityModifier)} + бонус
                майстерності навідника ({gun.who} {signed(gun.bonus as number)}). Стане інший — число інше.
              </>
            )}
            {' '}Корабельні назви тут англійською, як у книзі: глосарій їх поки не знає (F-091).
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
                const sheetsOf = deployments[c.character] ?? [];
                const own = sheetsOf.find((d) => d.deployment === c.deployment);
                // A sheet about another station is not this station's sheet: taking the
                // first one at hand would print someone else's rank under this station.
                const elsewhere = own === undefined ? sheetsOf.map((d) => d.deployment) : [];
                const tired = typeof party[c.character]?.exhaustion === 'number' ? (party[c.character]?.exhaustion as number) : 0;
                return (
                  <li key={c.character}>
                    <b>{name(c.character)}</b> — {c.deployment}
                    {own === undefined ? (
                      elsewhere.length === 0
                        ? <small> · листа посади немає</small>
                        : <small className="s-alarm"> · листа посади на цю станцію немає (у листі: {elsewhere.join(', ')})</small>
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

/**
 * What the page hands to each sheet, taken out of one server answer. A pure function on
 * purpose: the wiring from `/sheets.json` to the sheet is the half a render test cannot
 * see, and the independent review of F-031 found exactly that half untested — a page
 * that passed no deployments and no problems went green. Now it cannot.
 */
export interface ShipSheetProps {
  slug: string;
  summary: ShipSummary;
  state: ShipState;
  sheets: Record<string, SheetSummary>;
  deployments: Record<string, DeploymentSummary[]>;
  party: Record<string, CharacterState>;
  glossary: Record<string, string>;
  session: number;
  problems: string[];
}

export function shipSheetsFrom(data: PrintData, only: string | null = null): ShipSheetProps[] {
  const ships = data.ships ?? {};
  return Object.keys(ships)
    .filter((slug) => only === null || slug === only)
    .map((slug) => ({
      slug,
      summary: (ships[slug] as { summary: ShipSummary }).summary,
      state: (ships[slug] as { state: ShipState }).state,
      sheets: data.sheets,
      deployments: data.deployments ?? {},
      party: data.characters,
      glossary: data.glossary,
      session: data.session,
      problems: data.shipProblems ?? [],
    }));
}

/**
 * The GM's buttons for the printer (F-062). Opening a page rather than printing from
 * here on purpose: the GM sees on paper's own page what is about to come out, and the
 * browser's print dialog is one click away. Each link is an address `printPlan` knows.
 */
export function ShipPrintLinks({ stations = [...DEPLOYMENTS] }: { stations?: string[] } = {}): JSX.Element {
  return (
    <div className="buttons">
      <a className="button-like" href="/?as=ship" target="_blank" rel="noreferrer">
        Роздрукувати корабель
        <small>лист корабля й шість карток станцій, по одній на аркуш</small>
      </a>
      <a className="button-like" href="/?as=ship&what=sheet" target="_blank" rel="noreferrer">
        Лише лист корабля
        <small>один аркуш A4 із числами рушія</small>
      </a>
      <a className="button-like" href="/?as=ship&what=cards" target="_blank" rel="noreferrer">
        Лише картки станцій
        <small>шість аркушів — роздати тим, хто сів на станції</small>
      </a>
      {stations.length > 0 && (
        <p className="hint">
          Одна картка:{' '}
          {stations.map((station, i) => (
            <span key={station}>
              {i > 0 && ' · '}
              <a href={`/?as=ship&card=${encodeURIComponent(station)}`} target="_blank" rel="noreferrer">{station}</a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * What to print, worked out from the address (F-062). The GM's screen has a button for
 * each case, so the page itself never has to guess:
 *   `?as=ship`                  — the ship's sheet and all six station cards,
 *   `?as=ship&what=sheet`       — the sheet alone,
 *   `?as=ship&what=cards`       — the six cards alone,
 *   `?as=ship&card=Pilot`       — one card, for the player who took that station,
 *   `?ship=<slug>`              — one ship, when the party has more than one.
 * A station nobody has heard of is said out loud rather than printing nothing: an empty
 * page in the print dialog looks like a broken app, and it is not.
 */
export interface PrintPlan {
  sheets: ShipSheetProps[];
  cards: RoleCard[];
  /** What the toolbar says is about to come out of the printer. */
  text: string;
  /** What is wrong with the address itself, in words. */
  problem: string | null;
}

export function printPlan(data: PrintData, search: string): PrintPlan {
  const params = new URLSearchParams(search);
  const only = params.get('ship');
  const what = params.get('what');
  const card = params.get('card');
  const everySheet = shipSheetsFrom(data, only);
  const everyCard = data.roles ?? [];

  if (card !== null) {
    const wanted = everyCard.filter((c) => c.deployment.toLowerCase() === card.trim().toLowerCase());
    if (wanted.length === 0) {
      return {
        sheets: [], cards: [], text: '',
        problem: `станції «${card}» немає: є ${everyCard.map((c) => c.deployment).join(', ') || 'жодної'}`,
      };
    }
    const who = wanted[0]?.name;
    return {
      sheets: [], cards: wanted,
      text: `Один аркуш A4: картка станції ${wanted[0]?.deployment}${who === undefined ? '' : ` (${who})`}.`,
      problem: null,
    };
  }
  if (what === 'cards') {
    return {
      sheets: [], cards: everyCard,
      text: `${everyCard.length} карток станцій — по одній на аркуш A4.`,
      problem: null,
    };
  }
  if (what === 'sheet') {
    return {
      sheets: everySheet, cards: [],
      text: `${everySheet.length === 1 ? 'Один аркуш' : `${everySheet.length} аркушів`} A4: лист корабля з числами рушія.`,
      problem: null,
    };
  }
  return {
    sheets: everySheet, cards: everyCard,
    text: `${everySheet.length === 1 ? 'Один аркуш' : `${everySheet.length} аркушів`} A4: лист корабля з числами рушія`
      + (everyCard.length > 0 ? `, далі ${everyCard.length} карток станцій — по одній на аркуш.` : '.'),
    problem: null,
  };
}

/** The page: every ship the owner's folder holds, newest state, ready for paper. */
export function ShipSheetPage(): JSX.Element {
  const [data, setData] = useState<PrintData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/sheets.json')
      .then((r) => (r.ok ? (r.json() as Promise<PrintData>) : Promise.reject(new Error(`сервер відповів ${r.status}`))))
      .then(setData)
      .catch((e: unknown) => setError(String((e as Error).message ?? e)));
  }, []);

  if (error !== null) return <p className="print-message">Не вдалося взяти лист корабля в сервера: {error}</p>;
  if (data === null) return <p className="print-message">Беру лист корабля в сервера…</p>;
  const plan = printPlan(data, location.search);
  if (plan.problem !== null) return <p className="print-message">{plan.problem}</p>;
  if (plan.sheets.length === 0 && plan.cards.length === 0) {
    return <p className="print-message">У `state/ships/` немає жодного листа корабля — покласти його туди може лише власник.</p>;
  }
  return (
    <div className="print-root s-root">
      <div className="print-toolbar">
        <button type="button" onClick={() => window.print()}>Друкувати</button>
        <span>{plan.text} У вікні друку — «Зберегти як PDF».</span>
      </div>
      {plan.sheets.map((one) => (
        <ShipSheet
          key={one.slug}
          summary={one.summary}
          state={one.state}
          sheets={one.sheets}
          deployments={one.deployments}
          party={one.party}
          glossary={one.glossary}
          mode={readMode()}
          session={one.session}
          printedAt={new Date()}
          problems={one.problems}
        />
      ))}
      {plan.cards.length > 0 && <RoleCards cards={plan.cards} actions={data.shipActions ?? []} />}
    </div>
  );
}
