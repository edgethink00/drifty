import { ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS } from "../localization/translations";
import { SETTINGS_SEARCH_ENTRIES, SETTINGS_SECTION_LABELS, type SettingsSearchEntry } from "./settingsSearchCatalog";

export type SettingsSearchAvailability = {
  readonly dev: boolean;
  readonly intelligence: boolean;
  readonly windows: boolean;
  readonly macos?: boolean;
  readonly backgroundUpdates: boolean;
  readonly signedIn: boolean;
  readonly authenticated?: boolean;
  readonly accessibility?: boolean;
  readonly deviceSync: boolean;
  readonly promoCode?: boolean;
  readonly friendInvite?: boolean;
  /** Settings > Sync shows the iPhone section only where the App Store offers the app. */
  readonly phoneApp?: boolean;
};

export function isSettingsSearchEntryVisible(entry: SettingsSearchEntry, availability: SettingsSearchAvailability): boolean {
  return (entry.section !== "dev" || availability.dev) && (!entry.gate || Boolean(availability[entry.gate]));
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}]+/gu, "");
}

// A static, bilingual index. Never index setting values, account data, or history.
const index = SETTINGS_SEARCH_ENTRIES.map((entry) => {
  const sectionKey = SETTINGS_SECTION_LABELS[entry.section];
  const titles = [ENGLISH_TRANSLATIONS[entry.titleKey], KOREAN_TRANSLATIONS[entry.titleKey]].map(normalize);
  const aliases = normalize(entry.keywords ?? "");
  const text = normalize([
    ...titles, aliases, ENGLISH_TRANSLATIONS[sectionKey], KOREAN_TRANSLATIONS[sectionKey],
    entry.descriptionKey ? ENGLISH_TRANSLATIONS[entry.descriptionKey] : "",
    entry.descriptionKey ? KOREAN_TRANSLATIONS[entry.descriptionKey] : "",
  ].join(" "));
  return { entry, titles, aliases, text };
});

export function searchSettings(query: string, availability: SettingsSearchAvailability): readonly SettingsSearchEntry[] {
  const normalized = normalize(query);
  if (!normalized) return [];
  const terms = query.normalize("NFKC").toLocaleLowerCase().split(/\s+/u).map(normalize).filter(Boolean);
  return index
    .filter(({ entry, text }) => isSettingsSearchEntryVisible(entry, availability) && terms.every((term) => text.includes(term)))
    .map(({ entry, titles, aliases }) => ({
      entry,
      score: titles.includes(normalized) ? 4 : titles.some((title) => title.includes(normalized)) ? 3 : aliases.includes(normalized) ? 2 : 1,
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry);
}
