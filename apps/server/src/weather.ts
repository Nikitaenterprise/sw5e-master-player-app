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
  weatherByRoll,
  weatherChanges,
  weatherNoteText,
  weatherRollText,
  type Author,
  type HolotableEffect,
  type SceneEvent,
  type SceneNote,
  type WeatherDef,
  type WeatherFile,
  type WeatherNow,
  type WeatherWhy,
} from '@holotable/protocol';
import type { Log } from './log.js';

export const weatherFile = (stateDir: string): string => join(stateDir, 'scene', 'weather.json');

/** The owner's file, read and checked. Problems are words for his screen, not throws. */
export function loadWeather(stateDir: string): { file: WeatherFile; problems: string[] } {
  const empty: WeatherFile = { planet: '', always: null, weathers: [], switching: null };
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
  /**
   * A switch the dice have decided but whose round has not come (F-072). The owner's
   * rule: in a fight, on initiative 20 roll d6, and on 1–2 the weather changes NEXT
   * round. So the change waits here, in the log as well, and is applied by the round.
   */
  private queued: { weather: string; round: number } | null = null;
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
    const queuedDef = this.queued === null
      ? null
      : this.file.weathers.find((w) => w.key === this.queued?.weather) ?? null;
    return {
      planet: this.file.planet,
      now: this.file.weathers.find((w) => w.key === this.now) ?? null,
      always: this.file.always,
      choices: this.file.weathers,
      problems: [...this.problems],
      switching: this.file.switching,
      queued: this.queued === null || queuedDef === null ? null : { weather: queuedDef, round: this.queued.round },
    };
  }

  /**
   * The weather's lines for the GM's feed: what it was, what it became, and how to put
   * it back. The names are read now, so a weather the owner renamed reads anew.
   */
  notes(): SceneNote[] {
    const named = (key: string | null | undefined): WeatherDef | null =>
      (key === null || key === undefined ? null : this.file.weathers.find((w) => w.key === key) ?? null);
    return this.trace.slice(-NPC_NOTES_KEPT).map((event) => {
      // A roll that changed nothing still earns a line: at the table the question is
      // not only "what is the weather" but "why did it not change".
      if (event.type !== 'scene.weather') {
        const words = event.type === 'scene.weather-queued'
          ? `${named(event.weather)?.name ?? 'погода'} з раунду ${event.round ?? '?'}`
          : event.note ?? '';
        return {
          at: event.at,
          text: event.roll === undefined
            ? `${this.file.planet === '' ? 'Погода' : `Погода · ${this.file.planet}`}: ${words}`
            : weatherRollText(this.file.planet, event.why ?? 'move', event.roll.value, words),
        };
      }
      const rolled = event.roll === undefined ? '' : ` (d${event.roll.die}=${event.roll.value})`;
      return {
        at: event.at,
        text: weatherNoteText(this.file.planet, named(event.was), named(event.weather)) + rolled,
        undo: { kind: 'weather', weather: event.was ?? null },
      };
    });
  }

  /** Whether any weather is on — the session's closing asks before turning it off. */
  get on(): boolean {
    return this.now !== null;
  }

  /** What the scene puts on everyone right now, for computing sheets. */
  effects(): HolotableEffect[] {
    return sceneEffects(this.view());
  }

  /**
   * A die the GM rolled at the table (F-072). The app never rolls (ADR 0007) and never
   * reads the owner's rule out of his note: it knows only the three rolls he named.
   *   `move`  — d4 on a move between locations: the weather changes now;
   *   `check` — d6 at initiative 20: on 1–2 a change is coming, and that is all it says;
   *   `queue` — d4 after such a check: this weather starts next round.
   */
  roll(author: Author, why: WeatherWhy, value: number, round: number | null): SceneEvent | string {
    if (this.file.weathers.length === 0) return 'у state/scene/weather.json немає погод';
    if (why === 'check') {
      return this.write({
        type: 'scene.weather-roll', author, why, roll: { die: 6, value },
        note: weatherChanges(value) ? 'зміна буде, кидай d4' : 'без зміни',
        ...(round === null ? {} : { round }),
      });
    }
    const wanted = weatherByRoll(this.file, value);
    if (wanted === null) return `кидок ${value} не вказує ні на яку погоду: у файлі ${this.file.weathers.length}`;
    if (why === 'queue') {
      if (round === null) return 'черга погоди — лише в бою: поза боєм вона міняється відразу';
      return this.write({
        type: 'scene.weather-queued', author, weather: wanted.key, roll: { die: 4, value }, why, round: round + 1,
      });
    }
    if (wanted.key === this.now) {
      return this.write({
        type: 'scene.weather-roll', author, why, roll: { die: 4, value }, weather: wanted.key,
        note: `${wanted.name} і так стоїть`, ...(round === null ? {} : { round }),
      });
    }
    return this.write({ type: 'scene.weather', author, weather: wanted.key, was: this.now, roll: { die: 4, value }, why });
  }

  /**
   * The round has come: if the dice queued a switch for it, it happens now. Called by
   * the server when a fight moves to a new round, so the change is not something the GM
   * must remember mid-fight.
   */
  roundStarted(author: Author, round: number): SceneEvent | null {
    const waiting = this.queued;
    if (waiting === null || round < waiting.round) return null;
    this.queued = null;
    const def = this.file.weathers.find((w) => w.key === waiting.weather);
    if (def === undefined) return null;
    if (def.key === this.now) return null;
    return this.write({ type: 'scene.weather', author, weather: def.key, was: this.now, why: 'queue', round });
  }

  /** A fight ended, or the session did: a change nobody will see is dropped out loud. */
  clearQueue(author: Author, why: string): SceneEvent | null {
    if (this.queued === null) return null;
    const def = this.file.weathers.find((w) => w.key === this.queued?.weather);
    this.queued = null;
    return this.write({
      type: 'scene.weather-roll', author, why: 'queue',
      note: `черга скасована (${why})${def === undefined ? '' : `: ${def.name} не настала`}`,
    });
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
    if (event.type === 'scene.weather') {
      this.now = event.weather ?? null;
      // A switch that happened makes an older queue pointless.
      if (event.why === 'queue') this.queued = null;
      this.trace.push(event);
      return;
    }
    if (event.type === 'scene.weather-queued') {
      if (typeof event.weather === 'string' && typeof event.round === 'number') {
        this.queued = { weather: event.weather, round: event.round };
      }
      this.trace.push(event);
      return;
    }
    if (event.type === 'scene.weather-roll') {
      if (event.why === 'queue' && event.roll === undefined) this.queued = null;
      this.trace.push(event);
    }
  }
}
