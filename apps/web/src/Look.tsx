// The look of the app (F-114): the viewer's own switches for glass and motion, and the
// style guide page that shows every building block in every state.
//
// The switches live in the browser (localStorage): they are a person's comfort, not the
// table's state, so they never go to the server or the log. Safari ignores the system's
// "reduce transparency" for web pages, so the glass switch is here in the app.
import { useState, type JSX } from 'react';

const GLASS_KEY = 'holotable-glass';
const MOTION_KEY = 'holotable-motion';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A private window may refuse storage; the switch still works until the page closes.
  }
}

/** Puts the saved switches on the page before it is drawn, so nothing flickers. */
export function applySavedLook(root: HTMLElement = document.documentElement): void {
  if (read(GLASS_KEY) === 'off') root.dataset['glass'] = 'off';
  if (read(MOTION_KEY) === 'off') root.dataset['motion'] = 'off';
}

/** Two small switches, glass and motion, for any screen. */
export function LookToggles(): JSX.Element {
  const root = typeof document === 'undefined' ? null : document.documentElement;
  const [glass, setGlass] = useState(root?.dataset['glass'] !== 'off');
  const [motion, setMotion] = useState(root?.dataset['motion'] !== 'off');
  const flip = (key: string, attr: 'glass' | 'motion', on: boolean, set: (v: boolean) => void): void => {
    set(on);
    if (root !== null) {
      if (on) delete root.dataset[attr];
      else root.dataset[attr] = 'off';
    }
    write(key, on ? 'on' : 'off');
  };
  return (
    <div className="look-toggles" role="group" aria-label="Вигляд">
      <button type="button" aria-pressed={glass} onClick={() => flip(GLASS_KEY, 'glass', !glass, setGlass)}>
        Скло: {glass ? 'увімкнено' : 'вимкнено'}
      </button>
      <button type="button" aria-pressed={motion} onClick={() => flip(MOTION_KEY, 'motion', !motion, setMotion)}>
        Анімації: {motion ? 'увімкнено' : 'вимкнено'}
      </button>
    </div>
  );
}

const SWATCHES: [string, string][] = [
  ['--bg', 'космос'], ['--text', 'текст'], ['--gold', 'підписи'], ['--amber', 'кубики, основна кнопка'],
  ['--data', 'дані'], ['--effect', 'ефект'], ['--alert', 'тривога'], ['--ok', 'ХП, «готово»'],
];

/** The style guide (F-114): what every screen is built from, in every state. */
export function StyleguidePage(): JSX.Element {
  return (
    <main className="styleguide">
      <header>
        <h1>Бронзова голограма</h1>
        <p className="hint">
          Вітрина дизайн-системи: з цих блоків будуються екрани гравця й майстра. Канон —
          docs/дизайн/ДИЗАЙН-ІНТЕРФЕЙСУ.md, розділ 0; еталон — docs/дизайн/еталон.html.
        </p>
        <LookToggles />
      </header>

      <section className="ds-panel">
        <h2 className="ds-label">Кольори</h2>
        <div className="grid">
          {SWATCHES.map(([token, what]) => (
            <span key={token} className="swatch">
              <i style={{ background: `var(${token})` }} />
              {token} · {what}
            </span>
          ))}
        </div>
      </section>

      <section className="ds-panel">
        <h2 className="ds-label">Термінові смуги</h2>
        <div className="ds-strip live"><b>Бій почався</b><span>Раунд 1 · кинь ініціативу</span></div>
        <div className="ds-strip mail live"><b>Нова роздатка</b><span>від майстра · натисни, щоб прочитати</span></div>
        <div className="ds-strip turn"><b>Твій хід</b><span>Раунд 2 · після тебе — Гаморреанець 1</span></div>
      </section>

      <section className="ds-panel">
        <h2 className="ds-label">Числа й плитки</h2>
        <div className="grid">
          <div className="ds-tile"><span className="ds-label">КБ</span> <span className="ds-num">13</span></div>
          <div className="ds-tile fx"><span className="ds-label">Статура</span> <span className="ds-num">+2</span> <small>13 → 14 · бакта</small></div>
          <div className="ds-tile bad"><span className="ds-label">Боукастер (Bowcaster)</span> <small>Не володієш: кидок з перешкодою</small></div>
        </div>
      </section>

      <section className="ds-panel">
        <h2 className="ds-label">Кнопки й поля</h2>
        <div className="row">
          <button type="button" className="ds-btn">звичайна</button>
          <button type="button" className="ds-btn primary">використати</button>
          <button type="button" className="ds-btn danger">прибрати з бою</button>
          <button type="button" className="ds-btn" disabled>вимкнена</button>
        </div>
        <div className="row">
          <label>
            <span className="ds-label">d20 — що випало</span>
            <input type="number" inputMode="numeric" defaultValue={14} />
          </label>
          <label>
            <span className="ds-label">d20 + модифікатор — разом</span>
            <input type="number" inputMode="numeric" defaultValue={16} />
          </label>
        </div>
      </section>

      <section className="ds-panel">
        <h2 className="ds-label">Ефекти</h2>
        <div className="row">
          <span className="ds-chip">Бакта-інʼєктор: Статура +1 · до довгого відпочинку</span>
          <span className="ds-chip">Бойовий стимулятор: Сила +1 · до твого наступного ходу</span>
        </div>
      </section>
    </main>
  );
}
