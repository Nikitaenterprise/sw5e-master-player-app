// Link to the server: socket, reconnection, and all the state that arrives.
//
// The client never considers itself the source of truth (ADR 0002). It sends
// intents and listens for events. If the socket drops it reconnects on its own,
// because nobody at the table should reload a phone page over a two-second wifi dip.
import type {
  Client,
  Role,
  ToServer,
  FromServer,
  GameEvent,
  CharacterState,
} from '@holotable/protocol';

export type Connection =
  | { status: 'connecting' }
  | { status: 'online' }
  | { status: 'dropped'; afterMs: number }
  | { status: 'error'; text: string };

export interface Snapshot {
  connection: Connection;
  me: string;
  clients: Client[];
  characters: Record<string, CharacterState>;
  /** Latest events, newest first. The basis of the GM's notification feed (F-022). */
  events: GameEvent[];
  /** The server's last refusal — so the player can see why it did not work. */
  refusal: string | null;
}

export const EMPTY: Snapshot = {
  connection: { status: 'connecting' },
  me: '',
  clients: [],
  characters: {},
  events: [],
  refusal: null,
};

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
  /** Send an intent to change state. The server decides whether it is allowed. */
  sendChange: (character: string, changes: CharacterState, note?: string) => void;
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

  const update = (part: Partial<Snapshot>): void => {
    snapshot = { ...snapshot, ...part };
    onChange(snapshot);
  };

  const open = (): void => {
    if (closed) return;
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
          update({ connection: { status: 'online' }, me: m.me, clients: m.clients });
          break;
        case 'clients':
          update({ clients: m.clients });
          break;
        case 'state':
          update({ characters: m.characters });
          break;
        case 'event':
          update({
            characters: { ...snapshot.characters, [m.event.character]: m.state },
            events: [m.event, ...snapshot.events].slice(0, 100),
            refusal: null,
          });
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
      if (closed) return;
      attempt += 1;
      const ms = backoff(attempt);
      update({ connection: { status: 'dropped', afterMs: ms } });
      timer = window.setTimeout(open, ms);
    });
  };

  open();

  return {
    sendChange: (whom, changes, note) => {
      if (socket?.readyState !== 1) return;
      const intent: ToServer = {
        type: 'intent',
        character: whom,
        changes,
        ...(note === undefined ? {} : { note }),
      };
      socket.send(JSON.stringify(intent));
    },
    disconnect: () => {
      closed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      socket?.close();
    },
  };
}
