// The scene's NPCs (F-085): the merchant the party is talking to right now.
//
// Built the same way as the fight (F-054): the tracker keeps no truth of its own, every
// change is a line in the log, and replaying those lines after a restart puts the scene
// back exactly as it was (ADR 0002). Appending comes before applying, so no screen is
// ever shown something that is not already on disk.
//
// What this is NOT: a database of NPCs, a generator, or anything that touches a sheet.
// The modifiers are the GM's notes with numbers in them — shown beside the person they
// belong to, never added to anybody's roll, because the app does not know who is doing
// the talking.
import { randomUUID } from 'node:crypto';
import {
  MAX_SCENE_NPCS,
  NPC_NOTES_KEPT,
  npcNoteText,
  npcsFor,
  termKey,
  type Author,
  type NpcEvent,
  type NpcNote,
  type NpcRecord,
  type NpcUndo,
  type SceneNpc,
} from '@holotable/protocol';
import type { Log } from './log.js';

/**
 * How one line of the trace is taken back (F-090). Everything needed is already in the
 * event, because every line carries both sides — that is what ADR 0002 buys.
 */
function undoOf(event: NpcEvent): NpcUndo | null {
  if (event.type === 'npc.scene-cleared') {
    const back = event.cleared ?? [];
    return back.length === 0 ? null : { kind: 'restore', npcs: back };
  }
  if (event.was !== undefined) return { kind: 'set', npc: event.was };
  // An NPC who had just come into the scene: taking that back means sending him away.
  if (event.type === 'npc.set' && event.npc !== undefined) return { kind: 'remove', npc: event.npc.id };
  return null;
}

export class SceneNpcs {
  /** In the order they came into the scene. */
  private readonly people = new Map<string, NpcRecord>();
  /**
   * The lines themselves, kept as the events they came from: the words are made when
   * they are asked for (the glossary may have changed since), and the event already
   * holds both sides, which is what an undo needs (F-090).
   */
  private readonly trace: NpcEvent[] = [];

  constructor(
    private readonly log: Log,
    /**
     * The owner's glossary, read live: a skill renamed mid-session must show its new
     * name in the trace too (F-025, F-033).
     */
    private readonly glossary: () => Record<string, string> = () => ({}),
  ) {
    // THIS session's lines only, unlike character state and unlike the fight. A scene
    // belongs to one evening: "the scene is over — the list is gone" is the feature's
    // own boundary (F-085), and reading every session would bring last month's merchant
    // back onto the GM's screen — and his name onto the players' phones.
    for (const event of log.read().npcs) this.replay(event);
  }

  /** The scene as one screen may see it: the GM everything, a player the shown names. */
  view(role: 'gm' | 'player'): SceneNpc[] {
    return npcsFor([...this.people.values()], role);
  }

  /**
   * What the GM's feed shows about NPCs, oldest first. Rebuilt from the log, and put
   * into words here rather than when the line was written, so the glossary applies.
   */
  notes(): NpcNote[] {
    const terms = this.glossary();
    const skill = (english: string): string => terms[termKey('skill', english)] ?? english;
    // Only the tail travels: the feed shows a handful, and a whole evening of lines on
    // every change would be sent again and again for nothing (F-090).
    return this.trace.slice(-NPC_NOTES_KEPT).map((event) => {
      const before = event.was ?? null;
      const after = event.type === 'npc.set' ? (event.npc ?? null) : null;
      const undo = undoOf(event);
      return {
        at: event.at,
        text: npcNoteText(before, after, skill),
        ...(undo === null ? {} : { undo }),
      };
    });
  }

  /** One NPC as he is now — the server needs him to merge two screens' edits (F-090). */
  get(id: string): NpcRecord | undefined {
    return this.people.get(id);
  }

  has(id: string): boolean {
    return this.people.has(id);
  }

  /** An NPC comes into the scene, or is written over whole. Checked by the caller. */
  set(author: Author, npc: NpcRecord): NpcEvent | string {
    const was = this.people.get(npc.id);
    if (was === undefined && this.people.size >= MAX_SCENE_NPCS) return `у сцені не більше ${MAX_SCENE_NPCS} НПС`;
    if (was !== undefined && JSON.stringify(was) === JSON.stringify(npc)) return 'нічого не змінилось';
    return this.write({ type: 'npc.set', author, npc, ...(was === undefined ? {} : { was }) });
  }

  /** This NPC leaves. The log keeps that he was here and what he was like. */
  remove(author: Author, id: string): NpcEvent | string {
    const was = this.people.get(id);
    if (was === undefined) return 'такого НПС у сцені немає';
    return this.write({ type: 'npc.removed', author, npcId: id, was });
  }

  /** The scene is over: everyone out, one line in the log. */
  clear(author: Author): NpcEvent | string {
    if (this.people.size === 0) return 'у сцені нікого немає';
    return this.write({ type: 'npc.scene-cleared', author, cleared: [...this.people.values()] });
  }

  /** Whether anybody is in the scene — the session's closing asks before clearing it. */
  get count(): number {
    return this.people.size;
  }

  private write(part: Omit<NpcEvent, 'id' | 'at'>): NpcEvent {
    const event: NpcEvent = { id: randomUUID(), at: Date.now(), ...part };
    this.log.append(event);
    this.replay(event);
    return event;
  }

  private replay(event: NpcEvent): void {
    switch (event.type) {
      case 'npc.set':
        if (event.npc !== undefined) {
          this.people.set(event.npc.id, event.npc);
          this.trace.push(event);
        }
        break;
      case 'npc.removed':
        if (event.npcId !== undefined) {
          this.people.delete(event.npcId);
          this.trace.push(event);
        }
        break;
      case 'npc.scene-cleared':
        this.people.clear();
        this.trace.push(event);
        break;
    }
  }
}
