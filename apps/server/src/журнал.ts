// Журнал подій (ADR 0002). Файл, у який лише дописують.
//
// Чому дозапис із fsync, а не база даних: у власника вдома світло буває 3–4 години
// на добу, і ноутбук може вимкнутись посеред сесії. Дозапис одного рядка з fsync —
// атомарна операція: втрачається максимум одна подія, а не сесія. Жодна база
// такої простої гарантії за ту саму ціну не дає.
import { appendFileSync, openSync, fsyncSync, closeSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Подія } from '@holotable/protocol';

export class Журнал {
  readonly файл: string;
  readonly номерСесії: number;

  constructor(тека: string, номерСесії?: number) {
    mkdirSync(тека, { recursive: true });
    this.номерСесії = номерСесії ?? Журнал.остання(тека);
    this.файл = join(тека, `session-${String(this.номерСесії).padStart(2, '0')}.jsonl`);
  }

  /** Номер останньої сесії в теці, або 1, якщо журналів ще немає. */
  static остання(тека: string): number {
    if (!existsSync(тека)) return 1;
    const номери = readdirSync(тека)
      .map((імя) => /^session-(\d+)\.jsonl$/.exec(імя)?.[1])
      .filter((н): н is string => н !== undefined)
      .map(Number);
    return номери.length === 0 ? 1 : Math.max(...номери);
  }

  /**
   * Дописує подію й чекає, доки вона фізично ляже на диск.
   * Синхронно і з fsync — свідомо: кілька подій на секунду за столом, тому ціна
   * нульова, а гарантія того варта.
   */
  дописати(подія: Подія): void {
    appendFileSync(this.файл, `${JSON.stringify(подія)}\n`, 'utf8');
    const описувач = openSync(this.файл, 'r+');
    try {
      fsyncSync(описувач);
    } finally {
      closeSync(описувач);
    }
  }

  /**
   * Читає журнал. Пошкоджений останній рядок (обірваний на вимкненні живлення)
   * пропускається — це і є та «максимум одна втрачена подія».
   */
  прочитати(): { події: Подія[]; зіпсованихРядків: number } {
    if (!existsSync(this.файл)) return { події: [], зіпсованихРядків: 0 };
    const рядки = readFileSync(this.файл, 'utf8').split('\n').filter((р) => р.trim() !== '');
    const події: Подія[] = [];
    let зіпсованих = 0;
    for (const рядок of рядки) {
      try {
        події.push(JSON.parse(рядок) as Подія);
      } catch {
        зіпсованих += 1;
      }
    }
    return { події, зіпсованихРядків: зіпсованих };
  }
}
