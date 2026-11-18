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
import type { Compendium, CompendiumDoc } from '@holotable/compendium';
import {
  checkDeclaredTotal,
  checkInitiativeRoll,
  enemyStatus,
  MAX_ENEMIES_AT_ONCE,
  initiativeOrder,
  nextTurn,
  whoCounts,
  type Author,
  type CombatEvent,
  type CombatState,
  type EnemyInfo,
  type Fighter,
  type LastAttack,
  type SheetSummary,
  type WhoCounts,
} from '@holotable/protocol';
import type { Log } from './log.js';

export class CombatTracker {
  private fighting = false;
  private characters: string[] = [];
  /** What each person threw, and the sum they worked out themselves (ADR 0007). */
  private readonly rolls = new Map<string, { roll: number; said?: number }>();
  private turn: string | null = null;
  private round = 1;
  /** The last attack typed on a phone (F-057) — the decision; the sum is rebuilt from the sheet. */
  private attack: { character: string; weapon: string; round: number; roll: number; said?: number } | null = null;
  /**
   * Enemies from the bestiary (F-055), in the order they came in. Only decisions are
   * kept: which creature, its number at the table, hit points the GM rolled by hand,
   * and how many it has lost. AC, attacks and the average come from the book each time.
   */
  private readonly enemies = new Map<string, { monster: string; number: number; hp?: number; lost: number; conditions: string[] }>();

  constructor(
    private readonly log: Log,
    private readonly sheets: Record<string, SheetSummary>,
    /** Read live, not copied: the GM flips the switch mid-fight and it must take. */
    private readonly counts: () => Record<string, WhoCounts> = () => ({}),
    /** The bestiary. Without it no enemy can come in; the party still fights. */
    private readonly compendium?: Compendium,
  ) {
    for (const event of log.readAll().combat) this.replay(event);
  }

  /** The fight as every screen sees it, or null when nobody is fighting. */
  view(): CombatState | null {
    if (!this.fighting) return null;
    return {
      round: this.round,
      turn: this.turn,
      ...(this.attack === null ? {} : { lastAttack: this.lastAttackView(this.attack) }),
      order: initiativeOrder([
        ...this.characters.map((slug) => this.fighterOf(slug)),
        ...[...this.enemies.keys()].map((id) => this.enemyOf(id)),
      ]),
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

  /**
   * One person's d20, and the sum they worked out when they are the one counting. The
   * caller has already checked they are allowed to send it.
   */
  roll(author: Author, character: string, roll: number, said?: number): CombatEvent | string {
    if (!this.fighting) return 'бою немає — спершу «Почати бій»';
    const isEnemy = this.enemies.has(character);
    if (!this.characters.includes(character) && !isEnemy) return 'цього персонажа немає в бою';
    const problem = checkInitiativeRoll(roll);
    if (problem !== null) return problem;
    // For an enemy the GM rolls and the app adds the creature's modifier: ADR 0007 is
    // about a player's own arithmetic, and nobody at the table plays the pirate.
    if (isEnemy && said !== undefined) return 'за ворога суму рахує застосунок';
    if (said !== undefined) {
      const trouble = checkDeclaredTotal(said);
      if (trouble !== null) return trouble;
    }
    return this.write({
      type: 'combat.rolled', author, character, roll,
      ...(said === undefined ? {} : { said }),
    });
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

  /**
   * An attack typed on the "your turn" screen (F-057). Only on one's own turn: an attack
   * typed out of turn is a slip of the finger, not a decision. The GM may type it for
   * whoever is not at the table. Whether it hits is the GM's call — nothing changes here.
   */
  attackRoll(author: Author, character: string, weapon: string, roll: number, said?: number): CombatEvent | string {
    if (!this.fighting) return 'бою немає';
    if (!this.characters.includes(character)) return 'цього персонажа немає в бою';
    if (this.turn !== character && author.kind !== 'gm') return 'зараз не твій хід';
    if (!(this.sheets[character]?.attacks ?? []).some((a) => a.name === weapon)) return 'такої атаки на листі немає';
    const problem = checkInitiativeRoll(roll);
    if (problem !== null) return problem;
    if (said !== undefined) {
      const trouble = checkDeclaredTotal(said);
      if (trouble !== null) return trouble;
    }
    return this.write({
      type: 'combat.attack', author, character, weapon, roll, round: this.round,
      ...(said === undefined ? {} : { said }),
    });
  }

  /** "Turn over" from the phone (F-057): only the one whose turn it is, or the GM. */
  turnDone(author: Author, character: string | undefined): CombatEvent | string {
    if (!this.fighting) return 'бою немає';
    if (author.kind !== 'gm' && (character === undefined || this.turn !== character)) return 'зараз не твій хід';
    return this.move(author, 'next');
  }

  private lastAttackView(a: { character: string; weapon: string; round: number; roll: number; said?: number }): LastAttack {
    const bonus = this.sheets[a.character]?.attacks.find((x) => x.name === a.weapon)?.toHit;
    return {
      character: a.character,
      weapon: a.weapon,
      round: a.round,
      roll: a.roll,
      said: a.said ?? null,
      total: bonus === undefined ? null : a.roll + bonus,
      counts: whoCounts(this.counts(), a.character),
    };
  }

  /** Whether this id is an enemy in the fight going on now. */
  hasEnemy(id: string): boolean {
    return this.fighting && this.enemies.has(id);
  }

  /**
   * Creatures from the bestiary come in — "Pirate ×3". Each gets its own number at the
   * table, continuing from those of the same kind already here, and its own hit points.
   */
  addEnemies(author: Author, monsterKey: string, count: number, hp?: number): CombatEvent | string {
    if (!this.fighting) return 'бою немає — спершу «Почати бій»';
    const doc = this.compendium?.get('monster', monsterKey);
    if (doc === undefined) return 'такої істоти в бестіарії немає';
    if (count < 1 || count > MAX_ENEMIES_AT_ONCE) return `скільки — від 1 до ${MAX_ENEMIES_AT_ONCE}`;
    const taken = [...this.enemies.values()].filter((e) => e.monster === doc.key).map((e) => e.number);
    const first = (taken.length === 0 ? 0 : Math.max(...taken)) + 1;
    const enemies = Array.from({ length: count }, (_, i) => ({
      id: `enemy-${doc.key}-${first + i}`,
      monster: doc.key,
      number: first + i,
      ...(hp === undefined ? {} : { hp }),
    }));
    return this.write({ type: 'combat.enemies-added', author, enemies });
  }

  /** Damage (positive) or healing (negative), never past zero or past the maximum. */
  damage(author: Author, id: string, amount: number): CombatEvent | string {
    const enemy = this.fighting ? this.enemies.get(id) : undefined;
    if (enemy === undefined) return 'такого ворога в бою немає';
    const max = this.maxHpOf(enemy);
    const to = Math.min(max, Math.max(0, enemy.lost + amount));
    if (to === enemy.lost) return amount > 0 ? 'ворог уже знешкоджений' : 'ворог і так цілий';
    return this.write({ type: 'combat.enemy-hp', author, enemy: id, from: enemy.lost, to });
  }

  /** The conditions on one enemy, the whole list (F-056). Checked by the caller. */
  setConditions(author: Author, id: string, conditions: string[]): CombatEvent | string {
    const enemy = this.fighting ? this.enemies.get(id) : undefined;
    if (enemy === undefined) return 'такого ворога в бою немає';
    if (JSON.stringify(enemy.conditions) === JSON.stringify(conditions)) return 'нічого не змінилось';
    return this.write({ type: 'combat.enemy-conditions', author, enemy: id, conditionsFrom: [...enemy.conditions], conditionsTo: [...conditions] });
  }

  /** An enemy leaves the fight. The log keeps that it was here. */
  removeEnemy(author: Author, id: string): CombatEvent | string {
    if (!this.fighting || !this.enemies.has(id)) return 'такого ворога в бою немає';
    // Leaving on its own turn: the turn passes on first, so the queue does not jump back
    // to the top. Two lines in the log, both decisions anyone can read.
    const now = this.view();
    if (now !== null && now.turn === id) {
      const to = nextTurn(now, 'next');
      if (to.turn !== id) this.write({ type: 'combat.turn', author, turn: to.turn, round: to.round });
    }
    return this.write({ type: 'combat.enemy-removed', author, enemy: id });
  }

  private monsterOf(key: string): CompendiumDoc | undefined {
    return this.compendium?.get('monster', key);
  }

  private maxHpOf(enemy: { monster: string; hp?: number }): number {
    if (enemy.hp !== undefined) return enemy.hp;
    const hit = this.monsterOf(enemy.monster)?.['hitPoints'] as { average?: number } | undefined;
    return Math.max(1, hit?.average ?? 1);
  }

  /** An enemy built from the bestiary, the way a party member is built from the sheet. */
  private enemyOf(id: string): Fighter {
    const enemy = this.enemies.get(id) as { monster: string; number: number; hp?: number; lost: number; conditions: string[] };
    const doc = this.monsterOf(enemy.monster);
    const abilities = doc?.['abilities'] as Record<string, { modifier?: number }> | undefined;
    const modifier = abilities?.['dexterity']?.modifier ?? 0;
    const thrown = this.rolls.get(id);
    const roll = thrown?.roll ?? null;
    const maxHp = this.maxHpOf(enemy);
    const hp = maxHp - enemy.lost;
    const name = String(doc?.name ?? enemy.monster);
    const behaviors = (doc?.['behaviors'] as { name?: string; attackType?: string; attackBonus?: number; description?: string }[] | undefined) ?? [];
    const info: EnemyInfo = {
      key: enemy.monster,
      ac: Number((doc?.['armor'] as { class?: number } | undefined)?.class ?? 10),
      hp,
      maxHp,
      hpFrom: enemy.hp === undefined ? 'average' : 'gm',
      hpRoll: String((doc?.['hitPoints'] as { roll?: string } | undefined)?.roll ?? ''),
      challenge: String(doc?.['challengeRating'] ?? ''),
      speed: String((doc?.['speed'] as { text?: string } | undefined)?.text ?? ''),
      attacks: behaviors
        .filter((b) => b.attackType !== undefined && b.attackType !== 'none')
        .map((b) => ({ name: String(b.name ?? ''), toHit: b.attackBonus ?? 0, text: String(b.description ?? '') })),
    };
    return {
      id,
      kind: 'enemy',
      character: '',
      name: `${name} ${enemy.number}`,
      modifier,
      roll,
      total: roll === null ? null : roll + modifier,
      said: null,
      counts: 'app',
      dexterity: modifier,
      monster: name,
      number: enemy.number,
      status: enemyStatus(hp, maxHp),
      enemy: info,
      conditions: [...enemy.conditions],
    };
  }

  /** A fighter built from the sheet: the modifier and the tie-break are computed here. */
  private fighterOf(slug: string): Fighter {
    const sheet = this.sheets[slug];
    const thrown = this.rolls.get(slug);
    const roll = thrown?.roll ?? null;
    const modifier = sheet?.initiative ?? 0;
    return {
      id: slug,
      kind: 'character',
      character: slug,
      name: sheet?.name ?? slug,
      modifier,
      roll,
      // The app's own arithmetic stays here even when the person counted: the GM sees
      // both numbers side by side and decides which one the table goes with (ADR 0007).
      total: roll === null ? null : roll + modifier,
      said: thrown?.said ?? null,
      counts: whoCounts(this.counts(), slug),
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
      case 'combat.attack':
        if (event.character !== undefined && event.weapon !== undefined && event.roll !== undefined) {
          this.attack = {
            character: event.character, weapon: event.weapon, roll: event.roll, round: event.round ?? this.round,
            ...(event.said === undefined ? {} : { said: event.said }),
          };
        }
        break;
      case 'combat.started':
        this.attack = null;
        this.fighting = true;
        this.characters = [...(event.characters ?? [])];
        this.rolls.clear();
        this.enemies.clear();
        this.turn = null;
        this.round = 1;
        break;
      case 'combat.rolled':
        if (event.character !== undefined && event.roll !== undefined) {
          this.rolls.set(event.character, {
            roll: event.roll,
            ...(event.said === undefined ? {} : { said: event.said }),
          });
        }
        break;
      case 'combat.turn':
        this.turn = event.turn ?? null;
        if (event.round !== undefined) this.round = event.round;
        break;
      case 'combat.enemies-added':
        for (const e of event.enemies ?? []) {
          this.enemies.set(e.id, { monster: e.monster, number: e.number, ...(e.hp === undefined ? {} : { hp: e.hp }), lost: 0, conditions: [] });
        }
        break;
      case 'combat.enemy-hp': {
        const enemy = event.enemy === undefined ? undefined : this.enemies.get(event.enemy);
        if (enemy !== undefined && event.to !== undefined) enemy.lost = event.to;
        break;
      }
      case 'combat.enemy-conditions': {
        const enemy = event.enemy === undefined ? undefined : this.enemies.get(event.enemy);
        if (enemy !== undefined) enemy.conditions = [...(event.conditionsTo ?? [])];
        break;
      }
      case 'combat.enemy-removed':
        if (event.enemy !== undefined) {
          this.enemies.delete(event.enemy);
          this.rolls.delete(event.enemy);
          // Whose turn it was must not point at someone who left.
          if (this.turn === event.enemy) this.turn = null;
        }
        break;
      case 'combat.ended':
        this.attack = null;
        this.fighting = false;
        this.characters = [];
        this.rolls.clear();
        this.enemies.clear();
        this.turn = null;
        this.round = 1;
        break;
    }
  }
}
