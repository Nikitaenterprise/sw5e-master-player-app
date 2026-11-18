// Link to the server: socket, reconnection, and all the state that arrives.
//
// The client never considers itself the source of truth (ADR 0002). It sends
// intents and listens for events. If the socket drops it reconnects on its own,
// because nobody at the table should reload a phone page over a two-second wifi dip.
import { rebase, type HomebrewItem, type CompanionSummary, type FightSummary, type CharacterState, type Client, type CombatState, type WhoCounts, type FromServer, type GameEvent, type GlossaryRow, type Intent, type Role, type SessionClosed, type SheetSummary, type StateField, type ToServer } from '@holotable/protocol';

export type Connection =
  | { status: 'connecting' }
  | { status: 'online' }
  | { status: 'dropped'; afterMs: number }
  /** The demo cut this screen's wifi on purpose (F-045); no reconnect until it is back. */
  | { status: 'cut' }
  | { status: 'error'; text: string };

export interface Snapshot {
  connection: Connection;
  me: string;
  clients: Client[];
  characters: Record<string, CharacterState>;
  /** Computed sheets, sent by the server on connect. Never stored (ADR 0003). */
  sheets: Record<string, SheetSummary>;
  /** Latest events, newest first. The basis of the GM's notification feed (F-022). */
  events: GameEvent[];
  /** The server's last refusal — so the player can see why it did not work. */
  refusal: string | null;
  /** Number of the session being played. 0 until the server has said. */
  session: number;
  /** The last session closing, with whether git saved it (F-024). */
  lastClosed: SessionClosed | null;
  /** The four-screen demo: changes go to a throwaway log (F-037). */
  demo: boolean;
  /** Changes pressed but not yet confirmed by the server (F-045). */
  pending: number;
  /** Those changes themselves, oldest first, so the screen can show them at once (F-046). */
  queued: Intent[];
  /** The owner's glossary of game terms (F-025). Empty until the server sends it. */
  glossary: Record<string, string>;
  /** Every term worth translating, for the GM's glossary editor (F-033). */
  glossaryIndex: GlossaryRow[];
  /** A few lines from the book per term, for hover hints (F-051). */
  briefs: Record<string, string>;
  /** What each exhaustion level does, from the book's table (F-056). */
  exhaustionLevels: string[];
  /** Fights of this session that have ended, oldest first (F-059). */
  fights: FightSummary[];
  /** Companions and their state — hit points, conditions (F-039). */
  companions: Record<string, CompanionSummary>;
  companionStates: Record<string, CharacterState>;
  /** The book's sentences on fighting with a companion, verbatim. */
  companionRules: string[];
  /** The last compendium-wide glossary search and what it found (F-052). */
  glossaryFound: { q: string; rows: GlossaryRow[] };
  /** The fight: order, whose turn, which round. Null when there is none (F-054). */
  combat: CombatState | null;
  /** Who adds the modifiers, per character (F-064). Missing means the default. */
  counts: Record<string, WhoCounts>;
  /** Each character's homebrew items with effects, from the owner's file (F-066). */
  homebrew: Record<string, HomebrewItem[]>;
  /** What is wrong with the homebrew file, if anything — shown to the GM. */
  homebrewProblems: string[];
}

export const EMPTY: Snapshot = {
  connection: { status: 'connecting' },
  me: '',
  clients: [],
  characters: {},
  sheets: {},
  events: [],
  refusal: null,
  session: 0,
  lastClosed: null,
  demo: false,
  pending: 0,
  queued: [],
  glossary: {},
  glossaryIndex: [],
  briefs: {},
  exhaustionLevels: [],
  fights: [],
  companions: {},
  companionStates: {},
  companionRules: [],
  homebrew: {},
  homebrewProblems: [],
  glossaryFound: { q: '', rows: [] },
  combat: null,
  counts: {},
};

/**
 * A character as this screen should show it (F-046): what the server confirmed, plus
 * every change pressed here and not yet confirmed, each applied as the difference it
 * is. With no connection the player still sees their −5 HP at once.
 */
export function withQueued(server: CharacterState | undefined, queued: Intent[], character: string): CharacterState | undefined {
  if (server === undefined) return undefined;
  let shown: CharacterState = { ...server };
  for (const intent of queued) {
    if (intent.character !== character) continue;
    shown = { ...shown, ...rebase(shown, intent.base ?? {}, intent.changes) };
  }
  return shown;
}

/** Fields of this character with a change still waiting for the server. */
export function queuedFields(queued: Intent[], character: string): Set<StateField> {
  const fields = new Set<StateField>();
  for (const intent of queued) {
    if (intent.character !== character) continue;
    for (const field of Object.keys(intent.changes) as StateField[]) fields.add(field);
  }
  return fields;
}

/**
 * An intent id. Not crypto.randomUUID: a phone opening http://192.168.x.x is not a
 * secure context, and there that function does not exist.
 */
let counter = 0;
export function intentId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${counter.toString(36)}`;
}

/** What the person was looking at, for exactly the fields they are changing. */
export function baseFor(seen: CharacterState | undefined, changes: CharacterState): CharacterState {
  const base: CharacterState = {};
  if (seen === undefined) return base;
  for (const field of Object.keys(changes) as StateField[]) {
    const value = seen[field];
    if (value !== undefined) base[field] = value;
  }
  return base;
}

/** Reads role and character from the URL: ?as=gm or ?as=player&character=krinzh-dor */
export function roleFromUrl(search: string): { role: Role; character?: string } {
  const p = new URLSearchParams(search);
  const role: Role = p.get('as') === 'gm' ? 'gm' : 'player';
  const character = p.get('character');
  return character === null || character === '' ? { role } : { role, character };
}

/** Pause before the next attempt: grows, but never beyond 5 seconds. */
export function backoff(attempt: number): number {
  return Math.min(5000, 300 * 2 ** Math.max(0, attempt - 1));
}

export interface Controls {
  /**
   * Send an intent to change state. The server decides whether it is allowed. `base` is
   * what the change is relative to; by default, what this screen shows right now.
   */
  sendChange: (character: string, changes: CharacterState, note?: string, base?: CharacterState) => void;
  /** Announce a rest for the whole party. The server refuses it from a player. */
  sendRest: (kind: 'short' | 'long') => void;
  /** Close the session: commit state/ to git and open the next one. GM only. */
  closeSession: () => void;
  /** Set one glossary word; an empty word removes it. GM only (F-033). */
  setTerm: (key: string, value: string) => void;
  /** Look for terms anywhere in the compendium, to translate them. GM only (F-052). */
  searchTerms: (q: string) => void;
  /** Start the fight: the party goes into the turn order. GM only (F-054). */
  startCombat: () => void;
  /**
   * Send what came up on a d20, and the sum the person worked out when they are the one
   * counting (ADR 0007). A player may send only their own character's roll.
   */
  rollInitiative: (character: string, roll: number, said?: number) => void;
  /** Switch who counts for one character: the person or the app. GM only (F-064). */
  setCounts: (character: string, who: WhoCounts) => void;
  /** Move the turn on, or back when a button was pressed too early. GM only. */
  advanceTurn: (direction: 'next' | 'back') => void;
  /** End the fight. The order goes away, nobody's numbers change. GM only. */
  /** End the fight, taking off the conditions the GM ticked (F-059). */
  endCombat: (clear?: { character: string; condition: string }[]) => void;
  /** Bring creatures from the bestiary into the fight; hp only when the GM rolled it (F-055). */
  addEnemies: (monster: string, count: number, hp?: number) => void;
  /** Damage (positive) or heal (negative) one enemy. */
  damageEnemy: (enemy: string, amount: number) => void;
  /** An enemy leaves the fight. */
  removeEnemy: (enemy: string) => void;
  /** The conditions on one enemy, the whole list (F-056). */
  setEnemyConditions: (enemy: string, conditions: string[]) => void;
  /** An attack roll from the "your turn" screen (F-057). */
  attackRoll: (character: string, weapon: string, roll: number, said?: number) => void;
  /** "Turn over" from the phone (F-057). */
  turnDone: () => void;
  /** A death saving throw (F-058). */
  deathSave: (character: string, roll: number, said?: number) => void;
  /**
   * Cut or restore the connection on purpose, as a wifi drop would (the four-screen
   * demo's button). The page stays, and so does its queue of unsent changes.
   */
  setCut: (cut: boolean) => void;
  disconnect: () => void;
}

export function connect(
  role: Role,
  character: string | undefined,
  onChange: (snapshot: Snapshot) => void,
): Controls {
  let snapshot: Snapshot = { ...EMPTY };
  let socket: WebSocket | null = null;
  let timer: number | undefined;
  let closed = false;
  let attempt = 0;
  // Sent only once the server has greeted us and sent the state; until then they wait.
  let ready = false;
  let cut = false;
  // Pressed but not confirmed. Resent on every reconnect until the server acks them —
  // the server applies each id once, so resending never doubles a change (F-045).
  let pending: Intent[] = [];

  const flush = (): void => {
    if (!ready || socket?.readyState !== 1) return;
    for (const intent of pending) socket.send(JSON.stringify(intent));
  };

  const update = (part: Partial<Snapshot>): void => {
    snapshot = { ...snapshot, ...part };
    onChange(snapshot);
  };

  const open = (): void => {
    if (closed || cut) return;
    update({ connection: { status: 'connecting' } });

    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${scheme}//${location.host}`);

    socket.addEventListener('open', () => {
      attempt = 0;
      const hello: ToServer = {
        type: 'hello',
        role,
        ...(character === undefined ? {} : { character }),
      };
      socket?.send(JSON.stringify(hello));
    });

    socket.addEventListener('message', (ev) => {
      let m: FromServer;
      try {
        m = JSON.parse(String(ev.data)) as FromServer;
      } catch {
        return;
      }
      switch (m.type) {
        case 'welcome':
          update({
            connection: { status: 'online' },
            me: m.me,
            clients: m.clients,
            session: typeof m.session === 'number' ? m.session : 0,
            demo: m.demo === true,
          });
          break;
        case 'clients':
          update({ clients: m.clients });
          break;
        case 'state':
          update({ characters: m.characters, companionStates: m.companions ?? {} });
          ready = true;
          flush();
          break;
        case 'ack':
          pending = pending.filter((i) => i.id !== m.intent);
          update({ pending: pending.length, queued: pending });
          break;
        case 'sheets':
          update({ sheets: m.sheets });
          break;
        case 'history':
          // Replaces, never appends: after a reconnect the server's log is the truth,
          // and appending would show every line twice.
          update({ events: [...m.events].reverse().slice(0, 100), fights: m.fights ?? [] });
          break;
        case 'glossary':
          update({ glossary: m.terms });
          break;
        case 'companions':
          update({ companions: m.companions, companionRules: m.rules });
          break;
        case 'homebrew':
          update({ homebrew: m.items, homebrewProblems: m.problems });
          break;
        case 'fight-summary':
          update({ fights: [...snapshot.fights, m.summary] });
          break;
        case 'briefs':
          update({ briefs: m.briefs, exhaustionLevels: m.exhaustion ?? [] });
          break;
        case 'glossary-found':
          update({ glossaryFound: { q: m.q, rows: m.rows } });
          break;
        case 'glossary-index':
          update({ glossaryIndex: m.rows });
          break;
        case 'counts':
          update({ counts: m.counts });
          break;
        case 'combat':
          // Always the whole fight, never a patch: the server is the one that knows the
          // order, and a screen that reconnects mid-fight must not stitch it together.
          update({ combat: m.combat });
          break;
        case 'event':
          // Our own change is now in the server's state: drop it from the queue in the
          // same update, or the screen would count it twice until the ack arrives.
          if (m.event.intent !== undefined) pending = pending.filter((i) => i.id !== m.event.intent);
          update({
            pending: pending.length,
            queued: pending,
            // A companion's change goes to the companions, not into the party (F-039).
            ...(m.event.character in snapshot.companions
              ? { companionStates: { ...snapshot.companionStates, [m.event.character]: m.state } }
              : { characters: { ...snapshot.characters, [m.event.character]: m.state } }),
            events: [m.event, ...snapshot.events].slice(0, 100),
            refusal: null,
          });
          break;
        case 'session-closed':
          // The feed is the session's story; a new session starts with a clean page.
          update({ session: m.opened, lastClosed: m, events: [], fights: [] });
          break;
        case 'refused':
          update({ refusal: m.reason });
          break;
        case 'error':
          update({ connection: { status: 'error', text: m.text } });
          break;
      }
    });

    socket.addEventListener('close', () => {
      ready = false;
      if (closed) return;
      if (cut) {
        update({ connection: { status: 'cut' } });
        return;
      }
      attempt += 1;
      const ms = backoff(attempt);
      update({ connection: { status: 'dropped', afterMs: ms } });
      timer = window.setTimeout(open, ms);
    });
  };

  open();

  return {
    sendChange: (whom, changes, note, base) => {
      // Never dropped on the floor: with no connection the change waits in the queue
      // and goes out on reconnect, applied as a difference onto whatever is true then.
      const intent: Intent = {
        type: 'intent',
        character: whom,
        changes,
        // By default relative to what this screen shows, queued changes included.
        base: base ?? baseFor(withQueued(snapshot.characters[whom] ?? snapshot.companionStates[whom], pending, whom), changes),
        id: intentId(),
        ...(note === undefined ? {} : { note }),
      };
      pending = [...pending, intent];
      update({ pending: pending.length, queued: pending });
      if (ready && socket?.readyState === 1) socket.send(JSON.stringify(intent));
    },
    sendRest: (kind) => {
      if (socket?.readyState !== 1) return;
      const rest: ToServer = { type: 'rest', kind };
      socket.send(JSON.stringify(rest));
    },
    searchTerms: (q) => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = { type: 'glossary-search', q };
      socket.send(JSON.stringify(message));
    },
    // The fight is not queued the way a change is (F-045): a turn order is only
    // meaningful live, and a roll typed with no connection would land in a fight that
    // has since moved on. With no connection these buttons simply do nothing.
    startCombat: () => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = { type: 'combat-start' };
      socket.send(JSON.stringify(message));
    },
    rollInitiative: (whom, roll, said) => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = {
        type: 'combat-roll', character: whom, roll,
        ...(said === undefined ? {} : { said }),
      };
      socket.send(JSON.stringify(message));
    },
    setCounts: (whom, who) => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = { type: 'counts-set', character: whom, who };
      socket.send(JSON.stringify(message));
    },
    advanceTurn: (direction) => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = { type: 'combat-turn', direction };
      socket.send(JSON.stringify(message));
    },
    endCombat: (clear) => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = { type: 'combat-end', ...(clear === undefined || clear.length === 0 ? {} : { clear }) };
      socket.send(JSON.stringify(message));
    },
    addEnemies: (monster, count, hp) => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = { type: 'enemies-add', monster, count, ...(hp === undefined ? {} : { hp }) };
      socket.send(JSON.stringify(message));
    },
    damageEnemy: (enemy, amount) => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = { type: 'enemy-damage', enemy, amount };
      socket.send(JSON.stringify(message));
    },
    attackRoll: (whom, weapon, roll, said) => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = { type: 'attack-roll', character: whom, weapon, roll, ...(said === undefined ? {} : { said }) };
      socket.send(JSON.stringify(message));
    },
    deathSave: (whom, roll, said) => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = { type: 'death-save', character: whom, roll, ...(said === undefined ? {} : { said }) };
      socket.send(JSON.stringify(message));
    },
    turnDone: () => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = { type: 'turn-done' };
      socket.send(JSON.stringify(message));
    },
    setEnemyConditions: (enemy, conditions) => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = { type: 'enemy-conditions', enemy, conditions };
      socket.send(JSON.stringify(message));
    },
    removeEnemy: (enemy) => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = { type: 'enemy-remove', enemy };
      socket.send(JSON.stringify(message));
    },
    setTerm: (key, value) => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = { type: 'glossary-set', key, value };
      socket.send(JSON.stringify(message));
    },
    closeSession: () => {
      if (socket?.readyState !== 1) return;
      const message: ToServer = { type: 'close-session' };
      socket.send(JSON.stringify(message));
    },
    setCut: (on) => {
      if (on === cut) return;
      cut = on;
      if (timer !== undefined) window.clearTimeout(timer);
      if (on) socket?.close();
      else {
        attempt = 0;
        open();
      }
    },
    disconnect: () => {
      closed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      socket?.close();
    },
  };
}
