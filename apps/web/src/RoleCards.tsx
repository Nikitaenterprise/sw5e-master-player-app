// The six station cards (F-032): what the person at a station can do, on paper.
//
// A card is printed before the session and handed to the player who takes that station.
// Every line on it is the book's own text (the server reads it out of the archive), and
// where the book says nothing the card says that rather than showing an empty block.
import type { JSX } from 'react';
import { docUrl, type RoleCard, type RoleCardText, type ShipActionCard } from '@holotable/protocol';
import { Markdown } from './markdown.js';

const TEXT = {
  nobody: 'Ніхто не стоїть на цій станції. Нижче — те, що книга дає на першому ранзі.',
  noSheet: 'Листа посади немає, тому свого тут нічого: лише те, що книга дає станції.',
  helm: 'Дії Helm (керування) бере лише пілот. Решту дій бере будь-хто з екіпажу, кому це логічно за столом.',
  noCheck: 'Де перевірки не названо, книга її й не дає: Fire — це звичайна атака, решту вирішує майстер.',
  rankOf: (rank: number): string => `ранг ${rank}`,
  book: 'Станції й дії — з книги Starships of the Galaxy; назви англійською, як у ній (глосарій їх поки не знає, F-091).',
} as const;

function Piece({ piece }: { piece: RoleCardText }): JSX.Element {
  return (
    <div className="role-piece">
      <h4>{piece.name}</h4>
      {piece.powerDie !== undefined && (
        <p className="role-meta">Кубик живлення: {piece.powerDie}</p>
      )}
      {piece.prerequisite !== undefined && (
        <p className="role-meta">Вимога: {piece.prerequisite}</p>
      )}
      <Markdown text={piece.text} />
    </div>
  );
}

/** The actions, short: names and the checks the book states, with Helm marked. */
export function ActionList({ actions }: { actions: ShipActionCard[] }): JSX.Element {
  return (
    <ul className="role-actions">
      {actions.map((a) => (
        <li key={a.name}>
          <b>{a.name}</b>
          {a.pilotOnly && <span className="role-only"> лише пілот</span>}
          {a.checks.length > 0 && <span className="role-meta"> · {a.checks.join(' або ')}</span>}
          {a.parts.length > 0 && (
            <div className="role-parts">
              {a.parts.map((part) => (
                <span key={part.name}>
                  {part.name}
                  {part.checks.length > 0 && ` (${part.checks.join(' або ')})`}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function StationCard({ card, actions }: { card: RoleCard; actions: ShipActionCard[] }): JSX.Element {
  return (
    <article className="role-card">
      <header>
        <h2>
          {card.deployment}
          {card.name !== undefined && <span className="role-who"> — {card.name}</span>}
        </h2>
        {card.role !== '' && <p className="role-role">{card.role}</p>}
        <p className="role-meta">
          {card.rank === null ? TEXT.nobody : TEXT.rankOf(card.rank)}
          {card.specialty && ' · спеціальність'}
        </p>
      </header>

      {card.problems.length > 0 && (
        <section className="role-warnings">
          <ul>{card.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </section>
      )}

      {card.rankFeatures.length > 0 && (
        <section>
          <h3>Здібності станції</h3>
          {card.rankFeatures.map((f) => <Piece key={f.name} piece={f} />)}
        </section>
      )}

      {card.character !== null && card.techniques.length === 0 && card.ventures.length === 0 && (
        <p className="role-meta">{TEXT.noSheet}</p>
      )}

      {card.techniques.length > 0 && (
        <section>
          <h3>{card.word} — узяте</h3>
          {card.techniques.map((t) => <Piece key={t.name} piece={t} />)}
        </section>
      )}

      {card.ventures.length > 0 && (
        <section>
          <h3>Авантюри</h3>
          {card.ventures.map((v) => <Piece key={v.name} piece={v} />)}
        </section>
      )}

      <section>
        <h3>Дії в бою</h3>
        <p className="role-meta">{TEXT.helm}</p>
        <ActionList actions={actions} />
        <p className="role-meta">{TEXT.noCheck}</p>
      </section>

      <footer className="role-foot">
        {TEXT.book}{' '}
        <a href={docUrl('starship-deployment', card.deployment.toLowerCase())}>станція в довіднику</a>
        {' · '}
        <a href={docUrl('starship-rule', 'combat', 'actions-in-combat')}>дії в бою</a>
      </footer>
    </article>
  );
}

export function RoleCards({ cards, actions }: { cards: RoleCard[]; actions: ShipActionCard[] }): JSX.Element {
  return (
    <div className="role-cards">
      {cards.map((card) => <StationCard key={card.deployment} card={card} actions={actions} />)}
    </div>
  );
}
