// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { DISPLAY_LANGUAGES, displayLanguageForTag } from "./languageCatalog";
import { DISPLAY_LANGUAGE_STORAGE_KEY, migrateLegacyDisplayLanguagePreference, resolveInitialDisplayLanguage, resolveSystemDisplayLanguage } from "./languagePreference";
import { TRANSLATIONS, translateFor } from "./translate";
import { ENGLISH_TRANSLATIONS, type TranslationKey } from "./translations";
import supplemental from "./supplementalTranslations.json";
import { formatLocalizedCalendarMinuteLabel, formatLocalizedCompactTimeRange, formatLocalizedDuration, formatLocalizedShortDurationFromSeconds, describeLocalizedRelativeDay, localeForDisplayLanguage } from "../../lib/formatting";
import { shiftIsoDate } from "@drifty/domain";
import { logicalTodayIsoDate } from "../../lib/formatting";

const languages = ["ja", "pt-BR", "zh-Hans", "fr", "de"] as const;
const tokens = (value: string) => (value.match(/\{\{?\w+\}\}?/gu) ?? []).sort();
afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });

describe("additional display languages", () => {
  it.each(languages)("%s covers the complete UI contract, including single-brace notification tokens", (language) => {
    const table = TRANSLATIONS[language];
    expect(Object.keys(table).sort()).toEqual(Object.keys(ENGLISH_TRANSLATIONS).sort());
    for (const key of Object.keys(ENGLISH_TRANSLATIONS) as TranslationKey[]) {
      expect(table[key].trim(), key).not.toBe("");
      expect(tokens(table[key]), key).toEqual(tokens(ENGLISH_TRANSLATIONS[key]));
      const urls = ENGLISH_TRANSLATIONS[key].match(/https?:\/\/[^\s<>"）)]+/gu) ?? [];
      for (const url of urls) expect(table[key], key).toContain(url.replace(/[.,;:!?]+$/u, ""));
    }
    // These are product commitments, independent of wording and grammatical order.
    expect(table["settings.account.syncRetention"]).toContain("60");
    expect(table["billing.plan.proFeature4"]).toContain("3");
    const phrase = translateFor(language)("dashboard.today.focused", { duration: "42:17" });
    expect(phrase).toContain("42:17");
    expect(phrase).not.toMatch(/\{\{/u);
  });

  it.each(languages)("preserves a manual %s choice across legacy migration and system changes", (language) => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, language);
    migrateLegacyDisplayLanguagePreference();
    expect(resolveInitialDisplayLanguage({ languages: ["ko-KR"] })).toBe(language);
    expect(resolveInitialDisplayLanguage({ languages: ["en-US"] })).toBe(language);
  });

  it("uses language preference order and distinguishes Chinese scripts", () => {
    for (const [tag, expected] of [["ja-JP", "ja"], ["pt_BR", "pt-BR"], ["zh-CN", "zh-Hans"], ["zh-SG", "zh-Hans"], ["zh-Hans-US", "zh-Hans"], ["fr-CA", "fr"], ["de-AT", "de"]] as const) {
      expect(displayLanguageForTag(tag)).toBe(expected);
    }
    for (const tag of ["zh-TW", "zh-HK", "zh-Hant", "not_a_locale"]) expect(displayLanguageForTag(tag)).toBeNull();
    expect(resolveSystemDisplayLanguage({ languages: ["it-IT", "ja-JP"] })).toBe("en");
    expect(resolveSystemDisplayLanguage({ languages: ["fr-CA", "es-ES"] })).toBe("fr");
    expect(new Set(DISPLAY_LANGUAGES.map((entry) => entry.value)).size).toBe(8);
  });

  it("preserves regional Spanish and French formatting without changing the UI language", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-CA", "es-MX"]);
    expect(localeForDisplayLanguage("fr")).toBe("fr-CA");
    expect(localeForDisplayLanguage("es")).toBe("es-MX");
    expect(localeForDisplayLanguage("pt-BR")).toBe("pt-BR");
  });

  it.each(languages)("formats %s time, seconds and relative days without Korean fallthrough", (language) => {
    const time = formatLocalizedCompactTimeRange(new Date(2026, 9, 16, 14, 5), new Date(2026, 9, 16, 14, 25), language);
    expect(time).not.toMatch(/오전|오후|undefined/u);
    expect(time).toContain("14");
    expect(formatLocalizedCalendarMinuteLabel("2026-10-16", 845, language)).toBe(
      new Intl.DateTimeFormat(localeForDisplayLanguage(language), { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(2000, 0, 1, 14, 5))),
    );
    expect(formatLocalizedShortDurationFromSeconds(28, language)).not.toContain("초");
    expect(formatLocalizedDuration(3660, language)).not.toMatch(/시간|분/u);
    const yesterday = describeLocalizedRelativeDay(shiftIsoDate(logicalTodayIsoDate(), -1), language);
    expect(yesterday).not.toBe("어제");
    expect(yesterday).not.toBe("Yesterday");
  });

  it("all native/export/inline dictionaries preserve keys and parameters", () => {
    const reference = Object.keys(supplemental.ja).sort();
    for (const language of languages) {
      expect(Object.keys(supplemental[language]).sort()).toEqual(reference);
      for (const [key, value] of Object.entries(supplemental[language])) expect(tokens(value), `${language}: ${key}`).toEqual(tokens(key));
    }
  });
});
