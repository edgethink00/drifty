import type { CSSProperties } from "react";
import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import { useLocalization } from "../../../localization/LocalizationContext";
import { achievementBadgeStage, achievementBadgeUrl } from "../../achievementBadge";
import type { AchievementHoldings, AlmostThereEntry } from "../../achievementCollection";
import { achievementName } from "../../achievementCopy";
import { nextMedal, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";

type MedalProps = {
  readonly item: AchievementItem;
  /** The small image, for marks under about 3rem. */
  readonly small?: boolean;
  readonly className?: string;
};

/** The medal image exactly as baked; the layout's CSS sizes its box. */
export function C11Medal({ item, small = false, className = "c11-medal" }: MedalProps) {
  const stage = achievementBadgeStage(item);
  const src = achievementBadgeUrl(item.definition.id, stage, small);
  return (
    <span className={className} data-stage={stage} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : null}
    </span>
  );
}

/** A place that held the locked medal and now holds the earned one: the two fixed images cross-fade. */
export function C11LitMedal({ item, small = false, className = "c11-medal", delay }: MedalProps & { readonly delay: number }) {
  const before = achievementBadgeUrl(item.definition.id, item.definition.hidden ? "concealed" : "locked", small);
  const after = achievementBadgeUrl(item.definition.id, achievementBadgeStage(item), small);
  return (
    <span className={className + " c11-lit"} aria-hidden="true" style={{ "--c11-lit-at": delay + "ms" } as CSSProperties}>
      {before ? <img className="c11-lit__before" src={before} alt="" draggable={false} /> : null}
      {after ? <img className="c11-lit__after" src={after} alt="" draggable={false} /> : null}
    </span>
  );
}

const ENGLISH_ORDINAL_SUFFIX: Readonly<Record<string, string>> = { one: "st", two: "nd", few: "rd", other: "th" };

/** "First time" for the first, then "40th time" / "40번째" for the rest. */
export function nthLabel(ordinal: number, t: Translate, language: DisplayLanguage): string {
  if (ordinal === 1) return t("achievements.c11.firstTime");
  const suffix = ENGLISH_ORDINAL_SUFFIX[new Intl.PluralRules("en", { type: "ordinal" }).select(ordinal)] ?? "th";
  return t("achievements.c11.nth", { count: ordinal, ordinal: language === "en" ? ordinal + suffix : String(ordinal) });
}

/** "Nov 21" this year, "Nov 21, 2025" before. */
export function shortDay(day: string, language: DisplayLanguage, today = new Date()): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const options: Intl.DateTimeFormatOptions = year === today.getFullYear()
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), options).format(new Date(year, month - 1, date, 12));
}

/** What is left of an almost-there goal: time or days to unlock, or times to the next metal. */
export function nearLeft(entry: AlmostThereEntry, t: Translate, language: DisplayLanguage): string {
  if (entry.kind === "unlock") return remainingText(entry.item, t, language) ?? "";
  const medal = nextMedal(entry.item);
  return medal ? t(medal.key, { remaining: medal.remaining }) : "";
}

export function nearLabel(entry: AlmostThereEntry, t: Translate, language: DisplayLanguage): string {
  return t("achievements.c11.nearLabel", { name: achievementName(entry.item, t), left: nearLeft(entry, t, language) });
}

/** One quiet line counting what is held: by rarity tier when known, else by medal metal. */
export function C11TierSummary({ holdings, className }: { readonly holdings: AchievementHoldings; readonly className: string }) {
  const { t } = useLocalization();
  const parts = holdings.kind === "rarity"
    ? holdings.tiers.filter(({ count }) => count > 0).map(({ tier, count }) => ({
      key: "tier-" + tier,
      name: t(("achievements.tier." + tier) as TranslationKey),
      count,
      notable: tier >= 3,
    }))
    : holdings.medals.filter(({ count }) => count > 0).map(({ medal, count }) => ({
      key: medal,
      name: t(medal === "ring" ? "achievements.medal.ringShort" : medal === "gold" ? "achievements.medal.gold" : "achievements.medal.silver"),
      count,
      notable: medal !== "silver",
    }));
  return (
    <p className={className} data-tier-summary="" data-kind={holdings.kind}>
      {parts.map((part) => (
        <span key={part.key} className="c11-tiers__item" data-notable={part.notable ? "true" : undefined}>
          <span className="c11-tiers__name">{part.name}</span>
          <span className="c11-tiers__count">{part.count}</span>
        </span>
      ))}
    </p>
  );
}
