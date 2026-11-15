// Тест фічі F-020. Гравець міняє свій стан зі свого телефона.
//
// Це перевірка на втрату даних (docs/ПРОЦЕС.md): власник побачить у демо, що число
// змінилось, але не побачить, чи воно дійшло до всіх, чи не загубилось при гонці і
// чи не переписало чуже. Саме це тут і перевіряється.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ВідСервера, Подія, СтанПерсонажа } from '../packages/protocol/src/index.js';
import { підняти, type Сервер } from '../apps/server/src/index.js';

const ПЕРСОНАЖІ = join(import.meta.dirname, '..', 'state', 'characters', 'source-exports');

let сервер: Сервер | null = null;
let тека = '';
const сокети: WebSocket[] = [];

afterEach(async () => {
  for (const с of сокети) с.close();
  сокети.length = 0;
  await сервер?.закрити();
  сервер = null;
});

interface Клієнт {
  сокет: WebSocket;
  події: Подія[];
  стан: Record<string, СтанПерсонажа>;
  дочекатись: (умова: () => boolean, мс?: number) => Promise<void>;
  змінити: (персонаж: string, зміни: СтанПерсонажа) => void;
}

async function підключити(порт: number, роль: 'gm' | 'player', персонаж?: string): Promise<Клієнт> {
  const сокет = new WebSocket(`ws://127.0.0.1:${порт}`);
  сокети.push(сокет);
  await new Promise<void>((г, з) => {
    сокет.once('open', г);
    сокет.once('error', з);
  });
  const події: Подія[] = [];
  let стан: Record<string, СтанПерсонажа> = {};
  const слухачі = new Set<() => void>();

  сокет.on('message', (сире: Buffer) => {
    const м = JSON.parse(сире.toString('utf8')) as ВідСервера;
    if (м.тип === 'стан') стан = м.персонажі;
    else if (м.тип === 'подія') {
      події.push(м.подія);
      стан = { ...стан, [м.подія.персонаж]: м.стан };
    }
    for (const с of [...слухачі]) с();
  });

  const дочекатись = (умова: () => boolean, мс = 3000): Promise<void> =>
    new Promise((готово, зле) => {
      if (умова()) return готово();
      const годинник = setTimeout(() => {
        слухачі.delete(слухач);
        зле(new Error(`умова не виконалась за ${мс} мс`));
      }, мс);
      const слухач = (): void => {
        if (!умова()) return;
        clearTimeout(годинник);
        слухачі.delete(слухач);
        готово();
      };
      слухачі.add(слухач);
    });

  сокет.send(JSON.stringify({ тип: 'привітання', роль, персонаж }));
  await дочекатись(() => Object.keys(стан).length > 0);
  return {
    сокет,
    події,
    get стан() {
      return стан;
    },
    дочекатись,
    змінити: (кого, зміни) => сокет.send(JSON.stringify({ тип: 'намір', персонаж: кого, зміни })),
  };
}

function журнал(): Подія[] {
  return readFileSync(join(тека, 'session-01.jsonl'), 'utf8')
    .split('\n')
    .filter((р) => р.trim() !== '')
    .map((р) => JSON.parse(р) as Подія);
}

async function підняти5(): Promise<Сервер> {
  тека = mkdtempSync(join(tmpdir(), 'holotable-'));
  return підняти(0, { текаПодій: тека, текаПерсонажів: ПЕРСОНАЖІ, номерСесії: 1 });
}

describe('F-020 · гравець міняє свій стан', () => {
  it('−5 ХП у гравця видно в майстра і в інших гравців', async () => {
    сервер = await підняти5();
    const майстер = await підключити(сервер.порт, 'gm');
    const крінж = await підключити(сервер.порт, 'player', 'krinzh-dor');
    const сандра = await підключити(сервер.порт, 'player', 'sandra-vong');

    крінж.змінити('krinzh-dor', { hitPointsLost: 5 });

    await майстер.дочекатись(() => майстер.стан['krinzh-dor']?.hitPointsLost === 5);
    await сандра.дочекатись(() => сандра.стан['krinzh-dor']?.hitPointsLost === 5);
    await крінж.дочекатись(() => крінж.стан['krinzh-dor']?.hitPointsLost === 5);

    // Саме це власник перевіряє очима в демо — а тест доводить, що дійшло до ВСІХ
    expect(майстер.події[0]?.автор.вид).toBe('гравець');
    expect(майстер.події[0]?.автор.персонаж).toBe('krinzh-dor');
  });

  it('серія швидких натискань не губить жодної зміни', async () => {
    сервер = await підняти5();
    const майстер = await підключити(сервер.порт, 'gm');
    const гравець = await підключити(сервер.порт, 'player', 'alister');

    // Гравець нервово тисне +1 десять разів підряд, не чекаючи відповіді
    for (let і = 1; і <= 10; і += 1) гравець.змінити('alister', { hitPointsLost: і });
    await майстер.дочекатись(() => майстер.події.length === 10);

    expect(сервер.стан.один('alister')?.hitPointsLost).toBe(10);
    // Кожне натискання лишило слід, і порядок збережений
    const рядки = журнал();
    expect(рядки).toHaveLength(10);
    expect(рядки.map((п) => п.зміни[0]?.стало)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(рядки.map((п) => п.зміни[0]?.було)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('два гравці міняються одночасно — обидві зміни збережені', async () => {
    сервер = await підняти5();
    const майстер = await підключити(сервер.порт, 'gm');
    const крінж = await підключити(сервер.порт, 'player', 'krinzh-dor');
    const нигра = await підключити(сервер.порт, 'player', 'nigra-4');

    крінж.змінити('krinzh-dor', { forcePointsUsed: 3 });
    нигра.змінити('nigra-4', { techPointsUsed: 4 });

    await майстер.дочекатись(() => майстер.події.length === 2);
    expect(сервер.стан.один('krinzh-dor')?.forcePointsUsed).toBe(3);
    expect(сервер.стан.один('nigra-4')?.techPointsUsed).toBe(4);
    expect(журнал()).toHaveLength(2);
  });

  it('умови додаються й знімаються, і це бачать усі', async () => {
    сервер = await підняти5();
    const майстер = await підключити(сервер.порт, 'gm');
    const гравець = await підключити(сервер.порт, 'player', 'sandra-vong');

    гравець.змінити('sandra-vong', { conditions: ['Приголомшена'] });
    await майстер.дочекатись(
      () => майстер.стан['sandra-vong']?.conditions?.toString() === 'Приголомшена',
    );
    гравець.змінити('sandra-vong', { conditions: [] });
    await майстер.дочекатись(() => майстер.події.length === 2);

    expect(сервер.стан.один('sandra-vong')?.conditions).toEqual([]);
    // Обидві зміни в журналі, тому відкат можливий у будь-який бік
    expect(журнал()[1]?.зміни[0]).toEqual({
      поле: 'conditions', було: ['Приголомшена'], стало: [],
    });
  });

  it('повторне натискання того самого значення не плодить подій', async () => {
    сервер = await підняти5();
    const майстер = await підключити(сервер.порт, 'gm');
    const гравець = await підключити(сервер.порт, 'player', 'alister');

    гравець.змінити('alister', { hitPointsLost: 2 });
    await майстер.дочекатись(() => майстер.події.length === 1);
    гравець.змінити('alister', { hitPointsLost: 2 });
    await new Promise((г) => setTimeout(г, 200));

    // Інакше журнал за сесію розпухав би від порожніх подій
    expect(майстер.події).toHaveLength(1);
    expect(журнал()).toHaveLength(1);
  });
});
