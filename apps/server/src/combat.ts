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
// The engine is a plain source folder, not a workspace package (see sheets.ts).
import { monsterSaves } from '../../../packages/engine/src/monsters.js';
import { computeShip, enemyShip, type ComputedShip } from '../../../packages/engine/src/index.js';
import {
  checkDeclaredTotal,
  checkInitiativeRoll,
  effectsAtRound,
  enemyStatus,
  MAX_ENEMIES_AT_ONCE,
  initiativeOrder,
  nextTurn,
  shipDamage,
  shipMaxima,
  whoCounts,
  MAX_SHIPS_AT_ONCE,
  type Author,
  type EnemyShipSize,
  type ShipState,
  type ShipSummary,
  type CombatEvent,
  type CombatState,
  type CompanionSummary,
  type EnemyInfo,
  type EnemySave,
  type Fighter,
  type HolotableEffect,
  type LastAttack,
  type SheetSummary,
  type WhoCounts,
} from '@holotable/protocol';
import type { Log } from './log.js';

export class CombatTracker {
  private fighting = false;
  /** A fight between ships (F-123), as the line that started it says. */
  private space = false;
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
  private readonly enemies = new Map<string, {
    monster: string; number: number; hp?: number; lost: number; conditions: string[];
    /** Effects on this creature (F-084), the same shape the party's have. */
    effects: HolotableEffect[];
    /** An enemy ship (F-124): what it was generated from, and its state now. */
    ship?: { name: string; size: EnemyShipSize; tier: number; state: ShipState };
  }>();

  constructor(
    private readonly log: Log,
    private readonly sheets: Record<string, SheetSummary>,
    /** Read live, not copied: the GM flips the switch mid-fight and it must take. */
    private readonly counts: () => Record<string, WhoCounts> = () => ({}),
    /** The bestiary. Without it no enemy can come in; the party still fights. */
    private readonly compendium?: Compendium,
    /** Companions (F-039): each fights alongside its owner, on one line of the order. */
    private readonly companions: Record<string, CompanionSummary> = {},
  ) {
    for (const event of log.readAll().combat) this.replay(event);
  }

  /** The fight as every screen sees it, or null when nobody is fighting. */
  view(): CombatState | null {
    if (!this.fighting) return null;
    return {
      round: this.round,
      turn: this.turn,
      ...(this.space ? { space: true } : {}),
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
  start(author: Author, characters: string[], space = false): CombatEvent {
    return this.write({ type: 'combat.started', author, characters: [...characters], ...(space ? { space: true } : {}) });
  }

  /**
   * One person's d20, and the sum they worked out when they are the one counting. The
   * caller has already checked they are allowed to send it.
   */
  roll(author: Author, character: string, roll: number, said?: number): CombatEvent | string {
    if (!this.fighting) return 'бою немає — спершу почни бій';
    const isEnemy = this.enemies.has(character);
    const pet = this.companions[character];
    const isCompanion = pet !== undefined && this.characters.includes(pet.owner);
    if (!this.characters.includes(character) && !isEnemy && !isCompanion) return 'цього персонажа немає в бою';
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
    if (now === null) return 'бою немає — спершу почни бій';
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
    const ownWeapon = (this.sheets[character]?.attacks ?? []).some((a) => a.name === weapon);
    const shipGun = this.space && this.shipWeapons(character).some((w) => w.name === weapon);
    if (!ownWeapon && !shipGun) return 'такої атаки на листі немає';
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
    // A ship's gun (F-125): the ship's weapon modifier plus the gunner's proficiency.
    const gun = this.space ? this.shipWeapons(a.character).find((w) => w.name === a.weapon) : undefined;
    const bonus = gun !== undefined
      ? gun.toHit + (this.sheets[a.character]?.proficiencyBonus ?? 0)
      : this.sheets[a.character]?.attacks.find((x) => x.name === a.weapon)?.toHit;
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
    if (!this.fighting) return 'бою немає — спершу почни бій';
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

  /**
   * Enemy ships come into a space fight (F-124), generated by the book from a size and a
   * tier. Only that goes into the log; the numbers are worked out from it each time.
   */
  addEnemyShips(author: Author, size: EnemyShipSize, tier: number, count: number, name = 'Ворожий корабель'): CombatEvent | string {
    if (!this.fighting) return 'бою немає — спершу почни бій';
    if (!this.space) return 'ворожі кораблі — лише в космічному бою';
    if (this.compendium === undefined) return 'немає даних книги';
    if (count < 1 || count > MAX_SHIPS_AT_ONCE) return `скільки — від 1 до ${MAX_SHIPS_AT_ONCE}`;
    const taken = [...this.enemies.values()].filter((e) => e.ship?.name === name).map((e) => e.number);
    const first = (taken.length === 0 ? 0 : Math.max(...taken)) + 1;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ship';
    const ships = Array.from({ length: count }, (_, i) => ({
      id: `enemy-ship-${slug}-${this.enemies.size + i + 1}-${first + i}`, name, number: first + i, size, tier,
    }));
    return this.write({ type: 'combat.enemy-ships-added', author, ships });
  }

  private readonly shipCache = new Map<string, ComputedShip>();

  /**
   * The guns of the ship a character sits in (F-125), with the ship's own attack
   * modifier. Set by the server; in a space fight a crew member may fire them.
   */
  shipWeapons: (character: string) => { name: string; toHit: number }[] = () => [];

  /** An enemy ship's numbers, from its size and tier by the same engine as the party's ship. */
  private shipSummaryOf(ship: { size: EnemyShipSize; tier: number }): ComputedShip {
    const key = `${ship.size}-${ship.tier}`;
    let found = this.shipCache.get(key);
    if (found === undefined) {
      found = computeShip(enemyShip(this.compendium as Compendium, ship.size, ship.tier, 'enemy', 'enemy'), this.compendium as Compendium);
      this.shipCache.set(key, found);
    }
    return found;
  }

  /** Damage (positive) or healing (negative), never past zero or past the maximum. */
  damage(author: Author, id: string, amount: number): CombatEvent | string {
    const enemy = this.fighting ? this.enemies.get(id) : undefined;
    if (enemy === undefined) return 'такого ворога в бою немає';
    // A ship takes a hit as the book deals it: armour, shields first, then the hull (F-124).
    if (enemy.ship !== undefined) {
      const summary = this.shipSummaryOf(enemy.ship) as unknown as ShipSummary;
      const now = enemy.ship.state;
      const changes: ShipState = amount > 0
        ? shipDamage(now, summary, amount, { attack: true }).changes
        : { hullPointsLost: Math.max(0, (now.hullPointsLost ?? 0) + amount) };
      const next = { ...now, ...changes };
      if (JSON.stringify(next) === JSON.stringify(now)) return amount > 0 ? 'корабель уже знешкоджений' : 'корабель і так цілий';
      return this.write({ type: 'combat.enemy-ship', author, enemy: id, shipTo: next });
    }
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

  /**
   * The effects on one enemy, the whole list (F-084) — checked by the caller, as the
   * conditions are. Before and after both go in the log, so undo costs nothing.
   */
  setEffects(author: Author, id: string, effects: HolotableEffect[]): CombatEvent | string {
    const enemy = this.fighting ? this.enemies.get(id) : undefined;
    if (enemy === undefined) return 'такого ворога в бою немає';
    if (JSON.stringify(enemy.effects) === JSON.stringify(effects)) return 'нічого не змінилось';
    return this.write({ type: 'combat.enemy-effects', author, enemy: id, effectsFrom: [...enemy.effects], effectsTo: effects });
  }

  /**
   * Effects counted in rounds, or lasting until someone's next turn, end by themselves
   * when that moment comes — exactly as the party's do (F-067, F-074). Called after the
   * turn moves on; one line in the log per creature that lost something.
   */
  expireEffects(author: Author, round: number, turn: string | null): CombatEvent[] {
    const out: CombatEvent[] = [];
    for (const [id, enemy] of [...this.enemies]) {
      const after = effectsAtRound(enemy.effects, round, turn);
      if (after.length === enemy.effects.length) continue;
      out.push(this.write({
        type: 'combat.enemy-effects', author, enemy: id,
        effectsFrom: [...enemy.effects], effectsTo: after,
      }));
    }
    return out;
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

  private maxHpOf(enemy: { monster: string; hp?: number; ship?: { size: EnemyShipSize; tier: number } }): number {
    if (enemy.ship !== undefined) return this.shipSummaryOf(enemy.ship).hull.max;
    if (enemy.hp !== undefined) return enemy.hp;
    const hit = this.monsterOf(enemy.monster)?.['hitPoints'] as { average?: number } | undefined;
    return Math.max(1, hit?.average ?? 1);
  }

  /** An enemy ship as a line of the order (F-124): hull as its hit points, shields beside. */
  private shipOf(id: string, ship: { name: string; size: EnemyShipSize; tier: number; state: ShipState }, number: number, conditions: string[]): Fighter {
    const summary = this.shipSummaryOf(ship);
    const max = shipMaxima(summary as unknown as ShipSummary, ship.state);
    const hull = Math.max(0, max.hull - (ship.state.hullPointsLost ?? 0));
    const shields = Math.max(0, max.shields - (ship.state.shieldPointsLost ?? 0));
    const modifier = summary.abilities['Dexterity']?.modifier ?? 0;
    const thrown = this.rolls.get(id);
    const roll = thrown?.roll ?? null;
    const info: EnemyInfo = {
      key: '',
      ac: summary.armorClass,
      hp: hull,
      maxHp: max.hull,
      hpFrom: 'average',
      hpRoll: `${summary.hull.dice.count}${summary.hull.dice.size}`,
      challenge: `тір ${ship.tier}`,
      speed: summary.speed === null ? '' : String(summary.speed),
      // A crewed gun: the ship's weapon ability plus a gunner's proficiency (+2 at the start).
      attacks: summary.weapons.map((w) => ({
        name: w.name, toHit: summary.weaponAbilityModifier + 2,
        text: `${w.damage} ${w.damageType}${w.range === null ? '' : ` · ${w.range.normal}/${w.range.long}`} · атака: модифікатор зброї корабля ${summary.weaponAbilityModifier >= 0 ? '+' : ''}${summary.weaponAbilityModifier} і навідник +2`,
      })),
      saves: Object.entries(summary.savingThrows).map(([ability, t]) => ({ ability, base: t.modifier, effect: 0, modifier: t.modifier, book: t.proficient })),
      effects: [],
      ship: { size: ship.size, tier: ship.tier, role: summary.role, shields, maxShields: max.shields, damageReduction: summary.damageReduction },
    };
    return {
      id, kind: 'enemy', character: '', name: `${ship.name} ${number}`,
      modifier, roll, total: roll === null ? null : roll + modifier, said: null, counts: 'app', dexterity: modifier,
      number, status: enemyStatus(hull, max.hull), enemy: info, conditions: [...conditions],
    };
  }

  /** An enemy built from the bestiary, the way a party member is built from the sheet. */
  private enemyOf(id: string): Fighter {
    const own = this.enemies.get(id);
    if (own?.ship !== undefined) return this.shipOf(id, own.ship, own.number, own.conditions);
    const enemy = this.enemies.get(id) as {
      monster: string; number: number; hp?: number; lost: number; conditions: string[]; effects: HolotableEffect[];
    };
    const doc = this.monsterOf(enemy.monster);
    const abilities = doc?.['abilities'] as Record<string, { modifier?: number }> | undefined;
    // Effects (F-084) are applied where the creature's own line shows a number, and
    // nowhere else: the six saves, armour class, initiative, its attacks.
    const bonusFor = (target: string): number => enemy.effects
      .filter((e) => e.target === target && e.bonus !== undefined)
      .reduce((sum, e) => sum + (e.bonus ?? 0), 0);
    const modeFor = (target: string): 'advantage' | 'disadvantage' | 'both' | undefined => {
      let mode: 'advantage' | 'disadvantage' | 'both' | undefined;
      for (const e of enemy.effects) {
        if (e.target !== target || e.mode === undefined) continue;
        mode = mode === undefined || mode === e.mode ? e.mode : 'both';
      }
      return mode;
    };
    const modifier = (abilities?.['dexterity']?.modifier ?? 0) + bonusFor('initiative');
    const thrown = this.rolls.get(id);
    const roll = thrown?.roll ?? null;
    const maxHp = this.maxHpOf(enemy);
    const hp = maxHp - enemy.lost;
    const name = String(doc?.name ?? enemy.monster);
    const behaviors = (doc?.['behaviors'] as { name?: string; attackType?: string; attackBonus?: number; description?: string }[] | undefined) ?? [];
    const saves: EnemySave[] = monsterSaves(doc).map((save) => {
      const effect = bonusFor(`save:${save.ability}`);
      const mode = modeFor(`save:${save.ability}`);
      return {
        ability: save.ability,
        base: save.modifier,
        effect,
        modifier: save.modifier + effect,
        book: save.book,
        ...(save.unclear === true ? { unclear: true } : {}),
        ...(mode === undefined ? {} : { mode }),
      };
    });
    const attackEffect = bonusFor('attacks');
    const attackMode = modeFor('attacks');
    const initiativeMode = modeFor('initiative');
    const info: EnemyInfo = {
      key: enemy.monster,
      ac: Number((doc?.['armor'] as { class?: number } | undefined)?.class ?? 10) + bonusFor('armorClass'),
      hp,
      maxHp,
      hpFrom: enemy.hp === undefined ? 'average' : 'gm',
      hpRoll: String((doc?.['hitPoints'] as { roll?: string } | undefined)?.roll ?? ''),
      challenge: String(doc?.['challengeRating'] ?? ''),
      speed: String((doc?.['speed'] as { text?: string } | undefined)?.text ?? ''),
      attacks: behaviors
        .filter((b) => b.attackType !== undefined && b.attackType !== 'none')
        .map((b) => ({
          name: String(b.name ?? ''),
          toHit: (b.attackBonus ?? 0) + attackEffect,
          text: String(b.description ?? ''),
          ...(attackMode === undefined ? {} : { mode: attackMode }),
        })),
      saves,
      effects: [...enemy.effects],
      ...(initiativeMode === undefined ? {} : { initiativeMode }),
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
    // A companion rolls its own die and the two act on the lesser result (F-039).
    const pet = Object.values(this.companions).find((c) => c.owner === slug);
    const petThrow = pet === undefined ? undefined : this.rolls.get(pet.slug);
    const petRoll = petThrow?.roll ?? null;
    return {
      id: slug,
      kind: 'character',
      character: slug,
      ...(pet === undefined
        ? {}
        : {
            companion: {
              id: pet.slug,
              name: pet.name,
              modifier: pet.initiative,
              roll: petRoll,
              total: petRoll === null ? null : petRoll + pet.initiative,
              said: petThrow?.said ?? null,
            },
          }),
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
        this.space = event.space === true;
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
          this.enemies.set(e.id, {
            monster: e.monster, number: e.number, ...(e.hp === undefined ? {} : { hp: e.hp }),
            lost: 0, conditions: [], effects: [],
          });
        }
        break;
      case 'combat.enemy-ships-added':
        for (const s of event.ships ?? []) {
          this.enemies.set(s.id, {
            monster: '', number: s.number, lost: 0, conditions: [], effects: [],
            ship: { name: s.name, size: s.size, tier: s.tier, state: {} },
          });
        }
        break;
      case 'combat.enemy-ship': {
        const enemy = event.enemy === undefined ? undefined : this.enemies.get(event.enemy);
        if (enemy?.ship !== undefined && event.shipTo !== undefined) enemy.ship.state = { ...event.shipTo };
        break;
      }
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
      case 'combat.enemy-effects': {
        const enemy = event.enemy === undefined ? undefined : this.enemies.get(event.enemy);
        if (enemy !== undefined) enemy.effects = [...(event.effectsTo ?? [])];
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
