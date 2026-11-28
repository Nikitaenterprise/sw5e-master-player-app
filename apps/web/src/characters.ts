// Slug-to-name mapping, and how state fields are shown to a human.
// Term translations live here for now; they move to the glossary (F-025) when it lands.
import type { StateField } from '@holotable/protocol';

export const NAMES: Record<string, string> = {
  'alister': 'Алістер',
  'anam-melekh': 'Анам Мелех',
  'krinzh-dor': 'Крінж-Дор',
  'nigra-4': 'Нигра 4',
  'sandra-vong': 'Сандра Вонг',
};

export function name(slug: string | undefined): string {
  if (slug === undefined) return 'без персонажа';
  return NAMES[slug] ?? slug;
}

export const LABELS: Record<StateField, string> = {
  hitPointsLost: 'Втрачено ХП',
  temporaryHitPoints: 'Тимчасові ХП',
  forcePointsUsed: 'Витрачено поінтів Сили',
  techPointsUsed: 'Витрачено поінтів Техніки',
  superiorityDiceUsed: 'Витрачено кубиків Суперіориті',
  exhaustion: 'Виснаження',
  hasInspiration: 'Натхнення',
  conditions: 'Умови',
  hitDiceUsed: 'Витрачено кубиків здоровʼя',
  deathSaves: 'Рятівні від смерті',
  holotableEffects: 'Ефекти',
  holotableItemsUsed: 'Витрачені предмети',
  holotableItemsAdded: 'Додані майстром речі',
  holotableAlignment: 'Схильність',
};
