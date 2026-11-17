// The fight at the table (F-054): who is in it, what each person rolled, whose turn
// it is and which round.
//
// The tracker keeps no numbers of its own. The order is built from the sheets every
// time it is asked for (ADR 0003), and the log holds only decisions: the fight began,
// this came up on a d20, the GM moved the turn on. Replaying those lines after a
// restart puts the table exactly where it was — which is the whole point of ADR 0002.
//
// Appending comes before applying, as it does for character state: a screen is never
// shown something that is not already on disk.
import { randomUUID } from 'node:crypto';
import {
  checkInitiativeRoll,
  initiativeOrder,
  nextTurn,
  type Author,
  type CombatEvent,
  type CombatState,
  type Fighter,
  type SheetSummary,
} from '@holotable/protocol';
import type { Log } from './log.js';

export class CombatTracker {
  private fighting = false;
  private characters: string[] = [];
  private readonly rolls = new Map<string, number>();
  private turn: string | null = null;
  private round = 1;

  constructor(
    private readonly log: Log,
    private readonly sheets: Record<string, SheetSummary>,
  ) {
    for (const event of log.readAll().combat) this.replay(event);
  }

  /** The fight as every screen sees it, or null when nobody is fighting. */
  view(): CombatState | null {
    if (!this.fighting) return null;
    return {
      round: this.round,
      turn: this.turn,
      order: initiativeOrder(this.characters.map((slug) => this.fighterOf(slug))),
    };
  }

  /** Whether this character is in the fight going on now. */
  has(character: string): boolean {
    return this.fighting && this.characters.includes(character);
  }

  /**
   * The fight begins. Starting one while another is on replaces it: at the table that
   * is what "new fight" means, and the previous order is already in the log anyway.
   */
  start(author: Author, characters: string[]): CombatEvent {
    return this.write({ type: 'combat.started', author, characters: [...characters] });
  }

  /** One person's d20. The caller has already checked they are allowed to send it. */
  roll(author: Author, character: string, roll: number): CombatEvent | string {
    if (!this.fighting) return 'бою немає — спершу «Почати бій»';
    if (!this.characters.includes(character)) return 'цього персонажа немає в бою';
    const problem = checkInitiativeRoll(roll);
    if (problem !== null) return problem;
    return this.write({ type: 'combat.rolled', author, character, roll });
  }

  /** Move the turn on, or back. Refused while nobody has rolled: there is no queue yet. */
  move(author: Author, direction: 'next' | 'back'): CombatEvent | string {
    const now = this.view();
    if (now === null) return 'бою немає — спершу «Почати бій»';
    const to = nextTurn(now, direction);
    if (to.turn === now.turn && to.round === now.round) {
      return to.turn === null ? 'ніхто ще не кинув ініціативу' : 'це початок бою, назад нікуди';
    }
    return this.write({ type: 'combat.turn', author, turn: to.turn, round: to.round });
  }

  /** The fight is over. Hit points, pools and conditions stay exactly as they are. */
  end(author: Author): CombatEvent | string {
    if (!this.fighting) return 'бою немає';
    return this.write({ type: 'combat.ended', author });
  }

  /** A fighter built from the sheet: the modifier and the tie-break are computed here. */
  private fighterOf(slug: string): Fighter {
    const sheet = this.sheets[slug];
    const roll = this.rolls.get(slug) ?? null;
    const modifier = sheet?.initiative ?? 0;
    return {
      id: slug,
      kind: 'character',
      character: slug,
      name: sheet?.name ?? slug,
      modifier,
      roll,
      total: roll === null ? null : roll + modifier,
      dexterity: sheet?.abilityModifiers['Dexterity'] ?? 0,
    };
  }

  private write(part: Omit<CombatEvent, 'id' | 'at'>): CombatEvent {
    const event: CombatEvent = { id: randomUUID(), at: Date.now(), ...part };
    this.log.append(event);
    this.replay(event);
    return event;
  }

  private replay(event: CombatEvent): void {
    switch (event.type) {
      case 'combat.started':
        this.fighting = true;
        this.characters = [...(event.characters ?? [])];
        this.rolls.clear();
        this.turn = null;
        this.round = 1;
        break;
      case 'combat.rolled':
        if (event.character !== undefined && event.roll !== undefined) {
          this.rolls.set(event.character, event.roll);
        }
        break;
      case 'combat.turn':
        this.turn = event.turn ?? null;
        if (event.round !== undefined) this.round = event.round;
        break;
      case 'combat.ended':
        this.fighting = false;
        this.characters = [];
        this.rolls.clear();
        this.turn = null;
        this.round = 1;
        break;
    }
  }
}
