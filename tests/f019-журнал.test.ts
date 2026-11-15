// Тест фічі F-019. Журнал подій — єдине джерело правди (ADR 0002).
//
// Це перевірка на ВТРАТУ ДАНИХ, і її робить АІ, а не власник (docs/ПРОЦЕС.md).
// Тут перевіряється те, що власник руками за столом не зловить: що подія фізично
// легла на диск, що журнал лише дописується, що після вимкнення живлення стан
// відновлюється, і що гравець не може переписати чужого персонажа.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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

function новаТека(): string {
  тека = mkdtempSync(join(tmpdir(), 'holotable-'));
  return тека;
}

interface Клієнт {
  сокет: WebSocket;
  події: Подія[];
  відмови: string[];
  стани: Record<string, СтанПерсонажа>[];
  дочекатись: (умова: () => boolean, мс?: number) => Promise<void>;
}

async function підключити(порт: number, роль: 'gm' | 'player', персонаж?: string): Promise<Клієнт> {
  const сокет = new WebSocket(`ws://127.0.0.1:${порт}`);
  сокети.push(сокет);
  await new Promise<void>((г, з) => {
    сокет.once('open', г);
    сокет.once('error', з);
  });

  const події: Подія[] = [];
  const відмови: string[] = [];
  const стани: Record<string, СтанПерсонажа>[] = [];
  const слухачі = new Set<() => void>();

  сокет.on('message', (сире: Buffer) => {
    const м = JSON.parse(сире.toString('utf8')) as ВідСервера;
    if (м.тип === 'подія') події.push(м.подія);
    else if (м.тип === 'відмова') відмови.push(м.причина);
    else if (м.тип === 'стан') стани.push(м.персонажі);
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
  const к: Клієнт = { сокет, події, відмови, стани, дочекатись };
  await дочекатись(() => стани.length > 0);
  return к;
}

function рядкиЖурналу(номер = 1): string[] {
  const файл = join(тека, `session-${String(номер).padStart(2, '0')}.jsonl`);
  if (!existsSync(файл)) return [];
  return readFileSync(файл, 'utf8').split('\n').filter((р) => р.trim() !== '');
}

describe('F-019 · журнал подій і збереження стану', () => {
  it('при підключенні клієнт одразу отримує стан усіх п\'яти персонажів', async () => {
    сервер = await підняти(0, { текаПодій: новаТека(), текаПерсонажів: ПЕРСОНАЖІ, номерСесії: 1 });
    const майстер = await підключити(сервер.порт, 'gm');
    const стан = майстер.стани[0] as Record<string, СтанПерсонажа>;
    expect(Object.keys(стан).sort()).toEqual([
      'alister', 'anam-melekh', 'krinzh-dor', 'nigra-4', 'sandra-vong',
    ]);
    // Анам у вихідному експорті вже поранений — база береться з листа, не з нуля
    expect(стан['anam-melekh']?.hitPointsLost).toBe(15);
  });

  it('зміна гравця фізично лягає в журнал і доходить до всіх', async () => {
    сервер = await підняти(0, { текаПодій: новаТека(), текаПерсонажів: ПЕРСОНАЖІ, номерСесії: 1 });
    const майстер = await підключити(сервер.порт, 'gm');
    const гравець = await підключити(сервер.порт, 'player', 'krinzh-dor');

    гравець.сокет.send(JSON.stringify({
      тип: 'намір', персонаж: 'krinzh-dor',
      зміни: { hitPointsLost: 7 }, нотатка: 'від бластера пірата',
    }));

    await майстер.дочекатись(() => майстер.події.length === 1);
    await гравець.дочекатись(() => гравець.події.length === 1);

    const подія = майстер.події[0] as Подія;
    expect(подія.персонаж).toBe('krinzh-dor');
    expect(подія.автор.вид).toBe('гравець');
    expect(подія.нотатка).toBe('від бластера пірата');
    expect(подія.зміни).toEqual([{ поле: 'hitPointsLost', було: 0, стало: 7 }]);

    // Головне: подія вже на диску, а не лише в памʼяті
    const рядки = рядкиЖурналу();
    expect(рядки).toHaveLength(1);
    expect((JSON.parse(рядки[0] as string) as Подія).id).toBe(подія.id);
    expect(сервер.стан.один('krinzh-dor')?.hitPointsLost).toBe(7);
  });

  it('гравець не може змінити чужого персонажа', async () => {
    сервер = await підняти(0, { текаПодій: новаТека(), текаПерсонажів: ПЕРСОНАЖІ, номерСесії: 1 });
    const гравець = await підключити(сервер.порт, 'player', 'krinzh-dor');

    гравець.сокет.send(JSON.stringify({
      тип: 'намір', персонаж: 'sandra-vong', зміни: { hitPointsLost: 99 },
    }));
    await гравець.дочекатись(() => гравець.відмови.length === 1);

    expect(гравець.відмови[0]).toContain('не твій персонаж');
    expect(рядкиЖурналу()).toHaveLength(0);
    expect(сервер.стан.один('sandra-vong')?.hitPointsLost).not.toBe(99);
  });

  it('майстер може змінити будь-якого персонажа', async () => {
    сервер = await підняти(0, { текаПодій: новаТека(), текаПерсонажів: ПЕРСОНАЖІ, номерСесії: 1 });
    const майстер = await підключити(сервер.порт, 'gm');

    майстер.сокет.send(JSON.stringify({
      тип: 'намір', персонаж: 'sandra-vong', зміни: { conditions: ['Prone'], exhaustion: 1 },
    }));
    await майстер.дочекатись(() => майстер.події.length === 1);

    expect((майстер.події[0] as Подія).автор.вид).toBe('майстер');
    expect(сервер.стан.один('sandra-vong')?.conditions).toEqual(['Prone']);
    expect(сервер.стан.один('sandra-vong')?.exhaustion).toBe(1);
  });

  it('негодящий намір відхиляється і в журнал не потрапляє', async () => {
    сервер = await підняти(0, { текаПодій: новаТека(), текаПерсонажів: ПЕРСОНАЖІ, номерСесії: 1 });
    const майстер = await підключити(сервер.порт, 'gm');

    const погані = [
      { тип: 'намір', персонаж: 'krinzh-dor', зміни: { maxHitPoints: 99 } },
      { тип: 'намір', персонаж: 'krinzh-dor', зміни: { hitPointsLost: -5 } },
      { тип: 'намір', персонаж: 'krinzh-dor', зміни: { hitPointsLost: 'багато' } },
      { тип: 'намір', персонаж: 'немає-такого', зміни: { hitPointsLost: 1 } },
      { тип: 'намір', персонаж: 'krinzh-dor', зміни: {} },
    ];
    for (const п of погані) майстер.сокет.send(JSON.stringify(п));
    await майстер.дочекатись(() => майстер.відмови.length === погані.length);

    // Найважливіше: обчислюване поле змінити не можна навіть майстру (ADR 0003)
    expect(майстер.відмови[0]).toContain('maxHitPoints');
    expect(майстер.події).toHaveLength(0);
    expect(рядкиЖурналу()).toHaveLength(0);
  });

  it('журнал лише дописується: старі рядки не міняються', async () => {
    сервер = await підняти(0, { текаПодій: новаТека(), текаПерсонажів: ПЕРСОНАЖІ, номерСесії: 1 });
    const майстер = await підключити(сервер.порт, 'gm');

    майстер.сокет.send(JSON.stringify({ тип: 'намір', персонаж: 'alister', зміни: { hitPointsLost: 3 } }));
    await майстер.дочекатись(() => майстер.події.length === 1);
    const перший = рядкиЖурналу()[0] as string;

    майстер.сокет.send(JSON.stringify({ тип: 'намір', персонаж: 'alister', зміни: { hitPointsLost: 9 } }));
    await майстер.дочекатись(() => майстер.події.length === 2);

    const рядки = рядкиЖурналу();
    expect(рядки).toHaveLength(2);
    expect(рядки[0], 'перший рядок журналу змінився — журнал мусить лише дописуватись').toBe(перший);
    // Друга подія знає, що було до неї: звідси безкоштовний відкат
    expect((JSON.parse(рядки[1] as string) as Подія).зміни[0]).toEqual({
      поле: 'hitPointsLost', було: 3, стало: 9,
    });
  });

  it('після перезапуску сервера стан відновлюється з журналу', async () => {
    const т = новаТека();
    сервер = await підняти(0, { текаПодій: т, текаПерсонажів: ПЕРСОНАЖІ, номерСесії: 1 });
    const майстер = await підключити(сервер.порт, 'gm');

    майстер.сокет.send(JSON.stringify({
      тип: 'намір', персонаж: 'nigra-4', зміни: { hitPointsLost: 21, conditions: ['Stunned'] },
    }));
    await майстер.дочекатись(() => майстер.події.length === 1);

    // Імітуємо раптове вимкнення: закриваємо сервер і піднімаємо новий на тій самій теці
    await сервер.закрити();
    сервер = await підняти(0, { текаПодій: т, текаПерсонажів: ПЕРСОНАЖІ, номерСесії: 1 });

    expect(сервер.стан.один('nigra-4')?.hitPointsLost).toBe(21);
    expect(сервер.стан.один('nigra-4')?.conditions).toEqual(['Stunned']);
    // Решта персонажів лишились як у вихідних листах
    expect(сервер.стан.один('alister')?.hitPointsLost).toBe(0);
  });

  it('обірваний на вимкненні останній рядок не ламає запуск і губить лише себе', async () => {
    const т = новаТека();
    сервер = await підняти(0, { текаПодій: т, текаПерсонажів: ПЕРСОНАЖІ, номерСесії: 1 });
    const майстер = await підключити(сервер.порт, 'gm');
    майстер.сокет.send(JSON.stringify({ тип: 'намір', персонаж: 'alister', зміни: { hitPointsLost: 4 } }));
    await майстер.дочекатись(() => майстер.події.length === 1);
    await сервер.закрити();

    // Дописуємо піврядка, як це зробило б вимкнення живлення посеред запису
    const файл = join(т, 'session-01.jsonl');
    writeFileSync(файл, `${readFileSync(файл, 'utf8')}{"id":"обір`, 'utf8');

    сервер = await підняти(0, { текаПодій: т, текаПерсонажів: ПЕРСОНАЖІ, номерСесії: 1 });
    // Перша подія жива, обірвана — ні. Це і є «втрачається максимум одна подія»
    expect(сервер.стан.один('alister')?.hitPointsLost).toBe(4);
  });
});
