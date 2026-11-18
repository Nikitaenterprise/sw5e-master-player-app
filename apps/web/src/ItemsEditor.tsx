// The homebrew item editor (F-068): the owner's state/homebrew/items.json without
// typing JSON. Each item — its note, whether it is used up, and its effects — is saved
// with one button, checked by the same rules the server reads the file with, and sent to
// every screen at once: no restart.
//
// What it suggests first is what the table already has: custom equipment in the
// party's sheets that the file does not know yet.
import { useState, type JSX } from 'react';
import {
  checkHomebrewItem,
  effectTargetText,
  effectText,
  EFFECT_TARGETS,
  UNTIL_TEXT,
  type HolotableEffect,
  type HomebrewDef,
} from '@holotable/protocol';
import { useTerm } from './terms.js';

type Effect = HomebrewDef['effects'][number];

const NEW_EFFECT: Effect = { target: 'ability:Dexterity', bonus: 1, until: 'fight' };
export const EMPTY_DEF: HomebrewDef = { note: '', consumable: true, effects: [NEW_EFFECT] };

/** One effect row: what it touches, what it gives, until when. */
function EffectRow({ effect, change, remove }: { effect: Effect; change: (e: Effect) => void; remove: () => void }): JSX.Element {
  const term = useTerm();
  const skill = (x: string): string => term('skill', x);
  const kind = effect.mode ?? 'bonus';
  return (
    <div className="item-effect">
      <select value={effect.target} onChange={(e) => change({ ...effect, target: e.target.value })} aria-label="На що діє">
        {EFFECT_TARGETS.map((t) => (
          <option key={t} value={t}>{effectTargetText(t, skill)}</option>
        ))}
      </select>
      <select
        value={kind}
        aria-label="Що дає"
        onChange={(e) => {
          const { bonus: _b, mode: _m, ...rest } = effect;
          change(e.target.value === 'bonus' ? { ...rest, bonus: 1 } : { ...rest, mode: e.target.value as 'advantage' | 'disadvantage' });
        }}
      >
        <option value="bonus">число</option>
        <option value="advantage">перевага</option>
        <option value="disadvantage">недолік</option>
      </select>
      {kind === 'bonus' && (
        <input type="number" value={effect.bonus ?? ''} aria-label="Бонус" onChange={(e) => change({ ...effect, bonus: Number(e.target.value) })} />
      )}
      <select
        value={effect.until}
        aria-label="До коли"
        onChange={(e) => {
          const until = e.target.value as Effect['until'];
          const { rounds: _r, ...rest } = effect;
          change(until === 'rounds' ? { ...rest, until, rounds: effect.rounds ?? 5 } : { ...rest, until });
        }}
      >
        {(Object.keys(UNTIL_TEXT) as Effect['until'][]).map((u) => (
          <option key={u} value={u}>{UNTIL_TEXT[u]}</option>
        ))}
      </select>
      {effect.until === 'rounds' && (
        <input type="number" value={effect.rounds ?? ''} aria-label="Скільки раундів" onChange={(e) => change({ ...effect, rounds: Number(e.target.value) })} />
      )}
      <button type="button" title="прибрати ефект" aria-label="Прибрати ефект" onClick={remove}>×</button>
    </div>
  );
}

/** One item: its draft, checked before it goes to the server. */
export function ItemForm({
  name,
  def,
  save,
  remove,
}: {
  name: string;
  def: HomebrewDef;
  save: (def: HomebrewDef) => void;
  /** Absent for an item not yet in the file. */
  remove?: () => void;
}): JSX.Element {
  const term = useTerm();
  const skill = (x: string): string => term('skill', x);
  const [draft, setDraft] = useState<HomebrewDef>(def);
  const [problem, setProblem] = useState<string | null>(null);
  const changed = JSON.stringify(draft) !== JSON.stringify(def);
  return (
    <form
      className="item-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        const checked = checkHomebrewItem(name, draft);
        if (typeof checked === 'string') {
          setProblem(checked);
          return;
        }
        setProblem(null);
        save(checked);
      }}
    >
      <h3>{name}</h3>
      <textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="примітка: що робить, як у листі" aria-label="Примітка" rows={2} />
      <label className="item-consumable">
        <input type="checkbox" checked={draft.consumable} onChange={(e) => setDraft({ ...draft, consumable: e.target.checked })} />
        витрачається (мінус один за раз)
      </label>
      {draft.effects.map((e, i) => (
        <EffectRow
          // The rows have no ids of their own; the index is stable while editing one item.
          key={i}
          effect={e}
          change={(next) => setDraft({ ...draft, effects: draft.effects.map((x, j) => (j === i ? next : x)) })}
          remove={() => setDraft({ ...draft, effects: draft.effects.filter((_, j) => j !== i) })}
        />
      ))}
      <p className="item-preview">
        {draft.effects.map((e) => effectText({ ...e, id: '', source: name } as HolotableEffect, skill)).join(' · ')}
      </p>
      <div className="item-buttons">
        <button type="button" onClick={() => setDraft({ ...draft, effects: [...draft.effects, NEW_EFFECT] })}>+ ефект</button>
        <button type="submit" disabled={!changed && remove !== undefined}>зберегти</button>
        {remove !== undefined && (
          <button type="button" className="danger" onClick={() => { if (confirm(`Прибрати «${name}» з файлу?`)) remove(); }}>прибрати предмет</button>
        )}
        {problem !== null && <span className="refusal">{problem}</span>}
      </div>
    </form>
  );
}

export function ItemsEditor({
  items,
  candidates,
  problems,
  save,
  demo = false,
}: {
  items: Record<string, HomebrewDef>;
  candidates: string[];
  problems: string[];
  save: (name: string, def: HomebrewDef | null) => void;
  demo?: boolean;
}): JSX.Element {
  const [adding, setAdding] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const names = Object.keys(items).sort((a, b) => a.localeCompare(b, 'uk'));
  return (
    <section className="items-editor">
      <h2>Хомбрю-предмети — {names.length}</h2>
      <p className="hint">
        Предмет знаходиться в листі за назвою — так, як вона записана в спорядженні. Зберіг —
        гравці бачать зміни одразу, без перезапуску. Ефекти, що вже діють, лишаються до свого кінця.
      </p>
      {demo && <p className="hint">Демо: правки йдуть у копію файлу в .cache/demo — справжні предмети не змінюються.</p>}
      {problems.map((p) => (
        <p key={p} className="refusal">{p}</p>
      ))}
      {candidates.length > 0 && (
        <div className="item-candidates">
          <span>З листів, ще без ефектів:</span>
          {candidates.map((c) => (
            <button key={c} type="button" onClick={() => setAdding(c)}>{c}</button>
          ))}
        </div>
      )}
      <form
        className="item-new"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim() !== '') setAdding(typed.trim());
          setTyped('');
        }}
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="інший предмет — назва, як у листі" aria-label="Назва нового предмета" />
        <button type="submit">додати</button>
      </form>
      {adding !== null && (
        <ItemForm
          key={`new-${adding}`}
          name={adding}
          def={items[adding] ?? EMPTY_DEF}
          save={(def) => {
            save(adding, def);
            setAdding(null);
          }}
        />
      )}
      {names.map((n) => (
        <ItemForm key={`${n}-${JSON.stringify(items[n])}`} name={n} def={items[n] as HomebrewDef} save={(def) => save(n, def)} remove={() => save(n, null)} />
      ))}
    </section>
  );
}
