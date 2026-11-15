// Тест фічі F-011. Демо на чотирьох екранах — це інструмент, яким власник приймає
// всі подальші фічі, тому воно має бути цілим саме по собі.
//
// Перевіряємо джерело, а не збірку: тест мусить проходити на чистому клоні, де
// dist/ ще немає. Головне тут — слаги персонажів: помилка в слагу дала б порожню
// панель, і власник шукав би баг у синхронізації, якого немає.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const корінь = join(import.meta.dirname, '..');
const демо = readFileSync(join(корінь, 'apps', 'web', 'demo.html'), 'utf8');

const екрани = [
  { роль: 'gm', адреса: '/?as=gm', персонаж: null },
  { роль: 'player', адреса: '/?as=player&character=krinzh-dor', персонаж: 'krinzh-dor' },
  { роль: 'player', адреса: '/?as=player&character=sandra-vong', персонаж: 'sandra-vong' },
  { роль: 'player', адреса: '/?as=player&character=nigra-4', персонаж: 'nigra-4' },
];

describe('F-011 · демо на чотирьох екранах', () => {
  it('сторінка демо є і її збирає vite', () => {
    expect(existsSync(join(корінь, 'apps', 'web', 'demo.html'))).toBe(true);
    const конфіг = readFileSync(join(корінь, 'apps', 'web', 'vite.config.ts'), 'utf8');
    expect(конфіг, 'demo.html не вказано входом у vite.config.ts — не потрапить у збірку')
      .toContain("'demo.html'");
  });

  it('усі чотири екрани оголошені', () => {
    for (const е of екрани) {
      expect(демо, `немає екрана ${е.адреса}`).toContain(е.адреса);
    }
    const скільки = (демо.match(/as=player/g) ?? []).length;
    expect(скільки, 'має бути рівно три екрани гравців').toBe(3);
    expect((демо.match(/as=gm/g) ?? []).length, 'має бути рівно один екран майстра').toBe(1);
  });

  it('слаги персонажів відповідають справжнім листам', () => {
    for (const е of екрани) {
      if (е.персонаж === null) continue;
      const лист = join(корінь, 'state', 'characters', 'source-exports', `${е.персонаж}.json`);
      expect(existsSync(лист), `у демо слаг ${е.персонаж}, але листа ${е.персонаж}.json немає`)
        .toBe(true);
    }
  });

  it('сітка 2x2, щоб усі чотири було видно одночасно', () => {
    expect(демо).toMatch(/grid-template-columns:\s*1fr 1fr/);
    expect(демо).toMatch(/grid-template-rows:\s*1fr 1fr/);
  });

  it('у кожній панелі є кнопка відключення — нею перевіряють синхронізацію', () => {
    expect(демо).toContain('відключити');
    expect(демо).toContain('about:blank');
  });
});
