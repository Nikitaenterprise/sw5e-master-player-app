// Weather as an effect of the scene (F-086): one line on every screen, and the GM's
// switch. The weathers come from the owner's own file, so the app names them, counts
// what it can count, and says out loud when a weather has no effects written yet.
import type { JSX } from 'react';
import { effectTargetText, type SceneEffectSpec, type WeatherDef, type WeatherNow } from '@holotable/protocol';
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
 * The scene's weather. With `set` it is the GM's switch; without it — a line that every
 * phone shows, because the sky is not a secret.
 */
export function WeatherBar({
  weather,
  set,
}: {
  weather: WeatherNow | null;
  set?: (key: string | null) => void;
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
