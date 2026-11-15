import { useEffect, useState } from 'react';
import type { Клієнт } from '@holotable/protocol';
import { підключитись, рольЗАдреси, type Стан } from './звязок.js';

const ІМЕНА: Record<string, string> = {
  'alister': 'Алістер',
  'anam-melekh': 'Анам Мелех',
  'krinzh-dor': 'Крінж-Дор',
  'nigra-4': 'Нигра 4',
  'sandra-vong': 'Сандра Вонг',
};

function підпис(к: Клієнт): string {
  if (к.роль === 'gm') return 'Майстер';
  if (к.персонаж === undefined) return 'Гравець';
  return ІМЕНА[к.персонаж] ?? к.персонаж;
}

export function Застосунок(): JSX.Element {
  const { роль, персонаж } = рольЗАдреси(location.search);
  const [стан, наЗміну] = useState<Стан>({ статус: 'підключаюсь' });

  useEffect(() => підключитись({ роль, персонаж, наЗміну }), [роль, персонаж]);

  const я = роль === 'gm' ? 'Екран майстра' : (персонаж === undefined ? 'Екран гравця' : ІМЕНА[персонаж] ?? персонаж);

  return (
    <main className={роль === 'gm' ? 'майстер' : 'гравець'}>
      <header>
        <h1>{я}</h1>
        <Індикатор стан={стан} />
      </header>

      {стан.статус === 'онлайн' && (
        <section>
          <h2>За столом — {стан.клієнти.length}</h2>
          <ul>
            {стан.клієнти.map((к) => (
              <li key={к.id} className={к.id === стан.я ? 'це-я' : undefined}>
                <span className={`роль роль-${к.роль}`}>{к.роль === 'gm' ? 'М' : 'Г'}</span>
                <span className="імя">{підпис(к)}</span>
                {к.id === стан.я && <span className="мітка">це ти</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer>
        Фаза 0 · F-010. Ігрового стану тут ще немає — це перевірка, що всі пристрої
        бачать одне й те саме в реальному часі.
      </footer>
    </main>
  );
}

function Індикатор({ стан }: { стан: Стан }): JSX.Element {
  switch (стан.статус) {
    case 'онлайн':
      return <p className="звязок добре">підключено</p>;
    case 'підключаюсь':
      return <p className="звязок чекаю">підключаюсь…</p>;
    case 'обірвано':
      return (
        <p className="звязок погано">
          звʼязок обірвано, пробую знову за {Math.round(стан.черезМс / 100) / 10} с
        </p>
      );
    case 'помилка':
      return <p className="звязок погано">помилка: {стан.текст}</p>;
  }
}
