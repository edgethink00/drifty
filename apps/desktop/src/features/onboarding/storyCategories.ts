import type { ActivityCategory, BuiltInActivityCategory } from "@drifty/domain";
import type { DisplayLanguage } from "../localization/languageCatalog";
import type { TranslationKey } from "../localization/translations";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";

const CATEGORY_KEYS: Record<BuiltInActivityCategory, TranslationKey> = {
  workspace: "activity.category.workspace",
  learning: "activity.category.learning",
  communication: "activity.category.communication",
  music: "activity.category.music",
  game: "activity.category.game",
  social_media: "activity.category.socialMedia",
  entertainment: "activity.category.entertainment",
  shopping: "activity.category.shopping",
  utility: "activity.category.utility",
  unknown: "activity.category.unknown",
};

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

/** A category's name in the display language; a category the user added reads as Other here. */
export function storyCategoryName(category: ActivityCategory, t: Translate): string {
  return t((CATEGORY_KEYS as Record<string, TranslationKey>)[category] ?? "activity.category.custom");
}

// Languages that write a category name in lower case inside a sentence.
const LOWERCASE_IN_SENTENCE: ReadonlySet<DisplayLanguage> = new Set(["en", "es", "fr", "pt-BR"]);

/**
 * "Entertainment 1h 41m, utility 48m and communication 40m" in the display language: the largest
 * categories, each with its time. Korean reads more naturally as a plain comma list than with Intl's 및.
 */
export function storyKindsList(
  entries: readonly { readonly category: ActivityCategory; readonly seconds: number }[],
  language: DisplayLanguage,
  t: Translate,
): string {
  const items = entries.map((entry) => {
    const name = storyCategoryName(entry.category, t);
    const shown = LOWERCASE_IN_SENTENCE.has(language) ? name.toLocaleLowerCase(language) : name;
    return shown + " " + formatLocalizedCompactDurationFromSeconds(entry.seconds, language);
  });
  if (language === "ko") return items.join(", ");
  // Intl.ListFormat is ES2021; the TypeScript lib here predates it, so reach it through a narrow type.
  const ListFormat = (Intl as unknown as {
    readonly ListFormat?: new (locale: string, options: { readonly type: "conjunction" }) => { format(values: readonly string[]): string };
  }).ListFormat;
  if (!ListFormat) return items.join(", ");
  try {
    return new ListFormat(language, { type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

