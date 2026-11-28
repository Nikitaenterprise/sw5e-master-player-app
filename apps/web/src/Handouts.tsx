// Handouts (F-071): a letter, a note, a clue the GM hands out — on the phones, not on
// paper. The GM writes it and picks who gets it; each phone shows only what is its own.
import { useState, type JSX } from 'react';
import { HANDOUT_TEXT_MAX, HANDOUT_TITLE_MAX, type Handout } from '@holotable/protocol';
import { name } from './characters.js';
import { whenText } from './feed.js';

/** Who a handout went to, in words. */
export const recipientsText = (to: string[]): string => (to.length === 0 ? 'усім' : to.map(name).join(', '));

/** The GM's desk: write a handout, pick who gets it, see what went out. */
export function HandoutDesk({
  party,
  handouts,
  send,
  withdraw,
  now = Date.now(),
}: {
  party: string[];
  handouts: Handout[];
  send: (title: string, text: string, to: string[]) => void;
  /** Take one back — from these players, or from everyone (F-105). */
  withdraw?: (handout: string, from: string[]) => void;
  now?: number;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [to, setTo] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <section className="handout-desk">
      <h2>Роздатки</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() === '' || text.trim() === '') {
            setProblem('потрібні і назва, і текст');
            return;
          }
          send(title.trim(), text.trim(), to);
          setTitle('');
          setText('');
          setTo([]);
          setProblem(null);
        }}
      >
        <input value={title} maxLength={HANDOUT_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder="назва: Лист від Гора Грота" aria-label="Назва роздатки" />
        <textarea value={text} maxLength={HANDOUT_TEXT_MAX} onChange={(e) => setText(e.target.value)} rows={4} placeholder="текст, як його прочитає гравець" aria-label="Текст роздатки" />
        <div className="handout-to">
          <span>Кому:</span>
          {party.map((slug) => (
            <label key={slug}>
              <input type="checkbox" checked={to.includes(slug)} onChange={(e) => setTo(e.target.checked ? [...to, slug] : to.filter((x) => x !== slug))} />
              {name(slug)}
            </label>
          ))}
          <small>{to.length === 0 ? 'нікого не позначено — отримають усі' : `лише: ${recipientsText(to)}`}</small>
        </div>
        <div className="handout-buttons">
          <button type="submit">надіслати</button>
          {problem !== null && <span className="refusal">{problem}</span>}
        </div>
      </form>
      {handouts.length > 0 && (
        <ul className="handout-sent">
          {[...handouts].reverse().map((h) => {
            // Who still has it: the recipients (or the whole party), minus those it was taken from.
            const holders = (h.to.length === 0 ? party : h.to).filter((slug) => !(h.hiddenFrom ?? []).includes(slug));
            return (
              <li key={h.id} className={h.withdrawn === true ? 'withdrawn' : undefined}>
                <b>{h.title}</b> → {recipientsText(h.to)} <small>· {whenText(h.at, now)}</small>
                {h.withdrawn === true ? (
                  <small> · відкликано в усіх</small>
                ) : (
                  <>
                    {(h.hiddenFrom ?? []).length > 0 && <small> · відкликано в: {(h.hiddenFrom ?? []).map(name).join(', ')}</small>}
                    {withdraw !== undefined && (
                      <span className="buttons">
                        <button type="button" onClick={() => withdraw(h.id, [])}>прибрати в усіх</button>
                        {holders.map((slug) => (
                          <button key={slug} type="button" onClick={() => withdraw(h.id, [slug])}>прибрати в {name(slug)}</button>
                        ))}
                      </span>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The phone: this player's handouts, newest first and open; the older ones folded. */
export function Handouts({ handouts }: { handouts: Handout[] }): JSX.Element | null {
  if (handouts.length === 0) return null;
  return (
    <section className="handouts">
      <h2>Роздатки — {handouts.length}</h2>
      {[...handouts].reverse().map((h, i) => (
        <details key={h.id} className="handout" open={i === 0}>
          <summary>
            {h.title}
            {h.to.length > 0 && <small> · лише тобі{h.to.length > 1 ? ` і ще ${h.to.length - 1}` : ''}</small>}
          </summary>
          <p>{h.text}</p>
        </details>
      ))}
    </section>
  );
}
