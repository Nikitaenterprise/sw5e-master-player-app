// The scene's NPCs (F-085): the merchant the party is talking to, his attitude, what he
// wants, and the modifiers this conversation has earned.
//
// The numbers here are shown, never applied. Whether the cigarette the party handed over
// is worth +1 Persuasion, and who is doing the talking, is the GM's business — the app
// keeps the note where it can be seen instead of quietly moving somebody's roll.
import { useState, type JSX } from 'react';
import {
  ATTITUDE_BRIEF_KEY,
  ATTITUDE_RULE,
  ATTITUDE_TEXT,
  MAX_SCENE_NPCS,
  NPC_ATTITUDES,
  NPC_MODIFIER_TARGETS,
  NPC_NAME_MAX,
  NPC_WANTS_MAX,
  effectTargetText,
  npcModifierText,
  ruleUrl,
  type NpcAttitude,
  type NpcModifier,
  type NpcRecord,
  type SceneNpc,
} from '@holotable/protocol';
import { useBriefs, useTerm } from './terms.js';

const newId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A target in the words the screen shows: any check at all, a skill, an ability. */
export function targetText(target: string, skill: (english: string) => string): string {
  return target === 'all' ? 'будь-яка перевірка' : effectTargetText(target, skill);
}

/** One NPC's modifiers, and the GM's short form to add one. */
function Modifiers({
  list,
  set,
}: {
  list: NpcModifier[];
  set: (list: NpcModifier[]) => void;
}): JSX.Element {
  const term = useTerm();
  const skill = (x: string): string => term('skill', x);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('all');
  const [kind, setKind] = useState<'bonus' | 'advantage' | 'disadvantage'>('bonus');
  const [bonus, setBonus] = useState('1');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="npc-modifiers">
      {list.map((m) => (
        <span key={m.id} className="npc-modifier">
          {npcModifierText(m, skill)}
          <button type="button" title="зняти" aria-label={`Зняти модифікатор ${m.source}`} onClick={() => set(list.filter((x) => x.id !== m.id))}>
            ×
          </button>
        </span>
      ))}
      {!open && (
        <button type="button" className="effect-add" onClick={() => setOpen(true)}>
          + модифікатор
        </button>
      )}
      {open && (
        <form
          className="effect-form"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(bonus);
            if (source.trim() === '') {
              setProblem('звідки модифікатор? Наприклад, «цигарка»');
              return;
            }
            if (kind === 'bonus' && (!Number.isInteger(n) || n === 0 || Math.abs(n) > 20)) {
              setProblem('число — ціле від −20 до 20, не нуль');
              return;
            }
            set([...list, {
              id: newId(), source: source.trim(), target,
              ...(kind === 'bonus' ? { bonus: n } : { mode: kind }),
            }]);
            setSource('');
            setOpen(false);
            setProblem(null);
          }}
        >
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="звідки: цигарка" aria-label="Звідки модифікатор" />
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="На що діє">
            {NPC_MODIFIER_TARGETS.map((t) => (
              <option key={t} value={t}>{targetText(t, skill)}</option>
            ))}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Що дає">
            <option value="bonus">число</option>
            <option value="advantage">перевага</option>
            <option value="disadvantage">недолік</option>
          </select>
          {kind === 'bonus' && <input type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} aria-label="Число" />}
          <button type="submit">додати</button>
          <button type="button" onClick={() => setOpen(false)}>скасувати</button>
          {problem !== null && <span className="refusal">{problem}</span>}
        </form>
      )}
    </div>
  );
}

/** The attitude picker, with the book's own sentence on hover and a link to the rule. */
function Attitude({
  value,
  set,
}: {
  value: NpcAttitude;
  set: (attitude: NpcAttitude) => void;
}): JSX.Element {
  const sentence = useBriefs()[ATTITUDE_BRIEF_KEY];
  return (
    <span className="npc-attitude">
      <select value={value} onChange={(e) => set(e.target.value as NpcAttitude)} aria-label="Ставлення">
        {NPC_ATTITUDES.map((a) => (
          <option key={a} value={a}>{ATTITUDE_TEXT[a]}</option>
        ))}
      </select>
      <a
        href={ruleUrl(ATTITUDE_RULE.key, ATTITUDE_RULE.anchor)}
        target="_blank"
        rel="noreferrer"
        {...(sentence === undefined ? {} : { title: sentence })}
      >
        ?
      </a>
    </span>
  );
}

/**
 * The GM's desk for the scene (F-085): who is here, how each of them feels, what each
 * wants, and what this conversation has earned. The "scene is over" button sends
 * everyone away — the list belongs to a scene, not to the campaign.
 */
export function NpcDesk({
  npcs,
  set,
  remove,
  clear,
}: {
  npcs: SceneNpc[];
  set: (npc: NpcRecord) => void;
  remove: (id: string) => void;
  clear: () => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [attitude, setAttitude] = useState<NpcAttitude>('indifferent');
  const [wants, setWants] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const change = (npc: SceneNpc, part: Partial<NpcRecord>): void => {
    if (npc.gm === undefined) return;
    set({ id: npc.id, name: npc.name, ...npc.gm, ...part });
  };
  return (
    <section className="npc-desk">
      <h2>НПС у сцені{npcs.length === 0 ? '' : ` — ${npcs.length}`}</h2>
      <ul className="npc-list">
        {npcs.map((npc) => (
          <li key={npc.id}>
            <span className="npc-head">
              <input
                value={npc.name}
                maxLength={NPC_NAME_MAX}
                onChange={(e) => change(npc, { name: e.target.value })}
                aria-label={`Імʼя: ${npc.name}`}
              />
              {npc.gm !== undefined && <Attitude value={npc.gm.attitude} set={(a) => change(npc, { attitude: a })} />}
              <label className="npc-shown">
                <input
                  type="checkbox"
                  checked={npc.gm?.shown ?? false}
                  onChange={(e) => change(npc, { shown: e.target.checked })}
                />
                видно гравцям
              </label>
              <button
                type="button"
                className="remove"
                title="Пішов зі сцени"
                onClick={() => remove(npc.id)}
              >
                ✕
              </button>
            </span>
            <input
              className="npc-wants"
              value={npc.gm?.wants ?? ''}
              maxLength={NPC_WANTS_MAX}
              onChange={(e) => change(npc, { wants: e.target.value })}
              placeholder="чого хоче: щоб партія вивезла його товар із Міролла"
              aria-label={`Чого хоче ${npc.name}`}
            />
            {npc.gm !== undefined && (
              <Modifiers list={npc.gm.modifiers} set={(modifiers) => change(npc, { modifiers })} />
            )}
          </li>
        ))}
      </ul>
      <form
        className="npc-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() === '') {
            setProblem('потрібне імʼя');
            return;
          }
          if (npcs.length >= MAX_SCENE_NPCS) {
            setProblem(`у сцені не більше ${MAX_SCENE_NPCS} НПС`);
            return;
          }
          set({ id: newId(), name: name.trim(), attitude, wants: wants.trim(), modifiers: [], shown: false });
          setName('');
          setWants('');
          setAttitude('indifferent');
          setProblem(null);
        }}
      >
        <input value={name} maxLength={NPC_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="хто: Торговець Рон" aria-label="Імʼя НПС" />
        <Attitude value={attitude} set={setAttitude} />
        <input value={wants} maxLength={NPC_WANTS_MAX} onChange={(e) => setWants(e.target.value)} placeholder="чого хоче" aria-label="Чого хоче новий НПС" />
        <button type="submit">додати</button>
        {npcs.length > 0 && (
          <button type="button" onClick={() => clear()}>
            Сцена скінчилась
            <small>НПС прибрати</small>
          </button>
        )}
        {problem !== null && <span className="refusal">{problem}</span>}
      </form>
      <p className="hint">
        Числа тут лише показані, не додані: кому саме вони дістались у розмові, вирішуєш
        ти за столом. Гравці бачать лише тих, кому ти поставив «видно гравцям», і тільки імʼя.
      </p>
    </section>
  );
}

/** The phone: who of the scene's people the GM has shown. Names, nothing more. */
export function NpcsInScene({ npcs }: { npcs: SceneNpc[] }): JSX.Element | null {
  if (npcs.length === 0) return null;
  return (
    <p className="npcs-in-scene">
      <b>У сцені:</b> {npcs.map((n) => n.name).join(', ')}
    </p>
  );
}
