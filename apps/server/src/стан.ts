// Авторитетний стан персонажів.
//
// Обчислюване не зберігається (ADR 0003), а стан сесії — зберігається, бо це вибір
// людини: гравець справді відняв собі ХП. Базу беремо з вихідних експортів, далі
// накладаємо журнал подій. Тому стан у памʼяті завжди дорівнює файлам на диску.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ПОЛЯ_СТАНУ,
  цеПолеСтану,
  type Автор,
  type Зміна,
  type Подія,
  type СтанПерсонажа,
  type ЗначенняСтану,
} from '@holotable/protocol';
import type { Журнал } from './журнал.js';

export class Стан {
  private readonly персонажі = new Map<string, СтанПерсонажа>();

  constructor(
    private readonly журнал: Журнал,
    текаПерсонажів: string,
  ) {
    for (const [слаг, базовий] of Стан.база(текаПерсонажів)) {
      this.персонажі.set(слаг, базовий);
    }
    for (const подія of журнал.прочитати().події) this.накласти(подія);
  }

  /** Початковий стан із вихідних експортів: лише ті поля, які ми вміємо міняти. */
  private static база(тека: string): Map<string, СтанПерсонажа> {
    const мапа = new Map<string, СтанПерсонажа>();
    if (!existsSync(тека)) return мапа;
    for (const імя of readdirSync(тека).filter((і) => і.endsWith('.json'))) {
      const лист = JSON.parse(readFileSync(join(тека, імя), 'utf8')) as {
        currentStats?: Record<string, unknown>;
      };
      const стан: СтанПерсонажа = {};
      for (const поле of ПОЛЯ_СТАНУ) {
        const значення = лист.currentStats?.[поле];
        if (значення !== undefined) стан[поле] = значення as ЗначенняСтану;
      }
      мапа.set(basename(імя, '.json'), стан);
    }
    return мапа;
  }

  слаги(): string[] {
    return [...this.персонажі.keys()].sort();
  }

  усе(): Record<string, СтанПерсонажа> {
    return Object.fromEntries(this.персонажі);
  }

  один(слаг: string): СтанПерсонажа | undefined {
    return this.персонажі.get(слаг);
  }

  /**
   * Застосовує намір: будує подію з парами «було → стало», дописує в журнал,
   * тоді міняє памʼять. Саме цей порядок важливий: якщо живлення зникне між
   * дописом і зміною памʼяті, після перезапуску журнал усе одно дасть той стан.
   */
  застосувати(
    слаг: string,
    зміни: СтанПерсонажа,
    автор: Автор,
    нотатка?: string,
  ): Подія | string {
    const поточний = this.персонажі.get(слаг);
    if (поточний === undefined) return `немає персонажа «${слаг}»`;

    const перелік: Зміна[] = [];
    for (const [поле, стало] of Object.entries(зміни)) {
      if (!цеПолеСтану(поле) || стало === undefined) continue;
      const було = поточний[поле];
      if (JSON.stringify(було) === JSON.stringify(стало)) continue;
      перелік.push({ поле, було, стало });
    }
    if (перелік.length === 0) return 'нічого не змінилось';

    const подія: Подія = {
      id: randomUUID(),
      коли: Date.now(),
      автор,
      тип: 'стан.змінено',
      персонаж: слаг,
      зміни: перелік,
      ...(нотатка === undefined ? {} : { нотатка }),
    };

    this.журнал.дописати(подія);
    this.накласти(подія);
    return подія;
  }

  /** Накладає подію на памʼять. Використовується і при відтворенні журналу. */
  private накласти(подія: Подія): void {
    const стан = this.персонажі.get(подія.персонаж);
    if (стан === undefined) return;
    for (const зміна of подія.зміни) стан[зміна.поле] = зміна.стало;
  }
}
