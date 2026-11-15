// Типи «сирого персонажа» — формату експорту персонажа зі sw5e.com, builderVersion 0.7.6.
//
// Це НАШ рідний формат зберігання (ADR 0001). Поля не перейменовуємо, не «причісуємо»
// і не додаємо — крім namespace `holotable` у самому кінці файлу.
//
// Типи виведені з об'єднання полів, фактично присутніх у п'яти реальних листах
// 4 рівня (Алістер, Анам Мелех, Крінж-Дор, Нигра 4, Сандра Вонг), а не з документації.
// Там, де поле є лише в частини файлів, воно необов'язкове (`?`).
//
// ГОЛОВНЕ ПРАВИЛО (ADR 0003): тут лежать ЛИШЕ вибори людини.
// Максимум ХП, КБ, сейви, бонуси атак, DC сил і технологій, кубики перевершення,
// модифікатори вмінь, список маневрів від класу — НІКОЛИ не зберігаються.
// Усе це перераховує рушій правил при завантаженні.

// ─────────────────────────────────────────────────────────────────────────────
// ДОПОМІЖНІ ТИПИ
// ─────────────────────────────────────────────────────────────────────────────

/** Шість характеристик. Ключі англійською — так їх пише sw5e.com. */
export type AbilityName =
  | 'Strength'
  | 'Dexterity'
  | 'Constitution'
  | 'Intelligence'
  | 'Wisdom'
  | 'Charisma';

/** Вісімнадцять вмінь SW5e. Пробіли в ключах — як у sw5e.com («Sleight of Hand»). */
export type SkillName =
  | 'Acrobatics'
  | 'Animal Handling'
  | 'Athletics'
  | 'Deception'
  | 'Insight'
  | 'Intimidation'
  | 'Investigation'
  | 'Lore'
  | 'Medicine'
  | 'Nature'
  | 'Perception'
  | 'Performance'
  | 'Persuasion'
  | 'Piloting'
  | 'Sleight of Hand'
  | 'Stealth'
  | 'Survival'
  | 'Technology';

/** Рівень володіння вмінням. У файлах зустрічались лише ці два значення. */
export type ProficiencyLevel = 'Proficient' | 'Expertise';

/**
 * Число, яке власник міг вручну підкрутити в редакторі sw5e.com.
 * `override` замінює обчислене значення, `bonus` додається до нього.
 * `null` означає «не задано» і зберігається в файлах саме як `null`.
 */
export interface NumericTweak {
  bonus?: number | null;
  override?: number | null;
}

/**
 * Кількість / вага / ціна предмета. sw5e.com пише їх то числом, то рядком
 * (`1` і `"2"` в одному й тому ж файлі). Нормалізувати можна лише при читанні,
 * у файлі лишаємо як є.
 */
export type NumberOrString = number | string;

// ─────────────────────────────────────────────────────────────────────────────
// СЕКЦІЯ 1. ДУРАБЕЛЬНІ ВИБОРИ — те, що вибрала людина. Змінюється рідко.
// ─────────────────────────────────────────────────────────────────────────────

/** Вид (раса). */
export interface RawSpecies {
  name: string;
  /**
   * Приріст характеристик від виду, якщо вид дає ВИБІР (Human: +2/+1/+1).
   * У видів із фіксованим приростом (Cathar, Devaronian, Kel Dor, Mon Calamari)
   * об'єкт ПОРОЖНІЙ — приріст треба брати з компендіуму за назвою виду.
   */
  abilityScoreImprovement?: Partial<Record<AbilityName, number>>;
  /** Індекс вибраного варіанта приросту (у всіх п'яти файлах — 0). */
  abilityScoreImprovementSelectedOption?: number;
}

/** Риса (feat) — від фону або замість приросту характеристик. */
export interface RawFeat {
  name: string;
  type: 'Feat';
}

/** Приріст характеристик на 4/8/12/16 рівнях: або дві характеристики, або риса. */
export interface RawAbilityScoreImprovement {
  type: 'Ability Score Improvement' | 'Feat';
  /** Є лише коли `type === 'Ability Score Improvement'`. */
  abilitiesIncreased?: Array<{ name: AbilityName; value: number }>;
  /** Є лише коли `type === 'Feat'` — назва взятої риси. */
  name?: string;
}

/** Архетип класу (підклас). Може сам давати сили — як Marauder Approach у Берсеркера. */
export interface RawArchetype {
  name: string;
  /** Сили Сили (Force Powers), які дає сам архетип, а не ті, що вибрав клас. */
  forcePowers?: string[];
  /** Технологічні сили, які дає архетип (Saboteur Practice у Оперативника). */
  techPowers?: string[];
}

/** Клас. Масив `classes` — мультиклас; у всіх п'ятьох поки один клас 4 рівня. */
export interface RawClass {
  name: string;
  levels: number;
  archetype?: RawArchetype;
  /**
   * Кинуті кубики ХП за рівні 2..N (на 1 рівні ХП фіксоване).
   * Це ВИБІР/КИДОК людини, тому зберігається. Сам максимум ХП — ні.
   */
  hitPoints?: number[];
  abilityScoreImprovements?: RawAbilityScoreImprovement[];
  /** Вибрані маневри (Scholar, Fighter тощо). */
  maneuvers?: string[];
  /** Вибрані сили Сили (Force Powers). */
  forcePowers?: string[];
  /** Вибрані технологічні сили. */
  techPowers?: string[];
}

/** Фон (background). */
export interface RawBackground {
  name: string;
  /** Риса від фону. */
  feat?: RawFeat;
  /** Текст особливості фону. У всіх п'яти файлах — порожній рядок. */
  feature?: string;
}

/**
 * Опис і біографія. Ключі з пробілами — як у sw5e.com.
 * Значення завжди рядки, навіть вік, зріст і вага («35», «190», «85»).
 */
export interface RawCharacteristics {
  Age?: string;
  Gender?: string;
  Height?: string;
  Weight?: string;
  Eyes?: string;
  Hair?: string;
  Skin?: string;
  Appearance?: string;
  'Place of Birth'?: string;
  Backstory?: string;
  'Personality Traits'?: string;
  Ideal?: string;
  Bond?: string;
  Flaw?: string;
  alignment?: string;
  [key: string]: string | undefined;
}

/** Предмет із компендіуму. */
export interface RawEquipmentItem {
  name: string;
  /** `Equipment` — звичайний предмет, `EnhancedItem` — покращений. */
  category?: string;
  quantity?: NumberOrString;
  /** Чи вдягнуто/взято в руки. Відсутнє поле = не вдягнуто. */
  equipped?: boolean;
  /** Ручна правка цього екземпляра предмета (Нигра: бластер із +1 до влучання). */
  tweaks?: RawItemTweaks;
}

/** Власний предмет, якого немає в компендіумі. */
export interface RawCustomEquipmentItem {
  name: string;
  /** `Gear` | `Armor` | `Weapon` — зустрічались у файлах. */
  equipmentCategory?: string;
  quantity?: NumberOrString;
  cost?: NumberOrString;
  weight?: NumberOrString;
  description?: string;
  equipped?: boolean;
  /** Для власної зброї: тип шкоди і кількість кубиків. */
  damageType?: string;
  damageNumberOfDice?: number;
  tweaks?: RawItemTweaks;
}

/** Правки конкретного предмета. */
export interface RawItemTweaks {
  toHit?: NumericTweak;
  damage?: NumericTweak;
  damageDice?: { dieSize?: number | null };
}

/** Власна особливість (текст), написана власником вручну. */
export interface RawCustomFeature {
  name: string;
  content: string;
}

/** Власне володіння інструментом чи зброєю. */
export interface RawCustomProficiency {
  name: string;
  /** `tool` | `weapon` | `armor` | `language` — у файлах були `tool` і `weapon`. */
  type: string;
  /** Нижній регістр, на відміну від `ProficiencyLevel` у tweaks. */
  proficiencyLevel: string;
}

/** Налаштування редактора, які впливають на обчислення. */
export interface RawSettings {
  /** Чи перевіряти передумови сил. */
  isEnforcingForcePrerequisites?: boolean;
  /** `true` — ХП не кидають, беруть середнє (так у Крінж-Дора). */
  isFixedHitPoints?: boolean;
  /** `Manual` | `Roll` | `Standard Array` | `Point Buy`. У всіх п'яти — `Manual`. */
  abilityScoreMethod?: string;
}

/**
 * Ручні правки всього листа. Найнебезпечніша частина формату: саме вона
 * перебиває обчислення рушія, тому рушій мусить застосовувати її ОСТАННЬОЮ.
 */
export interface RawTweaks {
  abilityScores?: Partial<
    Record<
      AbilityName,
      {
        /** Пряме перевизначення фінального значення характеристики. */
        score?: NumericTweak;
        /**
         * Володіння вміннями. Саме тут, а не в класі, лежить фактичний
         * список вмінь персонажа. Порожній об'єкт означає «немає володіння».
         */
        skills?: Partial<Record<SkillName, { proficiency?: ProficiencyLevel }>>;
      }
    >
  >;
  /** Анам Мелех: +4 до КБ. */
  armorClass?: NumericTweak;
  /** Крінж-Дор: +7 до максимуму ХП. */
  hitPoints?: { maximum?: NumericTweak };
}

// ─────────────────────────────────────────────────────────────────────────────
// СЕКЦІЯ 2. СТАН СЕСІЇ (`currentStats`) — змінюється постійно, у кожному бою.
// Єдина частина файлу, яку застосунок пише під час гри.
// ─────────────────────────────────────────────────────────────────────────────

export interface RawCurrentStats {
  /** Скільки ХП втрачено (а не скільки лишилось — максимум обчислюваний). */
  hitPointsLost: number;
  temporaryHitPoints: number;
  techPointsUsed: number;
  forcePointsUsed: number;
  superiorityDiceUsed: number;
  /** Витрачені кубики ХП за розміром: `{ "d8": 0 }`, `{ "d12": 0 }`, `{}`. */
  hitDiceUsed: Record<string, number>;
  deathSaves: { successes: number; failures: number };
  hasInspiration: boolean;
  /** Скільки разів використано особливість: ключ — назва особливості. */
  featuresTimesUsed: Record<string, number>;
  /** Накладені стани. У всіх п'яти файлах порожній масив. */
  conditions: string[];
  exhaustion: number;
  /**
   * УВАГА: друкарська помилка в самому sw5e.com. Є у файлі Нигри 4 ПОРЯД
   * із правильним `exhaustion`. Не виправляти — інакше зламаємо сумісність
   * з експортом sw5e.com. Читати тільки `exhaustion`.
   */
  exhausion?: number;
  /** Чи витрачено слот високого рівня. */
  highLevelCasting: {
    level6: boolean;
    level7: boolean;
    level8: boolean;
    level9: boolean;
  };
  /**
   * Нерозподілені рівні — персонаж отримав рівень, але власник ще не вибрав,
   * що взяти. Є в трьох із п'яти файлів зі значенням 1.
   */
  unspentLevels?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// СЕКЦІЯ 3. МЕТАДАНІ — службові поля sw5e.com. Ми їх не тлумачимо, лише несемо.
// ─────────────────────────────────────────────────────────────────────────────

export interface RawMetadata {
  /** UUID персонажа на sw5e.com. Наш стабільний ключ. */
  id: string;
  /** UUID акаунта власника на sw5e.com. */
  userId: string;
  /** Логін власника. У всіх п'яти файлах — порожній рядок. */
  user?: string;
  /** Версія редактора. Поки що всюди `'0.7.6'`. Основа для міграцій. */
  builderVersion: string;
  /** Час у мілісекундах Unix. */
  createdAt: number;
  changedAt: number;
  /** Тимчасовий локальний ідентифікатор редактора, напр. `'temp-wg3qy3wg3'`. */
  localId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// НАШ NAMESPACE. Єдине місце, куди Holotable має право щось дописати (ADR 0001).
// ─────────────────────────────────────────────────────────────────────────────

export interface HolotableExtension {
  /** Версія нашої надбудови. Для майбутніх міграцій. */
  version: number;
  /** До якого гравця (телефона) прив'язаний цей лист. */
  playerId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ПЕРСОНАЖ ЦІЛКОМ
// ─────────────────────────────────────────────────────────────────────────────

export interface RawCharacter extends RawMetadata {
  // ── ДУРАБЕЛЬНІ ВИБОРИ ──
  name: string;
  /** Base64 або URL портрета. У всіх п'яти файлах — порожній рядок. */
  image?: string;
  notes?: string;
  species: RawSpecies;
  classes: RawClass[];
  /** Значення ДО приросту від виду та рівнів. Фінальні — обчислює рушій. */
  baseAbilityScores: Record<AbilityName, number>;
  background: RawBackground;
  characteristics: RawCharacteristics;
  experiencePoints?: number;
  credits?: number;
  equipment: RawEquipmentItem[];
  customEquipment?: RawCustomEquipmentItem[];
  customFeatures?: RawCustomFeature[];
  customFeats?: string[];
  customForcePowers?: string[];
  customTechPowers?: string[];
  customLanguages?: string[];
  customProficiencies?: RawCustomProficiency[];
  settings: RawSettings;
  tweaks?: RawTweaks;

  // ── СТАН СЕСІЇ ──
  currentStats: RawCurrentStats;

  // ── НАШЕ ──
  holotable?: HolotableExtension;
}
