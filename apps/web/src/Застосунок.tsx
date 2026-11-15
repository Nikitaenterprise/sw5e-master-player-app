import { useEffect, useRef, useState } from 'react';
import type { СтанПерсонажа } from '@holotable/protocol';
import {
  підключитись,
  рольЗАдреси,
  ПОРОЖНІЙ,
  type Знімок,
  type Керування,
} from './звязок.js';
import { імя, ПІДПИСИ } from './персонажі.js';

export function Застосунок(): JSX.Element {
  const { роль, персонаж } = рольЗАдреси(location.search);
  const [знімок, наЗміну] = useState<Знімок>(ПОРОЖНІЙ);
  const керування = useRef<Керування | null>(null);

  useEffect(() => {
    const к = підключитись(роль, персонаж, наЗміну);
    керування.current = к;
    return () => к.відключитись();
  }, [роль, персонаж]);

  const майстер = роль === 'gm';
  const заголовок = майстер ? 'Екран майстра' : імя(персонаж);

  return (
    <main className={майстер ? 'майстер' : 'гравець'}>
      <header>
        <h1>{заголовок}</h1>
        <Індикатор знімок={знімок} />
      </header>

      {знімок.відмова !== null && <p className="відмова">{знімок.відмова}</p>}

      {майстер ? (
        <section>
          <h2>Партія — {Object.keys(знімок.персонажі).length}</h2>
          <div className="картки">
            {Object.entries(знімок.персонажі)
              .sort(([а], [б]) => імя(а).localeCompare(імя(б), 'uk'))
              .map(([слаг, стан]) => (
                <Картка key={слаг} слаг={слаг} стан={стан} />
              ))}
          </div>
        </section>
      ) : (
        <ЛистГравця персонаж={персонаж} знімок={знімок} />
      )}

      <section>
        <h2>За столом — {знімок.клієнти.length}</h2>
        <ul className="хтоТут">
          {знімок.клієнти.map((к) => (
            <li key={к.id} className={к.id === знімок.я ? 'це-я' : undefined}>
              <span className={`роль роль-${к.роль}`}>{к.роль === 'gm' ? 'М' : 'Г'}</span>
              <span className="імя">{к.роль === 'gm' ? 'Майстер' : імя(к.персонаж)}</span>
              {к.id === знімок.я && <span className="мітка">це ти</span>}
            </li>
          ))}
        </ul>
      </section>

      <footer>Фаза 1 · F-018. Стан живий і спільний; кнопки зміни — наступна фіча.</footer>
    </main>
  );
}

function ЛистГравця({
  персонаж,
  знімок,
}: {
  персонаж: string | undefined;
  знімок: Знімок;
}): JSX.Element {
  if (персонаж === undefined) {
    return (
      <section>
        <p className="порада">
          Відкрий сторінку з іменем персонажа в адресі, наприклад
          <code> ?as=player&amp;character=krinzh-dor</code>
        </p>
      </section>
    );
  }
  const стан = знімок.персонажі[персонаж];
  if (стан === undefined) {
    return (
      <section>
        <p className="порада">Чекаю стан від сервера…</p>
      </section>
    );
  }
  return (
    <section>
      <h2>Мій стан</h2>
      <Поля стан={стан} />
    </section>
  );
}

function Картка({ слаг, стан }: { слаг: string; стан: СтанПерсонажа }): JSX.Element {
  const умови = стан.conditions;
  return (
    <article className="картка">
      <h3>{імя(слаг)}</h3>
      <div className="числа">
        <Число підпис="−ХП" значення={стан.hitPointsLost} />
        <Число підпис="тимч." значення={стан.temporaryHitPoints} />
        <Число підпис="Сила" значення={стан.forcePointsUsed} />
        <Число підпис="Техн." значення={стан.techPointsUsed} />
        <Число підпис="Суп." значення={стан.superiorityDiceUsed} />
        <Число підпис="Висн." значення={стан.exhaustion} />
      </div>
      {Array.isArray(умови) && умови.length > 0 && (
        <p className="умови">{умови.join(', ')}</p>
      )}
    </article>
  );
}

function Число({ підпис, значення }: { підпис: string; значення: unknown }): JSX.Element {
  return (
    <span className="число">
      <b>{typeof значення === 'number' ? значення : 0}</b>
      <small>{підпис}</small>
    </span>
  );
}

function Поля({ стан }: { стан: СтанПерсонажа }): JSX.Element {
  return (
    <dl className="поля">
      {Object.entries(ПІДПИСИ).map(([поле, підпис]) => {
        const значення = стан[поле as keyof СтанПерсонажа];
        return (
          <div key={поле}>
            <dt>{підпис}</dt>
            <dd>
              {Array.isArray(значення)
                ? значення.length === 0
                  ? '—'
                  : значення.join(', ')
                : typeof значення === 'boolean'
                  ? значення
                    ? 'так'
                    : 'ні'
                  : typeof значення === 'number'
                    ? значення
                    : '—'}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Індикатор({ знімок }: { знімок: Знімок }): JSX.Element {
  const з = знімок.звязок;
  switch (з.статус) {
    case 'онлайн':
      return <p className="звязок добре">підключено</p>;
    case 'підключаюсь':
      return <p className="звязок чекаю">підключаюсь…</p>;
    case 'обірвано':
      return (
        <p className="звязок погано">
          звʼязок обірвано, пробую знову за {Math.round(з.черезМс / 100) / 10} с
        </p>
      );
    case 'помилка':
      return <p className="звязок погано">помилка: {з.текст}</p>;
  }
}
