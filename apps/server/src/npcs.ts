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
  npcNoteText,
  npcsFor,
  type Author,
  type NpcEvent,
  type NpcNote,
  type NpcRecord,
  type SceneNpc,
} from '@holotable/protocol';
import type { Log } from './log.js';

export class SceneNpcs {
  /** In the order they came into the scene. */
  private readonly people = new Map<string, NpcRecord>();
  private readonly trace: NpcNote[] = [];

  constructor(private readonly log: Log) {
    for (const event of log.readAll().npcs) this.replay(event);
  }

  /** The scene as one screen may see it: the GM everything, a player the shown names. */
  view(role: 'gm' | 'player'): SceneNpc[] {
    return npcsFor([...this.people.values()], role);
  }

  /** What the GM's feed shows about NPCs, oldest first. Rebuilt from the log. */
  notes(): NpcNote[] {
    return [...this.trace];
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
          this.trace.push({ at: event.at, text: npcNoteText(event.was ?? null, event.npc) });
        }
        break;
      case 'npc.removed':
        if (event.npcId !== undefined) {
          this.people.delete(event.npcId);
          this.trace.push({ at: event.at, text: npcNoteText(event.was ?? null, null) });
        }
        break;
      case 'npc.scene-cleared':
        this.people.clear();
        this.trace.push({ at: event.at, text: 'сцена скінчилась — НПС прибрано' });
        break;
    }
  }
}
