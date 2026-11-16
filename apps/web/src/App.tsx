import { useEffect, useRef, useState } from 'react';
import type { CharacterState } from '@holotable/protocol';
import {
  connect,
  roleFromUrl,
  EMPTY,
  type Snapshot,
  type Controls,
} from './connection.js';
import { name, LABELS } from './characters.js';

export function App(): JSX.Element {
  const { role, character } = roleFromUrl(location.search);
  const [snapshot, onChange] = useState<Snapshot>(EMPTY);
  const controls = useRef<Controls | null>(null);

  useEffect(() => {
    const k = connect(role, character, onChange);
    controls.current = k;
    return () => k.disconnect();
  }, [role, character]);

  const gm = role === 'gm';
  const header = gm ? 'Екран майстра' : name(character);

  return (
    <main className={gm ? 'gm' : 'player'}>
      <header>
        <h1>{header}</h1>
        <Indicator snapshot={snapshot} />
      </header>

      {snapshot.refusal !== null && <p className="refusal">{snapshot.refusal}</p>}

      {gm ? (
        <section>
          <h2>Партія — {Object.keys(snapshot.characters).length}</h2>
          <div className="cards">
            {Object.entries(snapshot.characters)
              .sort(([a], [b]) => name(a).localeCompare(name(b), 'uk'))
              .map(([slug, state]) => (
                <Card key={slug} slug={slug} state={state} />
              ))}
          </div>
        </section>
      ) : (
        <PlayerSheet character={character} snapshot={snapshot} controls={controls} />
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
        Фаза 1 · F-020. Обчислюваних чисел — максимуму ХП, КБ, сейвів — тут ще немає:
        вони зʼявляться з рушієм правил.
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

  return (
    <section>
      <h2>Мій стан</h2>
      <Managed state={state} sendChange={sendChange} />
    </section>
  );
}

/** Числові поля стану з кроками, якими за столом справді користуються. */
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

function Card({ slug, state }: { slug: string; state: CharacterState }): JSX.Element {
  const conditions = state.conditions;
  return (
    <article className="card">
      <h3>{name(slug)}</h3>
      <div className="numbers">
        <NumberControl label="−ХП" value={state.hitPointsLost} />
        <NumberControl label="тимч." value={state.temporaryHitPoints} />
        <NumberControl label="Сила" value={state.forcePointsUsed} />
        <NumberControl label="Техн." value={state.techPointsUsed} />
        <NumberControl label="Суп." value={state.superiorityDiceUsed} />
        <NumberControl label="Висн." value={state.exhaustion} />
      </div>
      {Array.isArray(conditions) && conditions.length > 0 && (
        <p className="conditions">{conditions.join(', ')}</p>
      )}
    </article>
  );
}

function NumberControl({ label, value }: { label: string; value: unknown }): JSX.Element {
  return (
    <span className="number">
      <b>{typeof value === 'number' ? value : 0}</b>
      <small>{label}</small>
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
    case 'error':
      return <p className="conn bad">помилка: {z.text}</p>;
  }
}
