// Weather as an effect of the scene (F-086): one line on every screen, and the GM's
// switch. The weathers come from the owner's own file, so the app names them, counts
// what it can count, and says out loud when a weather has no effects written yet.
import { useState, type JSX } from 'react';
import {
  WEATHER_DICE,
  effectTargetText,
  weatherChanges,
  type SceneEffectSpec,
  type WeatherDef,
  type WeatherNow,
  type WeatherWhy,
} from '@holotable/protocol';
import { useTerm } from './terms.js';

/** What one weather gives, in words: "Insight +1 · Perception +1". */
export function weatherEffectsText(effects: SceneEffectSpec[], skill: (english: string) => string): string {
  return effects
    .map((e) => `${effectTargetText(e.target, skill)} ${e.bonus !== undefined ? `${e.bonus > 0 ? '+' : ''}${e.bonus}` : e.mode === 'advantage' ? 'перевага' : 'недолік'}`)
    .join(' · ');
}

function Line({ def, kind }: { def: WeatherDef; kind: 'always' | 'now' }): JSX.Element {
  const term = useTerm();
  const skill = (x: string): string => term('skill', x);
  const what = weatherEffectsText(def.effects, skill);
  return (
    <p className={`weather-line ${kind}`}>
      <b>{def.name}</b>
      {what === '' ? (
        <small className="no-effects"> — ефектів не вписано, за столом вирішує майстер</small>
      ) : (
        <small> — {what}</small>
      )}
      {def.note !== '' && <small className="weather-note"> · {def.note}</small>}
    </p>
  );
}

/**
 * The weather's timer (F-072). The owner's rule lives in his file and is shown here in
 * his own words; the dice are rolled at the table and typed in, because the app rolls
 * nothing for anybody (ADR 0007). Three rolls, the three he named: a d4 on a move
 * between locations, which switches the weather at once; a d6 at initiative 20, where
 * the screen itself says what 1-2 means; and a d4 after that one, which starts next
 * round. The labels are Ukrainian because the GM reads them.
 */
export function WeatherTimer({
  weather,
  roll,
  inFight,
}: {
  weather: WeatherNow;
  roll: (why: WeatherWhy, value: number) => void;
  inFight: boolean;
}): JSX.Element | null {
  const [move, setMove] = useState('');
  const [check, setCheck] = useState('');
  const [queue, setQueue] = useState('');
  if (weather.choices.length === 0) return null;
  const last = Number(check);
  const changing = Number.isInteger(last) && last >= 1 && last <= 6 && weatherChanges(last);
  const send = (why: WeatherWhy, text: string, clear: (v: string) => void): void => {
    const value = Number(text);
    if (!Number.isInteger(value) || value < 1 || value > WEATHER_DICE[why]) return;
    roll(why, value);
    clear('');
  };
  return (
    <div className="weather-timer">
      <h3>Таймер</h3>
      {weather.switching?.note !== undefined && weather.switching.note !== '' && (
        <p className="hint">{weather.switching.note}</p>
      )}
      <div className="add">
        <label>
          перехід між локаціями · d4
          <input
            value={move}
            inputMode="numeric"
            onChange={(e) => setMove(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send('move', move, setMove); }}
          />
        </label>
        <button type="button" onClick={() => send('move', move, setMove)}>поставити</button>
      </div>
      {inFight && (
        <>
          <div className="add">
            <label>
              ініціатива 20 · d6
              <input
                value={check}
                inputMode="numeric"
                onChange={(e) => setCheck(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send('check', check, () => undefined); }}
              />
            </label>
            <button type="button" onClick={() => send('check', check, () => undefined)}>записати</button>
          </div>
          {changing && (
            <div className="add">
              <label>
                яка саме · d4
                <input
                  value={queue}
                  inputMode="numeric"
                  onChange={(e) => setQueue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') send('queue', queue, setQueue); }}
                />
              </label>
              <button type="button" onClick={() => send('queue', queue, setQueue)}>у чергу</button>
            </div>
          )}
          <p className="hint">
            На 1–2 погода змінюється наступного раунду: впиши d6, і якщо вийшло 1–2 — ще d4.
            Застосунок поставить її сам, коли почнеться той раунд.
          </p>
        </>
      )}
      {weather.queued != null && (
        <p className="weather-queued">
          Черга: з раунду {weather.queued.round} стане <b>{weather.queued.weather.name}</b>.
        </p>
      )}
      {!inFight && <p className="hint">Кидки на ініціативі 20 зʼявляться, коли почнеться бій.</p>}
    </div>
  );
}

/**
 * The scene's weather. With `set` it is the GM's switch; without it — a line that every
 * phone shows, because the sky is not a secret.
 */
export function WeatherBar({
  weather,
  set,
  roll,
  inFight = false,
}: {
  weather: WeatherNow | null;
  set?: (key: string | null) => void;
  /** The GM's dice for the timer (F-072); absent on a player's phone. */
  roll?: (why: WeatherWhy, value: number) => void;
  inFight?: boolean;
}): JSX.Element | null {
  if (weather === null) return null;
  const { now, always, choices, problems, planet } = weather;
  if (choices.length === 0 && always === null && problems.length === 0) return null;
  return (
    <section className="weather">
      <h2>Погода{planet === '' ? '' : ` · ${planet}`}</h2>
      {/* What is wrong with the owner's file is the owner's business: a player's phone
          has nothing to do with it (the same line as the GM's own panels keep). */}
      {set !== undefined && problems.map((problem) => (
        <p key={problem} className="refusal">{problem}</p>
      ))}
      {always !== null && <Line def={always} kind="always" />}
      {now === null ? <p className="hint">Погоди немає.</p> : <Line def={now} kind="now" />}
      {set !== undefined && (
        <div className="buttons">
          {choices.map((w) => (
            <button
              key={w.key}
              type="button"
              className={now?.key === w.key ? 'on' : undefined}
              disabled={now?.key === w.key}
              onClick={() => set(w.key)}
            >
              {w.name}
            </button>
          ))}
          <button type="button" disabled={now === null} onClick={() => set(null)}>
            без погоди
          </button>
        </div>
      )}
      {roll !== undefined && <WeatherTimer weather={weather} roll={roll} inFight={inFight} />}
      {set !== undefined && (
        <p className="hint">
          Погоди й те, що вони дають, — у файлі <code>state/scene/weather.json</code>: правиш руками,
          застосунок лише перемикає й рахує вписане. Файл читається при запуску, тому після
          правки перезапусти застосунок (<code>ЗАПУСТИТИ.bat</code>).
        </p>
      )}
    </section>
  );
}
