import { useContext, useEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react';
import type { CharacterState, CombatState, CompanionSummary, FeatureEffectSummary, HolotableEffect, HomebrewItem, FightSummary, Fighter, GameEvent, LastAttack, NpcNote, NpcUndo, SessionClosed, SheetSummary, StateValue, WhoCounts } from '@holotable/protocol';
import {
  connect,
  roleFromUrl,
  withQueued,
  queuedFields,
  baseFor,
  EMPTY,
  type Snapshot,
  type Controls,
} from './connection.js';
import { name, LABELS } from './characters.js';
import { spendHitDie, rollHint } from './hitDice.js';
import { explanationText } from './explain.js';
import { usedOf, showTerm, termUrl, effectText, effectTargetText, untilText, itemsLeft, weaponTarget, EFFECT_TARGETS, ENEMY_EFFECT_TARGETS, UNTIL_TEXT, exhaustionEffects, turnsUntil, initiativeOf, deathSavesOf, DEATH_SAVES_LIMIT, checkInitiativeRoll, checkDeclaredTotal, whoCounts, INITIATIVE_DIE, type TermMode } from '@holotable/protocol';
import { BriefContext, ExhaustionContext, TermContext, TermLink, useBrief, useTerm, readMode, saveMode, MODE_LABELS, type Term } from './terms.js';
import { NpcDesk, NpcsInScene } from './Npcs.js';
import { GlossaryEditor } from './GlossaryEditor.js';
import { ItemsEditor } from './ItemsEditor.js';
import { HandoutDesk, Handouts } from './Handouts.js';
import {
  collapse, valueText, authorText, subjectText, undoOf, undoNote, whenText, isMismatch, type FeedRow,
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
  const view = gm ? new URLSearchParams(location.search).get('view') : null;
  // The item editor (F-068) is one more GM view; everything below that is not the master
  // screen treats it like the glossary.
  const editingItems = view === 'items';
  const editingGlossary = view === 'glossary' || editingItems;
  const header = editingItems ? 'Хомбрю-предмети' : editingGlossary ? 'Глосарій' : gm ? 'Екран майстра' : name(character);
  const [mode, setMode] = useState<TermMode>(readMode);
  const term: Term = (kind, english) => showTerm(snapshot.glossary, mode, kind, english);
  // The book's conditions, for the GM's picker (F-056). Exhaustion has its own levels.
  const conditionChoices = snapshot.glossaryIndex
    .filter((r) => r.kind === 'condition' && r.english !== 'Exhaustion')
    .map((r) => r.english)
    .sort((a, b) => a.localeCompare(b));

  return (
    <TermContext.Provider value={term}>
    <BriefContext.Provider value={snapshot.briefs}>
    <ExhaustionContext.Provider value={snapshot.exhaustionLevels}>
    <main className={gm ? 'gm' : 'player'}>
      <header>
        <h1>{header}</h1>
        <Indicator snapshot={snapshot} />
        <ModeSwitch
          mode={mode}
          change={(m) => {
            setMode(m);
            saveMode(m);
          }}
        />
      </header>

      {snapshot.demo && <DemoBanner />}

      {snapshot.refusal !== null && <p className="refusal">{snapshot.refusal}</p>}

      {gm && (
        <nav className="views">
          {editingGlossary ? (
            <a href="/?as=gm">← до екрана майстра</a>
          ) : (
            <>
              <a href="/?as=gm&view=glossary">Глосарій термінів →</a>
              <a href="/?as=gm&view=items">Предмети →</a>
            </>
          )}
          <a href="/?as=ref" target="_blank" rel="noreferrer">Довідник →</a>
        </nav>
      )}

      {gm && !editingGlossary && (
        <CombatBoard
          combat={snapshot.combat}
          start={() => controls.current?.startCombat()}
          roll={(whom, value, said) => controls.current?.rollInitiative(whom, value, said)}
          move={(direction) => controls.current?.advanceTurn(direction)}
          end={(clear) => controls.current?.endCombat(clear)}
          party={snapshot.characters}
          rest={(kind) => controls.current?.sendRest(kind)}
          addEnemies={(monster, count, hp) => controls.current?.addEnemies(monster, count, hp)}
          damageEnemy={(enemy, amount) => controls.current?.damageEnemy(enemy, amount)}
          removeEnemy={(enemy) => controls.current?.removeEnemy(enemy)}
          setEnemyConditions={(enemy, list) => controls.current?.setEnemyConditions(enemy, list)}
          setEnemyEffects={(enemy, list) => controls.current?.setEnemyEffects(enemy, list)}
          conditionChoices={conditionChoices}
        />
      )}

      {editingItems ? (
        <ItemsEditor
          items={snapshot.homebrewFile}
          candidates={snapshot.homebrewCandidates}
          problems={snapshot.homebrewProblems}
          save={(itemName, def) => controls.current?.setHomebrewItem(itemName, def)}
          demo={snapshot.demo}
        />
      ) : editingGlossary ? (
        <GlossaryEditor
          rows={snapshot.glossaryIndex}
          glossary={snapshot.glossary}
          save={(key, value) => controls.current?.setTerm(key, value)}
          demo={snapshot.demo}
          found={snapshot.glossaryFound}
          searchAll={(q) => controls.current?.searchTerms(q)}
        />
      ) : gm ? (
        <section>
          <h2>Партія — {Object.keys(snapshot.characters).length}</h2>
          {snapshot.homebrewProblems.map((p) => (
            <p key={p} className="refusal">{p}</p>
          ))}
          <div className="cards">
            {Object.entries(snapshot.characters)
              .sort(([a], [b]) => name(a).localeCompare(name(b), 'uk'))
              .map(([slug, state]) => (
                <Card
                  key={slug}
                  slug={slug}
                  state={state}
                  sheet={snapshot.sheets[slug]}
                  conditionChoices={conditionChoices}
                  setConditions={(list) => controls.current?.sendChange(slug, { conditions: list })}
                  {...companionOf(snapshot, slug, (c, changes) => controls.current?.sendChange(c, changes))}
                  setEffects={(list) => controls.current?.sendChange(slug, { holotableEffects: list })}
                  items={snapshot.homebrew[slug] ?? []}
                  useItem={(item) => controls.current?.useItem(slug, item.name, false)}
                  useFeature={(feature, allies) => controls.current?.useFeature(slug, feature, allies)}
                  party={Object.keys(snapshot.characters)}
                />
              ))}
          </div>
        </section>
      ) : (
        <PlayerSheet character={character} snapshot={snapshot} controls={controls} />
      )}

      {gm && !editingGlossary && (
        <HandoutDesk
          party={Object.keys(snapshot.characters).sort((a, b) => name(a).localeCompare(name(b), 'uk'))}
          handouts={snapshot.handouts}
          send={(title, text, to) => controls.current?.sendHandout(title, text, to)}
        />
      )}

      {gm && !editingGlossary && (
        <NpcDesk
          npcs={snapshot.npcs}
          set={(npc, base) => controls.current?.setNpc(npc, base)}
          remove={(id) => controls.current?.removeNpc(id)}
          clear={() => controls.current?.clearNpcs()}
        />
      )}

      {gm && !editingGlossary && (
        <CountsSwitch
          characters={Object.keys(snapshot.characters).sort((a, b) => name(a).localeCompare(name(b), 'uk'))}
          counts={snapshot.counts}
          set={(slug, who) => controls.current?.setCounts(slug, who)}
        />
      )}

      {gm && !editingGlossary && <Rests rest={(kind) => controls.current?.sendRest(kind)} />}

      {gm && !editingGlossary && (
        <section className="rests">
          <h2>Друк</h2>
          <div className="buttons">
            <a className="button-like" href="/?as=print" target="_blank" rel="noreferrer">
              Роздрукувати всіх
              <small>пʼять аркушів A4 українською; якщо ноутбук вимкнеться — гра йде на папері</small>
            </a>
          </div>
        </section>
      )}

      {gm && !editingGlossary && (
        <Session
          session={snapshot.session}
          lastClosed={snapshot.lastClosed}
          close={() => controls.current?.closeSession()}
        />
      )}

      {gm && !editingGlossary && (
        <Feed
          events={snapshot.events}
          fights={snapshot.fights}
          npcNotes={snapshot.npcNotes}
          undoNpc={(undo) => controls.current?.undoNpc(undo)}
          undo={(row) =>
            // Relative to where the run ended: undo takes back THIS change, and what
            // others did since stays (F-045).
            controls.current?.sendChange(row.character, undoOf(row), undoNote(row), { [row.field]: row.to })
          }
        />
      )}

      {!gm && (
        <nav className="views">
          <a href="/?as=ref">Довідник: сили, предмети, правила →</a>
        </nav>
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
        Фаза 4 · F-064. Кубик кидає гравець і сам додає свої модифікатори (ADR 0007); застосунок рахує своє число для звірки й показує майстрові обидва. Наведи на число — побачиш, з чого воно складається; ✎ — ручна правка. Терміни — з глосарію state/i18n/uk/terms.json. Числа на карточках рахує рушій при старті сервера, на диску
        їх немає (ADR 0003). Відкат — не стирання: це така сама зміна, дописана
        в журнал (ADR 0002).
      </footer>
    </main>
    </ExhaustionContext.Provider>
    </BriefContext.Provider>
    </TermContext.Provider>
  );
}

/** Ukrainian and English side by side, or one of them (F-025). Per viewer. */
function ModeSwitch({ mode, change }: { mode: TermMode; change: (m: TermMode) => void }): JSX.Element {
  return (
    <div className="mode-switch" role="group" aria-label="Мова термінів">
      {(Object.keys(MODE_LABELS) as TermMode[]).map((m) => (
        <button key={m} type="button" className={m === mode ? 'on' : undefined} onClick={() => change(m)}>
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

function PlayerSheet({
  character,
  snapshot,
  controls,
}: {
  character: string | undefined;
  snapshot: Snapshot;
  controls: RefObject<Controls | null>;
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
  // What the player sees includes what they pressed and the server has not confirmed
  // yet (F-046) — with no wifi the number still moves, marked as not sent.
  const state = withQueued(snapshot.characters[character], snapshot.queued, character);
  const waiting = queuedFields(snapshot.queued, character);
  if (state === undefined) {
    return (
      <section>
        <p className="hint">Чекаю стан від сервера…</p>
      </section>
    );
  }
  // The base is the very state this render computed the new number from — not whatever
  // the connection holds by the time the click lands — so taps faster than a re-render
  // each count once.
  const sendChange = (changes: CharacterState): void => {
    controls.current?.sendChange(character, changes, undefined, baseFor(state, changes));
  };
  const sheet = snapshot.sheets[character];

  return (
    <section>
      <Handouts handouts={snapshot.handouts} />
      <NpcsInScene npcs={snapshot.npcs} />
      <h2>Мій стан</h2>
      {sheet !== undefined && sheet.maxHitPoints - (typeof state.hitPointsLost === 'number' ? state.hitPointsLost : 0) <= 0 && (
        <DeathSavesBlock
          state={state}
          counts={whoCounts(snapshot.counts, character)}
          roll={(value, said) => controls.current?.deathSave(character, value, said)}
        />
      )}
      <Managed state={state} waiting={waiting} sendChange={sendChange} />
      <Effects
        list={(Array.isArray(state.holotableEffects) ? state.holotableEffects : []) as HolotableEffect[]}
        items={snapshot.homebrew[character] ?? []}
        {...(state.holotableItemsUsed === undefined ? {} : { used: state.holotableItemsUsed })}
        use={(item) => controls.current?.useItem(character, item.name, true)}
      />
      {(() => {
        const mine = companionOf(snapshot, character, (c, changes) => controls.current?.sendChange(c, changes)).companion;
        return mine === undefined ? null : <CompanionBlock {...mine} />;
      })()}
      {snapshot.combat !== null && snapshot.combat.turn === character && sheet !== undefined && (
        <MyTurn
          combat={snapshot.combat}
          character={character}
          sheet={sheet}
          state={state}
          counts={whoCounts(snapshot.counts, character)}
          attack={(weapon, value, said) => controls.current?.attackRoll(character, weapon, value, said)}
          spend={(field) => sendChange({ [field]: (typeof state[field] === 'number' ? (state[field] as number) : 0) + 1 })}
          done={() => controls.current?.turnDone()}
          {...(Object.values(snapshot.companions).some((c) => c.owner === character) ? { companionRules: snapshot.companionRules } : {})}
        />
      )}
      {snapshot.combat !== null && (
        <MyInitiative
          combat={snapshot.combat}
          character={character}
          counts={whoCounts(snapshot.counts, character)}
          roll={(value, said, whom) => controls.current?.rollInitiative(whom ?? character, value, said)}
        />
      )}
      {sheet !== undefined && sheet.hitDice.length > 0 && (
        <HitDice
          state={state}
          dice={sheet.hitDice}
          constitutionModifier={sheet.abilityModifiers['Constitution'] ?? 0}
          counts={whoCounts(snapshot.counts, character)}
          send={(changes, note) => controls.current?.sendChange(character, changes, note, baseFor(state, changes))}
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

export function Managed({
  state,
  waiting = new Set(),
  sendChange,
}: {
  state: CharacterState;
  /** Fields with a change the server has not confirmed yet. */
  waiting?: Set<string>;
  sendChange: (changes: CharacterState) => void;
}): JSX.Element {
  const [fresh, setFresh] = useState('');
  const term = useTerm();
  const conditions = (Array.isArray(state.conditions) ? state.conditions : []) as string[];

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
          <div key={field} className={`state-row${waiting.has(field) ? ' waiting' : ''}`}>
            <span className="label">{LABELS[field]}</span>
            <b className="value" title={waiting.has(field) ? 'ще не надіслано' : undefined}>{now}</b>
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

      <ExhaustionLine level={typeof state.exhaustion === 'number' ? state.exhaustion : 0} />

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
            <span key={u} className="chip-pair">
              <button
                type="button"
                className="chip"
                onClick={() => sendChange({ conditions: conditions.filter((i) => i !== u) })}
              >
                {term('condition', u)} <span aria-hidden="true">×</span>
              </button>
              <ConditionHelp name={u} />
              <ConditionEffect name={u} />
            </span>
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
  counts = 'app',
  send,
}: {
  state: CharacterState;
  dice: { size: string; count: number }[];
  constitutionModifier: number;
  /** Who adds Constitution: the person or the app (F-064, ADR 0007). */
  counts?: WhoCounts;
  send: (changes: CharacterState, note?: string) => void;
}): JSX.Element {
  const [rolling, setRolling] = useState<string | null>(null);
  const [roll, setRoll] = useState('');
  const [healed, setHealed] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const counted = counts === 'player';

  const submit = (size: string, count: number): void => {
    if (counted && healed.trim() === '') {
      setProblem('впиши, скільки вилікував');
      return;
    }
    const result = spendHitDie(
      state, size, count, Number(roll), constitutionModifier,
      counted ? Number(healed) : undefined,
    );
    if (typeof result === 'string') {
      setProblem(result);
      return;
    }
    send(result.changes, result.note);
    setRolling(null);
    setRoll('');
    setHealed('');
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
                <span className="hint">{rollHint(size, constitutionModifier, counted)}</span>
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
                {counted && (
                  <input
                    type="number"
                    inputMode="numeric"
                    value={healed}
                    onChange={(ev) => setHealed(ev.target.value)}
                    aria-label="Скільки вилікував"
                    placeholder="вилікував"
                  />
                )}
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

/** The "?" next to a condition: the rule's text on hover, the rule itself on tap. */
function ConditionHelp({ name }: { name: string }): JSX.Element {
  const brief = useBrief('condition', name);
  return (
    <a className="chip-help" href={termUrl('condition', name)} aria-label={`Що таке «${name}»`} {...(brief === undefined ? {} : { title: brief })}>
      ?
    </a>
  );
}

/**
 * The d20 input. The app never rolls: the die is thrown at the table and the person
 * types what came up. The same check runs here and on the server, so a refusal is seen
 * before the message leaves the phone.
 */
function RollInput({
  label,
  sum,
  submit,
  button = 'ініціатива',
}: {
  /** What the submit button says. */
  button?: string;
  label: string;
  /** The second field — the sum the person worked out themselves (ADR 0007). */
  sum: 'none' | 'optional' | 'required';
  submit: (roll: number, said?: number) => void;
}): JSX.Element {
  const [die, setDie] = useState('');
  const [total, setTotal] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      className="add roll"
      onSubmit={(ev) => {
        ev.preventDefault();
        const value = die.trim() === '' ? Number.NaN : Number(die);
        const trouble = checkInitiativeRoll(value);
        if (trouble !== null) {
          setProblem(trouble);
          return;
        }
        let said: number | undefined;
        if (sum !== 'none' && total.trim() !== '') {
          said = Number(total);
          const bad = checkDeclaredTotal(said);
          if (bad !== null) {
            setProblem(bad);
            return;
          }
        } else if (sum === 'required') {
          setProblem('впиши, скільки вийшло разом');
          return;
        }
        submit(value, said);
        setDie('');
        setTotal('');
        setProblem(null);
      }}
    >
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={INITIATIVE_DIE}
        value={die}
        onChange={(ev) => setDie(ev.target.value)}
        aria-label={label}
        placeholder={`d${INITIATIVE_DIE}`}
      />
      {sum !== 'none' && (
        <input
          type="number"
          inputMode="numeric"
          value={total}
          onChange={(ev) => setTotal(ev.target.value)}
          aria-label="Скільки вийшло разом"
          placeholder="разом"
        />
      )}
      <button type="submit">{button}</button>
      {problem !== null && <span className="refusal">{problem}</span>}
    </form>
  );
}

/**
 * Conditions on someone, as the GM edits them (F-056): each a link into the reference
 * with the book's text on hover, a × to take it off, and the book's list to put one on.
 * The same for a party member and an enemy — the list goes wherever `set` sends it.
 */
export function Conditions({
  list,
  choices,
  set,
}: {
  list: string[];
  choices: string[];
  set: (list: string[]) => void;
}): JSX.Element {
  const term = useTerm();
  const free = choices.filter((c) => !list.some((l) => l.toLowerCase() === c.toLowerCase()));
  return (
    <div className="conditions-edit">
      {list.map((c) => (
        <span key={c} className="cond">
          <TermLink kind="condition" english={c}>{term('condition', c)}</TermLink>
          <button type="button" title="зняти" aria-label={`Зняти «${c}»`} onClick={() => set(list.filter((x) => x !== c))}>
            ×
          </button>
        </span>
      ))}
      {free.length > 0 && (
        <select
          value=""
          aria-label="Накласти умову"
          onChange={(e) => {
            if (e.target.value !== '') set([...list, e.target.value]);
          }}
        >
          <option value="">+ умова</option>
          {free.map((c) => (
            <option key={c} value={c}>
              {term('condition', c)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** What the current exhaustion level does — every effect up to it, from the book (F-056). */
export function ExhaustionLine({ level }: { level: number }): JSX.Element | null {
  const table = useContext(ExhaustionContext);
  if (level <= 0) return null;
  const effects = exhaustionEffects(table, level);
  return (
    <p className="exhaustion-line">
      <TermLink kind="condition" english="Exhaustion">Виснаження {level}</TermLink>
      {effects.length > 0 && <>: {effects.join('; ')}</>}
    </p>
  );
}

/** The first line of what a condition does — under the player's chip, so nobody has to ask. */
function ConditionEffect({ name }: { name: string }): JSX.Element | null {
  const brief = useBrief('condition', name);
  if (brief === undefined) return null;
  const first = (brief.split('\n')[0] ?? '').replace(/^•\s*/, '');
  return <small className="cond-effect">{first}</small>;
}

/** The companion of this character, if there is one, as props for its card and phone (F-039). */
export function companionOf(
  snapshot: { companions: Record<string, CompanionSummary>; companionStates: Record<string, CharacterState> },
  owner: string,
  send: (companion: string, changes: CharacterState) => void,
): { companion?: { summary: CompanionSummary; state: CharacterState; change: (changes: CharacterState) => void } } {
  const summary = Object.values(snapshot.companions).find((c) => c.owner === owner);
  if (summary === undefined) return {};
  return {
    companion: {
      summary,
      state: snapshot.companionStates[summary.slug] ?? {},
      change: (changes) => send(summary.slug, changes),
    },
  };
}

/**
 * A companion's hit points and numbers (F-039) — its own creature: "−5" here never
 * touches the owner. Shown on the owner's card in the GM's screen and on the owner's phone.
 */
export function CompanionBlock({
  summary,
  state,
  change,
}: {
  summary: CompanionSummary;
  state: CharacterState;
  change: (changes: CharacterState) => void;
}): JSX.Element {
  const lost = typeof state.hitPointsLost === 'number' ? state.hitPointsLost : 0;
  const left = Math.max(0, summary.maxHitPoints - lost);
  return (
    <div className="companion">
      <p>
        <b>{summary.name}</b> <small>компаньйон</small> · ХП <b className={left === 0 ? 'down' : undefined}>{left}</b>/{summary.maxHitPoints} · КБ {summary.armorClass} · ініц. {signed(summary.initiative)}
      </p>
      <span className="buttons">
        {[-5, -1, 1, 5].map((step) => (
          <button
            key={step}
            type="button"
            title={step < 0 ? `шкода ${-step}` : `лікування ${step}`}
            disabled={(step < 0 && left === 0) || (step > 0 && lost === 0)}
            onClick={() => change({ hitPointsLost: Math.min(summary.maxHitPoints, Math.max(0, lost - step)) })}
          >
            {step > 0 ? `+${step}` : step}
          </button>
        ))}
      </span>
      {summary.attacks.length > 0 && (
        <small className="companion-attacks">{summary.attacks.map((a) => `${a.name} ${signed(a.toHit)}, ${a.damage}`).join(' · ')}</small>
      )}
    </div>
  );
}

/** ▲ advantage, ▼ disadvantage, ▲▼ both (they cancel out by the book) — from active effects. */
function RollMode({ mode }: { mode: 'advantage' | 'disadvantage' | 'both' | undefined }): JSX.Element | null {
  if (mode === undefined) return null;
  const [mark, words] =
    mode === 'advantage' ? ['▲', 'перевага (ефект)'] : mode === 'disadvantage' ? ['▼', 'недолік (ефект)'] : ['▲▼', 'і перевага, і недолік — гасять одне одного'];
  return <i className={`roll-mode ${mode}`} title={words}>{mark}</i>;
}

/**
 * A feature's button in one line: its name once, what each effect gives, and until when
 * — once, when they all end alike.
 */
export function featureLabel(feature: FeatureEffectSummary, skill?: (english: string) => string): string {
  const what = (e: FeatureEffectSummary['effects'][number]): string =>
    `${effectTargetText(e.target, skill)} ${e.bonus !== undefined ? `${e.bonus > 0 ? '+' : ''}${e.bonus}` : e.mode === 'advantage' ? 'перевага' : 'недолік'}`;
  const ends = new Set(feature.effects.map((e) => untilText(e)));
  const [first] = feature.effects;
  if (ends.size === 1 && first !== undefined) return `${feature.feature}: ${feature.effects.map(what).join(', ')} · ${untilText(first)}`;
  return `${feature.feature}: ${feature.effects.map((e) => `${what(e)} · ${untilText(e)}`).join('; ')}`;
}

/**
 * A feature that gives an effect (F-069): one button with the number, the book's
 * sentence on hover, and — when allies get it too — ticks for who is close enough.
 * The app has no map; the GM looks at the table and ticks.
 */
export function FeatureButton({
  feature,
  allies,
  use,
}: {
  feature: FeatureEffectSummary;
  allies: string[];
  use: (allies: string[]) => void;
}): JSX.Element {
  const term = useTerm();
  const skill = (x: string): string => term('skill', x);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const what = featureLabel(feature, skill);
  return (
    <div className="feature-effect">
      <button
        type="button"
        title={feature.sentence}
        onClick={() => (feature.allies ? setOpen(!open) : use([]))}
      >
        {what}
      </button>
      <small className="feature-from"> — {feature.from}</small>
      {open && (
        <div className="feature-allies">
          <small>{feature.sentence}</small>
          <span>Хто поруч:</span>
          {allies.map((a) => (
            <label key={a}>
              <input
                type="checkbox"
                checked={picked.includes(a)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, a] : picked.filter((x) => x !== a))}
              />
              {name(a)}
            </label>
          ))}
          <button
            type="button"
            onClick={() => {
              use(picked);
              setOpen(false);
              setPicked([]);
            }}
          >
            накласти
          </button>
        </div>
      )}
    </div>
  );
}

const effectId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * What an effect may be put on for this character (F-083): the fixed targets, and then
 * the weapons this character carries, by name — so a sight goes onto the rifle rather
 * than onto every attack. Nothing is typed by hand, so no name can be misspelt.
 */
export function effectTargetOptions(weapons: { name: string }[]): string[] {
  return [...EFFECT_TARGETS, ...weapons.map((w) => weaponTarget(w.name))];
}

/**
 * Effects on a character (F-065): what is on them now, and — for the GM — a short form
 * to put one on: where it comes from, what it touches, by how much (or advantage /
 * disadvantage), and until when. Numbers it changes show up at once, with the effect
 * named in "where does this number come from".
 */
export function Effects({
  list,
  set,
  items = [],
  used,
  use,
  spend = true,
  weapons = [],
  targets,
}: {
  list: HolotableEffect[];
  set?: (list: HolotableEffect[]) => void;
  /** Homebrew items with effects (F-066). */
  items?: HomebrewItem[];
  /** How many of each are used up (F-067). */
  used?: StateValue;
  /** Use an item — or, for the GM, put its effects on without using one up (F-067). */
  use?: (item: HomebrewItem) => void;
  /** Whether `use` uses one up: on the player's phone it does, on the GM's card it does not. */
  spend?: boolean;
  /** This character's weapons, so an effect can go on one of them by name (F-083). */
  weapons?: { name: string }[];
  /**
   * The targets to offer instead of a character's own (F-084): an enemy has no sheet,
   * so only its saves, armour class, initiative and attacks are on the list.
   */
  targets?: string[];
}): JSX.Element | null {
  const term = useTerm();
  const skill = (x: string): string => term('skill', x);
  const weaponName = (x: string): string => term('weapon', x);
  const [open, setOpen] = useState(false);
  const options = targets ?? effectTargetOptions(weapons);
  const [source, setSource] = useState('');
  const [target, setTarget] = useState(targets === undefined ? 'ability:Dexterity' : (targets[0] ?? 'armorClass'));
  const [kind, setKind] = useState<'bonus' | 'advantage' | 'disadvantage'>('bonus');
  const [bonus, setBonus] = useState('1');
  const [until, setUntil] = useState<HolotableEffect['until']>('fight');
  const [rounds, setRounds] = useState('1');
  const [problem, setProblem] = useState<string | null>(null);
  if (list.length === 0 && set === undefined && items.length === 0) return null;
  // An item's effects are on when every one of them is: the button then says so.
  const isOn = (item: HomebrewItem): boolean => list.some((e) => e.source === item.name);
  return (
    <div className="effects">
      {items.length > 0 && (
        <div className="homebrew-items">
          {items.map((item) => (
            <span key={item.name} className="homebrew-item" title={item.effects.map((e) => effectText({ ...e, id: '', source: item.name }, skill, weaponName)).join('\n')}>
              {item.name}
              {item.consumable ? <small> ×{itemsLeft(item, used)}</small> : item.quantity !== 1 && <small> ×{item.quantity}</small>}
              {item.note !== '' && <small className="item-note"> — {item.note}</small>}
              {use !== undefined && (
                <button
                  type="button"
                  disabled={isOn(item) || (spend && item.consumable && itemsLeft(item, used) === 0)}
                  onClick={() => use(item)}
                >
                  {isOn(item) ? 'діє' : spend ? (item.consumable && itemsLeft(item, used) === 0 ? 'закінчився' : 'використати') : 'накласти'}
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {list.map((e) => (
        <span key={e.id} className="effect">
          {effectText(e, skill, weaponName)}
          {set !== undefined && (
            <button type="button" title="зняти" aria-label={`Зняти ефект ${e.source}`} onClick={() => set(list.filter((x) => x.id !== e.id))}>
              ×
            </button>
          )}
        </span>
      ))}
      {set !== undefined && !open && (
        <button type="button" className="effect-add" onClick={() => setOpen(true)}>
          + ефект
        </button>
      )}
      {set !== undefined && open && (
        <form
          className="effect-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            const n = Number(bonus);
            if (source.trim() === '') {
              setProblem('звідки ефект? Наприклад, «Стимулятор»');
              return;
            }
            if (kind === 'bonus' && (!Number.isInteger(n) || n === 0 || Math.abs(n) > 20)) {
              setProblem('бонус — ціле число від −20 до 20, не нуль');
              return;
            }
            const r = Number(rounds);
            if (until === 'rounds' && (!Number.isInteger(r) || r < 1 || r > 100)) {
              setProblem('скільки раундів — ціле число від 1 до 100');
              return;
            }
            // In a fight, the server works out the round it ends at (F-067).
            const effect: HolotableEffect = {
              id: effectId(), source: source.trim(), target, until,
              ...(kind === 'bonus' ? { bonus: n } : { mode: kind }),
              ...(until === 'rounds' ? { rounds: r } : {}),
            };
            set([...list, effect]);
            setOpen(false);
            setSource('');
            setProblem(null);
          }}
        >
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="звідки: Стимулятор" aria-label="Звідки ефект" />
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="На що діє">
            {options.map((t) => (
              <option key={t} value={t}>{effectTargetText(t, skill, weaponName)}</option>
            ))}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Що дає">
            <option value="bonus">число</option>
            <option value="advantage">перевага</option>
            <option value="disadvantage">недолік</option>
          </select>
          {kind === 'bonus' && (
            <input type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} aria-label="Бонус" />
          )}
          <select value={until} onChange={(e) => setUntil(e.target.value as HolotableEffect['until'])} aria-label="До коли">
            {(Object.keys(UNTIL_TEXT) as HolotableEffect['until'][]).map((u) => (
              <option key={u} value={u}>{UNTIL_TEXT[u]}</option>
            ))}
          </select>
          {until === 'rounds' && (
            <input type="number" value={rounds} onChange={(e) => setRounds(e.target.value)} aria-label="Скільки раундів" />
          )}
          <button type="submit">накласти</button>
          <button type="button" onClick={() => setOpen(false)}>скасувати</button>
          {problem !== null && <span className="refusal">{problem}</span>}
        </form>
      )}
    </div>
  );
}

/** How a fighter is named on screen: a party member by name, an enemy by creature and number. */
export function fighterName(fighter: Fighter, term: Term): string {
  if (fighter.kind !== 'enemy') return name(fighter.character);
  return `${term('monster', fighter.monster ?? fighter.name)} ${fighter.number ?? ''}`.trim();
}

/** Steps the GM uses on an enemy: damage on the left, healing on the right. */
const ENEMY_STEPS = [-10, -5, -1, 1, 5];

/**
 * An enemy's numbers on the GM's line (F-055): AC, hit points with damage and healing,
 * the attacks with their text on hover. Straight from the bestiary — and only here:
 * a player's screen never receives them.
 */
function EnemyDetails({
  fighter,
  damage,
  remove,
  setConditions,
  setEffects,
  conditionChoices = [],
}: {
  fighter: Fighter;
  damage: (enemy: string, amount: number) => void;
  remove: (enemy: string) => void;
  setConditions?: (enemy: string, list: string[]) => void;
  /** Effects on this creature (F-084). Absent — they are only shown. */
  setEffects?: (enemy: string, list: HolotableEffect[]) => void;
  conditionChoices?: string[];
}): JSX.Element | null {
  const e = fighter.enemy;
  if (e === undefined) return null;
  const full = (ability: string): string =>
    ({ Strength: 'Сила', Dexterity: 'Спритність', Constitution: 'Статура', Intelligence: 'Інтелект', Wisdom: 'Мудрість', Charisma: 'Харизма' } as Record<string, string>)[ability] ?? ability;
  return (
    <div className="enemy">
      <span className={`enemy-hp${e.hp === 0 ? ' down' : e.hp * 2 <= e.maxHp ? ' low' : ''}`}>
        КБ <b>{e.ac}</b> · ХП <b>{e.hp}</b>/{e.maxHp}
        <small title={e.hpFrom === 'gm' ? 'ХП кинув майстер' : `середнє з книги; кидок: ${e.hpRoll}`}>
          {e.hpFrom === 'gm' ? ' кинуто' : ' сер.'}
        </small>
      </span>
      <span className="buttons">
        {ENEMY_STEPS.map((step) => (
          <button
            key={step}
            type="button"
            title={step < 0 ? `шкода ${-step}` : `лікування ${step}`}
            disabled={(step < 0 && e.hp === 0) || (step > 0 && e.hp === e.maxHp)}
            onClick={() => damage(fighter.id, -step)}
          >
            {step > 0 ? `+${step}` : step}
          </button>
        ))}
        <button
          type="button"
          className="remove"
          title="Прибрати з бою"
          onClick={() => {
            if (confirm(`Прибрати з бою: ${fighter.name}?`)) remove(fighter.id);
          }}
        >
          ✕
        </button>
      </span>
      {setConditions !== undefined && (
        <Conditions list={fighter.conditions ?? []} choices={conditionChoices} set={(list) => setConditions(fighter.id, list)} />
      )}
      {/* The six saves (F-084). Bold is the bestiary's own number; the rest is just the
          ability modifier, which is what the books mean when they say nothing. */}
      <span className="enemy-saves">
        Сейви:
        {e.saves.map((save) => (
          <span
            key={save.ability}
            className={save.book ? 'book' : undefined}
            title={`${full(save.ability)}${save.book ? ' — з бестіарію' : ' — модифікатор характеристики, бестіарій сейва не дає'}${save.effect === 0 ? '' : ` · ефект ${signed(save.effect)}`}`}
          >
            {(ABILITY_SHORT.find((a) => a.key === save.ability)?.label ?? save.ability)} {signed(save.modifier)}
            {save.unclear === true && <b title="у бестіарії сейв названий, але число не приїхало — узято модифікатор характеристики">?</b>}
            <RollMode mode={save.mode} />
          </span>
        ))}
        {e.initiativeMode !== undefined && (
          <span className="enemy-init-mode">ініціатива<RollMode mode={e.initiativeMode} /></span>
        )}
      </span>
      {e.attacks.length > 0 && (
        <span className="enemy-attacks">
          {e.attacks.map((a) => (
            <span key={a.name} title={a.text}>
              {a.name} {signed(a.toHit)}
              <RollMode mode={a.mode} />
            </span>
          ))}
        </span>
      )}
      <Effects
        list={e.effects}
        targets={ENEMY_EFFECT_TARGETS}
        {...(setEffects === undefined ? {} : { set: (list: HolotableEffect[]) => setEffects(fighter.id, list) })}
      />
    </div>
  );
}

/**
 * Bringing creatures in from the bestiary (F-055): find one, say how many, and either
 * leave hit points to the book's average or type what the dice gave — the app never
 * rolls them.
 */
export function AddEnemies({ add }: { add: (monster: string, count: number, hp?: number) => void }): JSX.Element {
  const term = useTerm();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ key: string; name: string }[]>([]);
  const [picked, setPicked] = useState<{ key: string; name: string } | null>(null);
  const [count, setCount] = useState('1');
  const [hp, setHp] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/search?type=monster&q=${encodeURIComponent(q)}`)
        .then((r) => r.json() as Promise<{ key: string; name: string }[]>)
        .then((found) => setHits(found.slice(0, 8)))
        .catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="add-enemies">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPicked(null);
        }}
        placeholder="ворог із бестіарію: pirate, droid…"
        aria-label="Пошук ворога в бестіарії"
      />
      {picked === null ? (
        hits.length > 0 && (
          <ul className="enemy-hits">
            {hits.map((h) => (
              <li key={h.key}>
                <button type="button" onClick={() => setPicked(h)}>
                  {term('monster', h.name)}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <form
          className="add"
          onSubmit={(ev) => {
            ev.preventDefault();
            const n = Number(count);
            const rolled = hp.trim() === '' ? undefined : Number(hp);
            if (!Number.isInteger(n) || n < 1 || n > 20) {
              setProblem('скільки — від 1 до 20');
              return;
            }
            if (rolled !== undefined && (!Number.isInteger(rolled) || rolled < 1)) {
              setProblem('ХП — ціле число від 1, або порожньо');
              return;
            }
            add(picked.key, n, rolled);
            setQ('');
            setPicked(null);
            setCount('1');
            setHp('');
            setProblem(null);
          }}
        >
          <b>{term('monster', picked.name)}</b>
          <label>
            × <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)} aria-label="Скільки" />
          </label>
          <input
            type="number"
            min={1}
            value={hp}
            onChange={(e) => setHp(e.target.value)}
            placeholder="ХП: середнє"
            aria-label="ХП кожного (порожньо — середнє з книги)"
          />
          <button type="submit">додати</button>
          {problem !== null && <span className="refusal">{problem}</span>}
        </form>
      )}
    </div>
  );
}

/** One line of the turn order: who, what they rolled, and whether it is their turn. */
function OrderRow({
  fighter,
  current,
  roll,
  damage,
  remove,
  setConditions,
  setEffects,
  conditionChoices,
}: {
  fighter: Fighter;
  current: boolean;
  roll: (character: string, value: number, said?: number) => void;
  damage?: (enemy: string, amount: number) => void;
  remove?: (enemy: string) => void;
  setConditions?: (enemy: string, list: string[]) => void;
  setEffects?: (enemy: string, list: HolotableEffect[]) => void;
  conditionChoices?: string[];
}): JSX.Element {
  const term = useTerm();
  const who = fighterName(fighter, term);
  const enemy = fighter.kind === 'enemy';
  return (
    <li
      className={
        `${current ? 'now' : ''}${fighter.total === null ? ' unrolled' : ''}${enemy ? ' foe' : ''}${fighter.status === 'знешкоджений' ? ' down' : ''}`.trim() ||
        undefined
      }
    >
      <span className="who">
        {enemy && fighter.enemy !== undefined ? <TermLink kind="monster" english={fighter.monster ?? ''}>{who}</TermLink> : who}
      </span>
      {fighter.roll === null ? (
        <RollInput
          label={`Кидок ініціативи за ${who}`}
          sum={fighter.counts === 'player' ? 'optional' : 'none'}
          submit={(value, said) => roll(enemy ? fighter.id : fighter.character, value, said)}
        />
      ) : fighter.said === null ? (
        <span className="total">
          <b>{fighter.total}</b>
          <small>
            {fighter.roll} {signed(fighter.modifier)}
          </small>
        </span>
      ) : (
        <span className={fighter.said === fighter.total ? 'total' : 'total differs'}>
          <b>{fighter.said}</b>
          <small title="Число гравця, а поруч — те, що виходить за листом">
            {fighter.said === fighter.total ? '' : '≠ '}лист: {fighter.total} ({fighter.roll} {signed(fighter.modifier)})
          </small>
        </span>
      )}
      {current && <i className="mark">← хід</i>}
      {fighter.companion !== undefined && (
        <span className="with-companion">
          + {fighter.companion.name}:{' '}
          {fighter.companion.roll === null ? (
            <RollInput
              label={`Кидок ініціативи за ${fighter.companion.name}`}
              sum="none"
              submit={(value) => roll(fighter.companion?.id ?? '', value)}
            />
          ) : (
            <>
              <b>{fighter.companion.said ?? fighter.companion.total}</b>
              <small> ({fighter.companion.roll} {signed(fighter.companion.modifier)}) · </small>
              <b className="together">разом на меншому: {initiativeOf(fighter)}</b>
            </>
          )}
        </span>
      )}
      {enemy && damage !== undefined && remove !== undefined && (
        <EnemyDetails
          fighter={fighter}
          damage={damage}
          remove={remove}
          {...(setConditions === undefined ? {} : { setConditions })}
          {...(setEffects === undefined ? {} : { setEffects })}
          {...(conditionChoices === undefined ? {} : { conditionChoices })}
        />
      )}
    </li>
  );
}

/**
 * Ending the fight (F-059). The books do not say which conditions last only "until the
 * end of the fight", so the GM ticks them one by one — nothing is taken off by itself.
 * A short rest sits right here, because that is what usually comes next.
 */
export function EndPanel({
  party,
  end,
  cancel,
  rest,
}: {
  party: Record<string, CharacterState>;
  end: (clear: { character: string; condition: string }[]) => void;
  cancel: () => void;
  rest?: (kind: 'short' | 'long') => void;
}): JSX.Element {
  const term = useTerm();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const offered = Object.entries(party).flatMap(([character, s]) =>
    ((Array.isArray(s.conditions) ? s.conditions : []) as string[]).map((condition) => ({ character, condition, id: `${character}\u0000${condition}` })),
  );
  return (
    <div className="end-panel">
      <p>
        <b>Кінець бою.</b> Черга зникне, ХП і пули лишаться як є.
      </p>
      {offered.length === 0 ? (
        <p className="hint">Умов на партії немає.</p>
      ) : (
        <>
          <p className="hint">Які умови зняти разом із кінцем бою? Решта лишиться.</p>
          <ul className="end-conditions">
            {offered.map((o) => (
              <li key={o.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={ticked.has(o.id)}
                    onChange={(e) => {
                      const next = new Set(ticked);
                      if (e.target.checked) next.add(o.id);
                      else next.delete(o.id);
                      setTicked(next);
                    }}
                  />{' '}
                  {name(o.character)} — {term('condition', o.condition)}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="buttons">
        <button type="button" onClick={() => end(offered.filter((o) => ticked.has(o.id)).map(({ character, condition }) => ({ character, condition })))}>
          Закінчити бій
          <small>{ticked.size === 0 ? 'умови лишаються' : `зняти умов: ${ticked.size}`}</small>
        </button>
        {rest !== undefined && (
          <button type="button" onClick={() => rest('short')}>
            Короткий відпочинок
            <small>можна й після кінця бою</small>
          </button>
        )}
        <button type="button" onClick={cancel}>
          Скасувати
          <small>бій триває</small>
        </button>
      </div>
    </div>
  );
}

/** A fight's summary in one line, for the feed (F-059). */
export function fightText(f: FightSummary): string {
  const rounds = `${f.rounds} ${f.rounds === 1 ? 'раунд' : f.rounds < 5 ? 'раунди' : 'раундів'}`;
  const people = f.party
    .filter((p) => p.lost > 0 || p.healed > 0 || p.fell)
    .map((p) => `${name(p.character)}${p.lost > 0 ? ` −${p.lost}` : ''}${p.healed > 0 ? ` +${p.healed}` : ''}${p.fell ? ' (падав)' : ''}`);
  const foes = f.enemies.map((e) => `${e.name}${e.count > 1 ? ` ×${e.count}` : ''}`);
  return [
    `Бій завершено · ${rounds}`,
    people.length === 0 ? 'ХП ніхто не втратив' : people.join(', '),
    ...(foes.length === 0 ? [] : [`вороги: ${foes.join(', ')}`]),
  ].join(' · ');
}

/**
 * The fight on the GM's screen (F-054): the turn order, whose turn it is, which round.
 *
 * What the app does here is the arithmetic and the bookkeeping — it adds the modifier
 * from the sheet, sorts the queue and counts the rounds. What it does not do is roll:
 * every number in this list came out of someone's hand. Equal totals are settled by
 * Dexterity, so the order is the same on every screen and after every restart.
 */
export function CombatBoard({
  combat,
  start,
  roll,
  move,
  end,
  addEnemies,
  damageEnemy,
  removeEnemy,
  setEnemyConditions,
  setEnemyEffects,
  conditionChoices,
  party,
  rest,
}: {
  combat: CombatState | null;
  start: () => void;
  roll: (character: string, value: number, said?: number) => void;
  move: (direction: 'next' | 'back') => void;
  end: (clear?: { character: string; condition: string }[]) => void;
  /** The party's state — to offer their conditions for taking off at the end (F-059). */
  party?: Record<string, CharacterState>;
  /** A rest, right next to the end of the fight. */
  rest?: (kind: 'short' | 'long') => void;
  /** Enemies from the bestiary (F-055). Without them the board is the party's only. */
  addEnemies?: (monster: string, count: number, hp?: number) => void;
  damageEnemy?: (enemy: string, amount: number) => void;
  removeEnemy?: (enemy: string) => void;
  /** Conditions on enemies (F-056). */
  setEnemyConditions?: (enemy: string, list: string[]) => void;
  /** Effects on enemies (F-084): a number or advantage/disadvantage, with a duration. */
  setEnemyEffects?: (enemy: string, list: HolotableEffect[]) => void;
  conditionChoices?: string[];
}): JSX.Element {
  const term = useTerm();
  const [ending, setEnding] = useState(false);
  if (combat === null) {
    return (
      <section className="combat">
        <h2>Бій</h2>
        <div className="buttons">
          <button type="button" onClick={start}>
            Почати бій
            <small>партія стає в чергу; далі кожен кидає d20 і вписує, що випало</small>
          </button>
        </div>
      </section>
    );
  }
  const waiting = combat.order.filter((f) => f.total === null);
  return (
    <section className="combat on">
      <h2>Бій · раунд {combat.round}</h2>
      <ol className="order">
        {combat.order.map((f) => (
          <OrderRow
            key={f.id}
            fighter={f}
            current={f.id === combat.turn}
            roll={roll}
            {...(damageEnemy === undefined ? {} : { damage: damageEnemy })}
            {...(removeEnemy === undefined ? {} : { remove: removeEnemy })}
            {...(setEnemyConditions === undefined ? {} : { setConditions: setEnemyConditions })}
            {...(setEnemyEffects === undefined ? {} : { setEffects: setEnemyEffects })}
            {...(conditionChoices === undefined ? {} : { conditionChoices })}
          />
        ))}
      </ol>
      {waiting.length > 0 && (
        <p className="hint">
          Чекаю кидок: {waiting.map((f) => fighterName(f, term)).join(', ')}. Хто не кинув — чергу пропускає;
          впиши за нього сам, якщо його немає за столом.
        </p>
      )}
      {combat.lastAttack !== undefined && <LastAttackLine attack={combat.lastAttack} />}
      {addEnemies !== undefined && <AddEnemies add={addEnemies} />}
      <div className="buttons">
        <button type="button" onClick={() => move('next')}>
          Наступний хід
          <small>після останнього починається новий раунд</small>
        </button>
        <button type="button" onClick={() => move('back')}>
          Крок назад
          <small>якщо натиснув зарано</small>
        </button>
        <button type="button" onClick={() => setEnding(true)}>
          Завершити бій
          <small>черга зникає; ХП і пули лишаються; умови — на твій вибір</small>
        </button>
      </div>
      {ending && (
        <EndPanel
          party={party ?? {}}
          end={(clear) => {
            setEnding(false);
            end(clear);
          }}
          cancel={() => setEnding(false)}
          {...(rest === undefined ? {} : { rest })}
        />
      )}
    </section>
  );
}

/**
 * The last attack typed on a phone, on the GM's board (F-057): the person's number big,
 * the sheet's beside it, and ≠ when they differ — the GM decides, as with initiative.
 */
function LastAttackLine({ attack }: { attack: LastAttack }): JSX.Element {
  const term = useTerm();
  const counted = attack.said ?? attack.total;
  const differs = attack.said !== null && attack.total !== null && attack.said !== attack.total;
  return (
    <p className="last-attack">
      Атака: <b>{name(attack.character)}</b> — {term('weapon', attack.weapon)}: <b>{counted}</b>
      <small>
        {attack.said === null
          ? ` (${attack.roll} за листом)`
          : ` ${differs ? '≠ ' : ''}лист: ${attack.total} (випало ${attack.roll})`}
      </small>
    </p>
  );
}

/** ●●○ — marks out of three. */
const marks = (n: number): string => '●'.repeat(n) + '○'.repeat(Math.max(0, DEATH_SAVES_LIMIT - n));

/** The death saves in one line, for the GM's card and the phone alike (F-058). */
export function deathSavesText(state: CharacterState): string {
  const d = deathSavesOf(state);
  if (d.failures >= DEATH_SAVES_LIMIT) return 'три провали — що це означає, вирішує майстер';
  if (d.successes >= DEATH_SAVES_LIMIT) return 'стабілізований: живий, без свідомості';
  return `успіхів ${d.successes} з ${DEATH_SAVES_LIMIT} · провалів ${d.failures} з ${DEATH_SAVES_LIMIT}`;
}

/**
 * At 0 hit points (F-058): the phone shows the three and three, and takes the d20 rolled
 * at the table — two numbers when the person counts (ADR 0007). The book decides what a
 * roll does; three failures only stop the rolling — the table decides the rest.
 */
export function DeathSavesBlock({
  state,
  counts,
  roll,
}: {
  state: CharacterState;
  counts: WhoCounts;
  roll: (value: number, said?: number) => void;
}): JSX.Element {
  const d = deathSavesOf(state);
  const over = d.failures >= DEATH_SAVES_LIMIT || d.successes >= DEATH_SAVES_LIMIT;
  return (
    <section className="death-saves">
      <h3>Ти без свідомості</h3>
      <p className="marks">
        <span>успіхи <b>{marks(d.successes)}</b></span>
        <span>провали <b>{marks(d.failures)}</b></span>
      </p>
      {over ? (
        <p className="hint">{deathSavesText(state)}</p>
      ) : (
        <>
          <p className="hint">
            {counts === 'player'
              ? 'Кинь d20, впиши, що випало, і що вийшло разом. 10 і більше — успіх, 1 — два провали, 20 — встаєш з 1 ХП.'
              : 'Кинь d20 і впиши, що випало. 10 і більше — успіх, 1 — два провали, 20 — встаєш з 1 ХП.'}
          </p>
          <RollInput label="Рятівний від смерті: що випало на d20" sum={counts === 'player' ? 'optional' : 'none'} button="рятівний" submit={roll} />
        </>
      )}
    </section>
  );
}

/** Damage dice without the modifier: "1d8 + 4" → "1d8". The person adds theirs (ADR 0007). */
export function diceOnly(damage: string): string {
  return damage.replace(/\s*[+-]\s*\d+\s*$/, '');
}

/** Pools the turn screen lets you spend with one tap. */
const TURN_POOLS: { field: 'forcePointsUsed' | 'techPointsUsed' | 'superiorityDiceUsed'; label: string; max: (s: SheetSummary) => number | undefined; note: (s: SheetSummary) => string }[] = [
  { field: 'forcePointsUsed', label: 'Сила', max: (s) => s.forcePoints?.max, note: (s) => (s.forcePoints === undefined ? '' : `DC ${s.forcePoints.dcLight === s.forcePoints.dcDark ? s.forcePoints.dcLight : `${s.forcePoints.dcLight}/${s.forcePoints.dcDark}`}`) },
  { field: 'techPointsUsed', label: 'Техніка', max: (s) => s.techPoints?.max, note: (s) => (s.techPoints === undefined ? '' : `DC ${s.techPoints.dc}`) },
  { field: 'superiorityDiceUsed', label: 'Суперіориті', max: (s) => s.superiority?.quantity, note: (s) => s.superiority?.size ?? '' },
];

/**
 * "Your turn" on the phone (F-057): what is needed right now, and nothing else — the
 * attacks, the maneuvers with their DC, the pools to spend, and "turn over".
 *
 * An attack is a roll, so ADR 0007 applies: when the person counts, they type what came
 * up and what they made of it, and no to-hit bonus sits next to the field — remembering
 * it is theirs. The damage dice stay: which die to throw is what the app is for.
 */
export function MyTurn({
  combat,
  character,
  sheet,
  state,
  counts,
  attack,
  spend,
  done,
  companionRules,
}: {
  combat: CombatState;
  character: string;
  sheet: SheetSummary;
  state: CharacterState;
  counts: WhoCounts;
  attack: (weapon: string, value: number, said?: number) => void;
  spend: (field: 'forcePointsUsed' | 'techPointsUsed' | 'superiorityDiceUsed') => void;
  done: () => void;
  /** The book's sentences on fighting with a companion — only for someone who has one (F-039). */
  companionRules?: string[];
}): JSX.Element {
  const term = useTerm();
  const last = combat.lastAttack?.character === character && combat.lastAttack.round === combat.round ? combat.lastAttack : undefined;
  return (
    <section className="my-turn">
      <h2>Твій хід · раунд {combat.round}</h2>
      <h3>Атаки</h3>
      <ul className="turn-attacks">
        {sheet.attacks.map((a, i) => (
          <li key={a.name}>
            <span className="what">
              <TermLink kind="weapon" english={a.name}>{term('weapon', a.name)}</TermLink>
              <small>
                {counts === 'app'
                  ? ` ${signed(a.toHit)} · ${a.damageDice} ${term('damage', a.damageType)}`
                  : ` шкода ${diceOnly(a.damageDice)} ${term('damage', a.damageType)}`}
              </small>
              <RollMode mode={sheet.rollModes?.[`attack:${i}`]} />
            </span>
            <RollInput
              label={`Атака: ${a.name}, що випало на d20`}
              sum={counts === 'player' ? 'required' : 'none'}
              button="атака"
              submit={(value, said) => attack(a.name, value, said)}
            />
          </li>
        ))}
      </ul>
      {last !== undefined && (
        <p className="hint">
          Записано: {term('weapon', last.weapon)} — {last.said ?? last.total} (випало {last.roll}). Влучання вирішує майстер.
        </p>
      )}
      {sheet.maneuvers.length > 0 && (
        <>
          <h3>Маневри</h3>
          <ul className="turn-maneuvers">
            {sheet.maneuvers.map((m) => (
              <li key={m.name}>
                <TermLink kind="maneuver" english={m.name}>{term('maneuver', m.name)}</TermLink>
                <small>
                  {m.cost === 0 ? 'без кубика' : `${m.cost} куб.`}
                  {m.saveDC === null ? '' : ` · DC ${m.saveDC}`}
                </small>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="turn-pools">
        {TURN_POOLS.map((p) => {
          const max = p.max(sheet);
          if (max === undefined) return null;
          const used = typeof state[p.field] === 'number' ? (state[p.field] as number) : 0;
          const left = Math.max(0, max - used);
          return (
            <span key={p.field} className="pool">
              <small>{p.label}</small>
              <b>
                {left}<i>/{max}</i>
              </b>
              <small className="note">{p.note(sheet)}</small>
              <button type="button" disabled={left === 0} onClick={() => spend(p.field)}>
                −1
              </button>
            </span>
          );
        })}
      </div>
      {companionRules !== undefined && companionRules.length > 0 && (
        <div className="companion-rules">
          <h3>З компаньйоном</h3>
          {companionRules.map((r) => (
            <p key={r} className="hint">{r}</p>
          ))}
        </div>
      )}
      <button type="button" className="turn-done" onClick={done}>
        Хід завершено
      </button>
    </section>
  );
}

/**
 * The player's side of the fight (F-054): throw the d20, type it, see where you stand.
 * The big "your turn" screen with the attacks to hand is F-057; here it is one line.
 */
export function MyInitiative({
  combat,
  character,
  counts,
  roll,
}: {
  combat: CombatState;
  character: string;
  /** Who counts for this character (F-064): the person or the app. */
  counts: WhoCounts;
  /** A roll for this character — or, with `whom`, for its companion (F-039). */
  roll: (value: number, said?: number, whom?: string) => void;
}): JSX.Element {
  const term = useTerm();
  const mine = combat.order.find((f) => f.character === character);
  const current = combat.order.find((f) => f.id === combat.turn);
  // Enemies as the player sees them across the table: a name and a word, no numbers (F-055).
  const foes = combat.order.filter((f) => f.kind === 'enemy');
  return (
    <div className="my-initiative">
      <h3>Бій · раунд {combat.round}</h3>
      {mine === undefined ? (
        <p className="hint">Тебе в цьому бою немає.</p>
      ) : mine.roll === null ? (
        <>
          <p className="hint">
            {counts === 'player'
              ? `Кинь d${INITIATIVE_DIE}, додай свої модифікатори сам і впиши обидва числа.`
              : `Кинь d${INITIATIVE_DIE} і впиши, що випало — додам ${signed(mine.modifier)} за ініціативу.`}
          </p>
          <RollInput
            label={`Що випало на d${INITIATIVE_DIE}`}
            sum={counts === 'player' ? 'required' : 'none'}
            submit={roll}
          />
        </>
      ) : (
        <p className="state-row">
          <span className="label">Твоя ініціатива</span>
          <b className="value">{mine.said ?? mine.total}</b>
          <small>
            {mine.said === null ? `${mine.roll} ${signed(mine.modifier)}` : `випало ${mine.roll}`}
          </small>
        </p>
      )}
      {mine?.companion !== undefined && (
        mine.companion.roll === null ? (
          <>
            <p className="hint">
              {mine.companion.name} кидає свою ініціативу: дієте разом, на меншому з двох чисел.
            </p>
            <RollInput
              label={`Що випало на d${INITIATIVE_DIE} у ${mine.companion.name}`}
              sum={counts === 'player' ? 'optional' : 'none'}
              button="ініціатива дроїда"
              submit={(value, said) => roll(value, said, mine.companion?.id)}
            />
          </>
        ) : (
          <p className="state-row">
            <span className="label">{mine.companion.name}</span>
            <b className="value">{mine.companion.said ?? mine.companion.total}</b>
            <small>разом на меншому</small>
          </p>
        )
      )}
      <p className={current?.character === character ? 'turn-now' : 'hint'}>
        {current === undefined
          ? 'Хід ще нічий — чекаємо кидки.'
          : current.character === character
            ? 'Зараз твій хід.'
            : `Зараз хід: ${fighterName(current, term)}.`}
        {mine !== undefined && current !== undefined && current.character !== character && (() => {
          const left = turnsUntil(combat, mine.id);
          return left === null || left === 0 ? null : ` До твого ходу: ${left}.`;
        })()}
      </p>
      {foes.length > 0 && (
        <ul className="foes">
          {foes.map((f) => (
            <li key={f.id} className={f.status === 'знешкоджений' ? 'down' : undefined}>
              <span>
                {fighterName(f, term)}
                {(f.conditions ?? []).length > 0 && (
                  <small className="foe-conditions"> · {(f.conditions ?? []).map((c) => term('condition', c)).join(', ')}</small>
                )}
              </span>
              <small>{f.status}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Who counts, player by player (F-064, ADR 0007).
 *
 * The default is that the person counts, because adding your own modifiers — and
 * remembering where they come from — is half of what people come to the table for. The
 * switch is here for the exceptions: someone new, someone young, someone who would
 * rather the arithmetic went away. It is the GM's to flip, and it holds between
 * sessions: it lives in a file in state/, not in this page.
 */
export function CountsSwitch({
  characters,
  counts,
  set,
}: {
  characters: string[];
  counts: Record<string, WhoCounts>;
  set: (character: string, who: WhoCounts) => void;
}): JSX.Element {
  return (
    <section className="counts">
      <h2>Хто рахує кидки</h2>
      <ul>
        {characters.map((slug) => {
          const who = whoCounts(counts, slug);
          return (
            <li key={slug}>
              <span className="who">{name(slug)}</span>
              <span className="switch" role="group" aria-label={`Хто рахує за ${name(slug)}`}>
                <button type="button" className={who === 'player' ? 'on' : undefined} onClick={() => set(slug, 'player')}>
                  гравець
                </button>
                <button type="button" className={who === 'app' ? 'on' : undefined} onClick={() => set(slug, 'app')}>
                  застосунок
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="hint">
        «Гравець» — кидає кубик, додає свої модифікатори сам і вписує суму; застосунок
        рахує своє число й показує тобі поруч, для звірки. «Застосунок» — додає модифікатор
        сам, як раніше. Різниця в числах — не обовʼязково помилка гравця: лист буває
        застарілим, а за столом буває бонус, про який застосунок не знає.
      </p>
    </section>
  );
}

/**
 * The rest buttons. One announcement at the table is one button here, for everyone.
 *
 * What a rest gives back is not the same for everyone, and the app does not guess: the
 * server reads each character's own class text. Hit dice are deliberately left alone —
 * spending them is the player's choice and the player's roll.
 */
export function Rests({ rest }: { rest: (kind: 'short' | 'long') => void }): JSX.Element {
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
  fights = [],
  npcNotes = [],
  undoNpc,
}: {
  events: GameEvent[];
  undo: (row: FeedRow) => void;
  /** Ended fights, shown among the changes at the moment each ended (F-059). */
  fights?: FightSummary[];
  /** What changed about the scene's NPCs, newest last (F-085). */
  npcNotes?: NpcNote[];
  /** Take one NPC line back (F-090). Absent — the lines are only shown. */
  undoNpc?: (undo: NpcUndo) => void;
}): JSX.Element {
  const now = Date.now();
  const rows = collapse(events).slice(0, 12);
  const oldest = rows.at(-1)?.at ?? 0;
  const shownFights = [...fights].filter((f) => rows.length < 12 || f.endedAt >= oldest).reverse();
  const shownNotes = [...npcNotes].slice(-6).reverse();
  return (
    <section className="feed">
      <h2>Що сталося</h2>
      {shownNotes.length > 0 && (
        <ul className="npc-notes">
          {shownNotes.map((note) => (
            <li key={`${note.at}-${note.text}`}>
              {note.text} <small>· {whenText(note.at, now)}</small>
              {undoNpc !== undefined && note.undo !== undefined && (
                <button type="button" className="undo" onClick={() => undoNpc(note.undo as NpcUndo)}>
                  відкотити
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {shownFights.length > 0 && (
        <ul className="fights">
          {shownFights.map((f) => (
            <li key={f.endedAt} className="fight">
              <span className="what">{fightText(f)}</span>
              <span className="when">{whenText(f.endedAt, now)}</span>
            </li>
          ))}
        </ul>
      )}
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
                {isMismatch(row) && (
                  <i className="mark differs" title={row.note}>
                    {' '}≠ числа розійшлись
                  </i>
                )}
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
 * A number with its breakdown on hover (F-042). Without a breakdown it is just the
 * number — never an empty hint.
 */
function Why({
  sheet,
  what,
  signedTotal,
  children,
}: {
  sheet: SheetSummary;
  what: string;
  signedTotal: boolean;
  children: ReactNode;
}): JSX.Element {
  const e = sheet.explain?.[what];
  // Hand edits on this number that are debt (F-043): marked, so they cannot pass as normal.
  const debt = (sheet.handEdits ?? []).filter((h) => h.key === what && h.verdict !== 'customItem');
  const number = e === undefined ? <>{children}</> : (
    <span className="why" title={explanationText(e, signedTotal)}>
      {children}
    </span>
  );
  if (debt.length === 0) return number;
  return (
    <>
      {number}
      <span className={`hand-edit ${debt.some((h) => h.verdict === 'unknown') ? 'unknown' : ''}`} title={debt.map((h) => h.text).join('\n')}>
        ✎
      </span>
    </>
  );
}

const VERDICT: Record<SheetSummary['handEdits'][number]['verdict'], string> = {
  unknown: 'походження невідоме',
  choice: 'невнесений вибір',
  redundant: 'зайва',
  customItem: 'власний предмет',
};

/** Every hand edit of the character, debt first (F-043). */
function HandEdits({ sheet }: { sheet: SheetSummary }): JSX.Element | null {
  const all = sheet.handEdits ?? [];
  const debt = all.filter((h) => h.verdict !== 'customItem');
  if (all.length === 0) return null;
  const order = ['unknown', 'choice', 'redundant', 'customItem'];
  return (
    <details className="hand-edits">
      <summary>
        Ручні правки — {debt.length}
        {all.length > debt.length ? ` (+${all.length - debt.length} власних предметів)` : ''}
      </summary>
      <ul>
        {[...all]
          .sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict))
          .map((h, i) => (
            <li key={i} className={h.verdict}>
              <b>{VERDICT[h.verdict]}</b> · {h.text}
            </li>
          ))}
      </ul>
    </details>
  );
}

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
  conditionChoices,
  setConditions,
  companion,
  setEffects,
  items,
  useItem,
  useFeature,
  party = [],
}: {
  slug: string;
  state: CharacterState;
  sheet: SheetSummary | undefined;
  /** The book's conditions to pick from, and how to set the list (F-056). Absent — read only. */
  conditionChoices?: string[];
  setConditions?: (list: string[]) => void;
  /** The character's companion, its state, and how to change it (F-039). */
  companion?: { summary: CompanionSummary; state: CharacterState; change: (changes: CharacterState) => void };
  /** Put effects on and take them off (F-065). Absent — the effects are only shown. */
  setEffects?: (list: HolotableEffect[]) => void;
  /** Homebrew items the character carries that give effects (F-066). */
  items?: HomebrewItem[];
  /** The GM puts an item's effects on, without using one up (F-067). */
  useItem?: (item: HomebrewItem) => void;
  /** The GM puts a feature's effect on this character and the allies picked (F-069). */
  useFeature?: (feature: string, allies: string[]) => void;
  /** Everyone else in the party, for picking allies within range. */
  party?: string[];
}): JSX.Element {
  const term = useTerm();
  const conditions = (Array.isArray(state.conditions) ? state.conditions : []) as string[];
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
      <p className="line">
        {sheet.classes === undefined
          ? sheet.line
          : [
              ...(sheet.species === null ? [] : [term('species', sheet.species)]),
              sheet.classes
                .map((c) => `${term('class', c.name)} ${c.levels}${c.archetype === undefined ? '' : ` · ${term('archetype', c.archetype)}`}`)
                .join(' / '),
            ].join(' · ')}
      </p>

      <div className="big">
        <span className={hpClass}>
          <b>{left}</b>
          <small>
            з <Why sheet={sheet} what="hitPoints" signedTotal={false}>{sheet.maxHitPoints}</Why> ХП
            {temporary > 0 ? ` +${temporary}` : ''}
          </small>
        </span>
        <span>
          <b><Why sheet={sheet} what="armorClass" signedTotal={false}>{sheet.armorClass}</Why></b>
          <small>КБ</small>
        </span>
        <span>
          <b><Why sheet={sheet} what="initiative" signedTotal>{signed(sheet.initiative)}</Why></b>
          <small>ініціатива</small>
        </span>
        <span>
          <b><Why sheet={sheet} what="passivePerception" signedTotal={false}>{sheet.passivePerception}</Why></b>
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
              <td key={key}>
                <Why sheet={sheet} what={`ability:${key}`} signedTotal={false}>
                  {signed(sheet.abilityModifiers[key] ?? 0)}
                </Why>
              </td>
            ))}
          </tr>
          <tr className="saves">
            {ABILITY_SHORT.map(({ key }) => (
              <td key={key}>
                <Why sheet={sheet} what={`save:${key}`} signedTotal>
                  {signed(sheet.savingThrows[key] ?? 0)}
                </Why>
                <RollMode mode={sheet.rollModes?.[`save:${key}`]} />
              </td>
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
          {sheet.attacks.map((a, i) => (
            <li key={a.name}>
              <span className="what"><TermLink kind="weapon" english={a.name}>{term('weapon', a.name)}</TermLink></span>
              <span className="hit">
                <Why sheet={sheet} what={`attack:${i}`} signedTotal>{signed(a.toHit)}</Why>
                <RollMode mode={sheet.rollModes?.[`attack:${i}`]} />
              </span>
              <span className="dmg">
                {a.damageType === undefined ? a.damage : (
                  <>
                    {a.damageDice} <TermLink kind="damage" english={a.damageType}>{term('damage', a.damageType)}</TermLink>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {sheet.maneuvers.length > 0 && (
        <ul className="maneuvers">
          {sheet.maneuvers.map((m) => (
            <li key={m.name}>
              <span className="what"><TermLink kind="maneuver" english={m.name}>{term('maneuver', m.name)}</TermLink></span>
              <span className="cost">{m.cost === 0 ? '—' : `${m.cost} куб.`}</span>
              {m.saveDC !== null && <span className="dc">DC {m.saveDC}</span>}
            </li>
          ))}
        </ul>
      )}

      <HandEdits sheet={sheet} />

      {(sheet.skills?.length ?? 0) > 0 && (
        <details className="skills">
          <summary>Навички</summary>
          <ul>
            {sheet.skills.map((k) => (
              <li key={k.name} className={k.proficiency === 'none' ? undefined : 'proficient'}>
                <span className="what"><TermLink kind="skill" english={k.name}>{term('skill', k.name)}</TermLink></span>
                <Why sheet={sheet} what={`skill:${k.name}`} signedTotal>{signed(k.modifier)}</Why>
                <RollMode mode={sheet.rollModes?.[`skill:${k.name}`]} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {left === 0 && <p className="down-line">Без свідомості · {deathSavesText(state)}</p>}
      {companion !== undefined && <CompanionBlock {...companion} />}
      <Effects
        list={(Array.isArray(state.holotableEffects) ? state.holotableEffects : []) as HolotableEffect[]}
        weapons={sheet.attacks}
        {...(setEffects === undefined ? {} : { set: setEffects })}
        {...(items === undefined ? {} : { items })}
        {...(state.holotableItemsUsed === undefined ? {} : { used: state.holotableItemsUsed })}
        {...(useItem === undefined ? {} : { use: useItem })}
        spend={false}
      />
      {useFeature !== undefined && (sheet?.featureEffects ?? []).map((f) => (
        <FeatureButton key={f.feature} feature={f} allies={party.filter((p) => p !== slug)} use={(allies) => useFeature(f.feature, allies)} />
      ))}
      <ExhaustionLine level={exhaustion} />
      {setConditions !== undefined ? (
        <Conditions list={conditions} choices={conditionChoices ?? []} set={setConditions} />
      ) : (
        conditions.length > 0 && (
          <p className="conditions">
            {conditions.map((c, i) => (
              <span key={c}>
                {i > 0 && ', '}
                <TermLink kind="condition" english={c}>{term('condition', c)}</TermLink>
              </span>
            ))}
          </p>
        )
      )}
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
