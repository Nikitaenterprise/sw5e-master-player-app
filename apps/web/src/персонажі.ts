// Відповідність слагів іменам і те, як показувати поля стану людині.
// Переклад термінів поки тут; коли зʼявиться глосарій (F-025), переїде туди.
import type { ПолеСтану } from '@holotable/protocol';

export const ІМЕНА: Record<string, string> = {
  'alister': 'Алістер',
  'anam-melekh': 'Анам Мелех',
  'krinzh-dor': 'Крінж-Дор',
  'nigra-4': 'Нигра 4',
  'sandra-vong': 'Сандра Вонг',
};

export function імя(слаг: string | undefined): string {
  if (слаг === undefined) return 'без персонажа';
  return ІМЕНА[слаг] ?? слаг;
}

export const ПІДПИСИ: Record<ПолеСтану, string> = {
  hitPointsLost: 'Втрачено ХП',
  temporaryHitPoints: 'Тимчасові ХП',
  forcePointsUsed: 'Витрачено поінтів Сили',
  techPointsUsed: 'Витрачено поінтів Техніки',
  superiorityDiceUsed: 'Витрачено кубиків Суперіориті',
  exhaustion: 'Виснаження',
  hasInspiration: 'Натхнення',
  conditions: 'Умови',
};
