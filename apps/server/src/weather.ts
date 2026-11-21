// Weather as an effect of the scene (F-086).
//
// Two halves. The weathers themselves are the owner's home rules and live in a file he
// edits by hand — state/scene/weather.json — read the same way as the homebrew items
// (F-066): a broken file never stops a session, it only says what is wrong and gives
// nothing. Which weather is on right now is a decision, so it is a line in the log
// (ADR 0002) and comes back after a restart like everything else.
//
// What the weather does is NOT written onto anybody's sheet: the effects are handed to
// the engine when a sheet is computed, so turning the weather off puts every number
// back by itself (ADR 0003).
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NPC_NOTES_KEPT,
  checkWeatherFile,
  sceneEffects,
  weatherNoteText,
  type Author,
  type HolotableEffect,
  type SceneEvent,
  type SceneNote,
  type WeatherDef,
  type WeatherFile,
  type WeatherNow,
} from '@holotable/protocol';
import type { Log } from './log.js';

export const weatherFile = (stateDir: string): string => join(stateDir, 'scene', 'weather.json');

/** The owner's file, read and checked. Problems are words for his screen, not throws. */
export function loadWeather(stateDir: string): { file: WeatherFile; problems: string[] } {
  const empty: WeatherFile = { planet: '', always: null, weathers: [] };
  const path = weatherFile(stateDir);
  if (!existsSync(path)) return { file: empty, problems: [] };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { file: empty, problems: [`state/scene/weather.json зламаний (${(error as Error).message}) — погоди немає`] };
  }
  const checked = checkWeatherFile(data);
  if (typeof checked === 'string') return { file: empty, problems: [`state/scene/weather.json: ${checked}`] };
  return { file: checked, problems: [] };
}

export class SceneWeather {
  private now: string | null = null;
  /** Every switch of this session, as the events themselves (F-086, as in F-085). */
  private readonly trace: SceneEvent[] = [];

  constructor(
    private readonly log: Log,
    private readonly file: WeatherFile,
    private readonly problems: string[] = [],
  ) {
    // This session's lines only: a scene belongs to one evening, as its NPCs do (F-085).
    for (const event of log.read().scene) this.replay(event);
  }

  /** What every screen gets — the same for the GM and for a player: the sky is not secret. */
  view(): WeatherNow {
    return {
      planet: this.file.planet,
      now: this.file.weathers.find((w) => w.key === this.now) ?? null,
      always: this.file.always,
      choices: this.file.weathers,
      problems: [...this.problems],
    };
  }

  /**
   * The weather's lines for the GM's feed: what it was, what it became, and how to put
   * it back. The names are read now, so a weather the owner renamed reads anew.
   */
  notes(): SceneNote[] {
    const named = (key: string | null | undefined): WeatherDef | null =>
      (key === null || key === undefined ? null : this.file.weathers.find((w) => w.key === key) ?? null);
    return this.trace.slice(-NPC_NOTES_KEPT).map((event) => ({
      at: event.at,
      text: weatherNoteText(this.file.planet, named(event.was), named(event.weather)),
      undo: { kind: 'weather', weather: event.was ?? null },
    }));
  }

  /** Whether any weather is on — the session's closing asks before turning it off. */
  get on(): boolean {
    return this.now !== null;
  }

  /** What the scene puts on everyone right now, for computing sheets. */
  effects(): HolotableEffect[] {
    return sceneEffects(this.view());
  }

  /** Turn a weather on, or off with null. */
  set(author: Author, weather: string | null): SceneEvent | string {
    if (weather !== null && !this.file.weathers.some((w) => w.key === weather)) {
      return 'такої погоди немає в state/scene/weather.json';
    }
    if (weather === this.now) return 'ця погода вже стоїть';
    return this.write({ type: 'scene.weather', author, weather, was: this.now });
  }

  private write(part: Omit<SceneEvent, 'id' | 'at'>): SceneEvent {
    const event: SceneEvent = { id: randomUUID(), at: Date.now(), ...part };
    this.log.append(event);
    this.replay(event);
    return event;
  }

  private replay(event: SceneEvent): void {
    if (event.type !== 'scene.weather') return;
    this.now = event.weather ?? null;
    this.trace.push(event);
  }
}
