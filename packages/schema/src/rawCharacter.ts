// Types for the "raw character" — the sw5e.com character export format, builderVersion 0.7.6.
//
// This is OUR native storage format (ADR 0001). We never rename fields, never tidy them
// up and never add our own — except the `holotable` namespace at the very end.
//
// The types are derived from the union of fields actually present in five real
// level-4 sheets (Алістер, Анам Мелех, Крінж-Дор, Нигра 4, Сандра Вонг), not from docs.
// Where a field appears in only some of the files, it is optional (`?`).
//
// THE MAIN RULE (ADR 0003): only human choices live here.
// Max HP, AC, saves, attack bonuses, force and tech DCs, superiority dice and the
// class-granted maneuver list are NEVER stored.
// The rules engine recomputes all of it on load.

// ─────────────────────────────────────────────────────────────────────────────
// HELPER TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** The six ability scores. Keys are English because that is how sw5e.com writes them. */
export type AbilityName =
  | 'Strength'
  | 'Dexterity'
  | 'Constitution'
  | 'Intelligence'
  | 'Wisdom'
  | 'Charisma';

/** The eighteen SW5e skills. Spaces in keys are as in sw5e.com ("Sleight of Hand"). */
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

/** Skill proficiency level. Only these two values occur in the files. */
export type ProficiencyLevel = 'Proficient' | 'Expertise';

/**
 * A number the owner may have tweaked by hand in the sw5e.com editor.
 * `override` replaces the computed value, `bonus` is added to it.
 * `null` means "unset" and is stored in the files as exactly that.
 */
export interface NumericTweak {
  bonus?: number | null;
  override?: number | null;
}

/**
 * Item quantity / weight / cost. sw5e.com writes these sometimes as a number and
 * sometimes as a string (`1` and `"2"` in one and the same file). Normalise on read
 * only; in the file they stay as they are.
 */
export type NumberOrString = number | string;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1. DURABLE CHOICES — what the human picked. Changes rarely.
// ─────────────────────────────────────────────────────────────────────────────

/** Species. */
export interface RawSpecies {
  name: string;
  /**
   * Ability score increase from the species, when the species offers a CHOICE
   * (Human: +2/+1/+1). For species with a fixed increase (Cathar, Devaronian,
   * Kel Dor, Mon Calamari) this object is EMPTY — the increase must then be
   * taken from the compendium by species name.
   */
  abilityScoreImprovement?: Partial<Record<AbilityName, number>>;
  /** Index of the chosen increase variant (0 in all five files). */
  abilityScoreImprovementSelectedOption?: number;
}

/** A feat — from the background, or taken instead of an ability score increase. */
export interface RawFeat {
  name: string;
  type: 'Feat';
}

/** Level 4/8/12/16 improvement: either two ability scores, or a feat. */
export interface RawAbilityScoreImprovement {
  type: 'Ability Score Improvement' | 'Feat';
  /** Present only when `type === 'Ability Score Improvement'`. */
  abilitiesIncreased?: Array<{ name: AbilityName; value: number }>;
  /** Present only when `type === 'Feat'` — the name of the feat taken. */
  name?: string;
}

/** Class archetype (subclass). May grant powers itself — as Marauder Approach does. */
export interface RawArchetype {
  name: string;
  /** Force powers granted by the archetype itself, not those the class picked. */
  forcePowers?: string[];
  /** Tech powers granted by the archetype (Saboteur Practice on the Operative). */
  techPowers?: string[];
}

/** Class. The `classes` array means multiclassing; all five have one level-4 class. */
export interface RawClass {
  name: string;
  levels: number;
  archetype?: RawArchetype;
  /**
   * Hit dice rolled for levels 2..N (level 1 HP is fixed).
   * This is a human ROLL, so it is stored. Max HP itself is not.
   */
  hitPoints?: number[];
  abilityScoreImprovements?: RawAbilityScoreImprovement[];
  /** Chosen maneuvers (Scholar, Fighter and so on). */
  maneuvers?: string[];
  /** Chosen force powers. */
  forcePowers?: string[];
  /** Chosen tech powers. */
  techPowers?: string[];
}

/** Background. */
export interface RawBackground {
  name: string;
  /** Feat granted by the background. */
  feat?: RawFeat;
  /** Background feature text. An empty string in all five files. */
  feature?: string;
}

/**
 * Description and biography. Keys contain spaces, as in sw5e.com.
 * Values are always strings, even age, height and weight ("35", "190", "85").
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

/** An item from the compendium. */
export interface RawEquipmentItem {
  name: string;
  /** `Equipment` is an ordinary item, `EnhancedItem` an enhanced one. */
  category?: string;
  quantity?: NumberOrString;
  /** Whether it is worn or held. A missing field means not equipped. */
  equipped?: boolean;
  /** Hand edit of this item instance (Нигра: a blaster with +1 to hit). */
  tweaks?: RawItemTweaks;
}

/** A custom item that is not in the compendium. */
export interface RawCustomEquipmentItem {
  name: string;
  /** `Gear` | `Armor` | `Weapon` — the values seen in the files. */
  equipmentCategory?: string;
  quantity?: NumberOrString;
  cost?: NumberOrString;
  weight?: NumberOrString;
  description?: string;
  equipped?: boolean;
  /** For custom weapons: damage type and number of dice. */
  damageType?: string;
  damageNumberOfDice?: number;
  tweaks?: RawItemTweaks;
}

/** Edits to one specific item. */
export interface RawItemTweaks {
  toHit?: NumericTweak;
  damage?: NumericTweak;
  damageDice?: { dieSize?: number | null };
}

/** A custom feature (free text) written by the owner. */
export interface RawCustomFeature {
  name: string;
  content: string;
}

/** A custom tool or weapon proficiency. */
export interface RawCustomProficiency {
  name: string;
  /** `tool` | `weapon` | `armor` | `language` — the files held `tool` and `weapon`. */
  type: string;
  /** Lower case, unlike `ProficiencyLevel` in tweaks. */
  proficiencyLevel: string;
}

/** Editor settings that affect the computation. */
export interface RawSettings {
  /** Whether power prerequisites are enforced. */
  isEnforcingForcePrerequisites?: boolean;
  /** `true` means HP is not rolled but averaged (as for Крінж-Дор). */
  isFixedHitPoints?: boolean;
  /** `Manual` | `Roll` | `Standard Array` | `Point Buy`. `Manual` in all five. */
  abilityScoreMethod?: string;
}

/**
 * Hand edits to the whole sheet. The most dangerous part of the format: it
 * overrides the engine's computation, so the engine must apply it LAST.
 */
export interface RawTweaks {
  abilityScores?: Partial<
    Record<
      AbilityName,
      {
        /** A direct override of the final ability score. */
        score?: NumericTweak;
        /**
         * Skill proficiencies. The character's actual skill list lives here,
         * not in the class. An empty object means "no proficiency".
         */
        skills?: Partial<Record<SkillName, { proficiency?: ProficiencyLevel }>>;
      }
    >
  >;
  /** Анам Мелех: +4 to AC. */
  armorClass?: NumericTweak;
  /** Крінж-Дор: +7 to max HP. */
  hitPoints?: { maximum?: NumericTweak };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2. SESSION STATE (`currentStats`) — changes constantly, every fight.
// The only part of the file the application writes during play.
// ─────────────────────────────────────────────────────────────────────────────

export interface RawCurrentStats {
  /** How much HP was lost (not how much is left — the maximum is computed). */
  hitPointsLost: number;
  temporaryHitPoints: number;
  techPointsUsed: number;
  forcePointsUsed: number;
  superiorityDiceUsed: number;
  /** Hit dice spent, by die size: `{ "d8": 0 }`, `{ "d12": 0 }`, `{}`. */
  hitDiceUsed: Record<string, number>;
  deathSaves: { successes: number; failures: number };
  hasInspiration: boolean;
  /** How many times a feature was used; the key is the feature name. */
  featuresTimesUsed: Record<string, number>;
  /** Active conditions. An empty array in all five files. */
  conditions: string[];
  exhaustion: number;
  /**
   * CAREFUL: this typo is sw5e.com's own. It sits in the Нигра 4 file ALONGSIDE
   * the correct `exhaustion`. Do not fix it, or we break compatibility with the
   * sw5e.com export. Read `exhaustion` only.
   */
  exhausion?: number;
  /** Whether the high-level slot has been spent. */
  highLevelCasting: {
    level6: boolean;
    level7: boolean;
    level8: boolean;
    level9: boolean;
  };
  /**
   * Unspent levels — the character gained a level but the owner has not yet
   * chosen what to take. Present in three of the five files, with value 1.
   */
  unspentLevels?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3. METADATA — sw5e.com's own bookkeeping. We do not interpret it, only carry it.
// ─────────────────────────────────────────────────────────────────────────────

export interface RawMetadata {
  /** The character's UUID on sw5e.com. Our stable key. */
  id: string;
  /** UUID of the owner's sw5e.com account. */
  userId: string;
  /** The owner's login. An empty string in all five files. */
  user?: string;
  /** Editor version. `'0.7.6'` everywhere so far. The basis for migrations. */
  builderVersion: string;
  /** Time in Unix milliseconds. */
  createdAt: number;
  changedAt: number;
  /** A temporary local editor id, e.g. `'temp-wg3qy3wg3'`. */
  localId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// OUR NAMESPACE. The only place Holotable may add anything of its own (ADR 0001).
// ─────────────────────────────────────────────────────────────────────────────

export interface HolotableExtension {
  /** Version of our own overlay. For future migrations. */
  version: number;
  /** Which player (phone) this sheet is bound to. */
  playerId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE WHOLE CHARACTER
// ─────────────────────────────────────────────────────────────────────────────

export interface RawCharacter extends RawMetadata {
  // ── DURABLE CHOICES ──
  name: string;
  /** Base64 or URL of the portrait. An empty string in all five files. */
  image?: string;
  notes?: string;
  species: RawSpecies;
  classes: RawClass[];
  /** Values BEFORE species and level increases. The engine computes the final ones. */
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

  // ── SESSION STATE ──
  currentStats: RawCurrentStats;

  // ── OURS ──
  holotable?: HolotableExtension;
}
