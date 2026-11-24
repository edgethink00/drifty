import { Fragment, useMemo, type CSSProperties, type ReactNode } from "react";
import { localeForDisplayLanguage } from "../../../../lib/formatting";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_GROUPS } from "../../achievementCatalog";
import { achievementHoldings, almostThere, type AlmostThereEntry } from "../../achievementCollection";
import {
  achievementCondition,
  achievementDay,
  achievementName,
  rarityIsNotable,
  raritySentence,
  rarityTierName,
  shownRarity,
  timesLabel,
} from "../../achievementCopy";
import { historyEntries, historyFor } from "../../achievementHistory";
import { readAchievementStore } from "../../achievementStore";
import { buildAchievementItems, type AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C9Held, C9Medal } from "./C9Parts";
import { nearLeft, percentText, shortDay } from "./c9Copy";
import "./c9-card.css";

/** The rows under the hero arrive one after another, this far apart. */
const ROW_STEP_MS = 50;
const FIRST_ROW_AT_MS = 80;
/** How many of the newest kept days the hero shows as chips. */
const HERO_DAYS = 3;

/** "11/17" (or the locale's order), with a two-digit year before this year: short enough for three chips on one line. */
function chipDay(day: string, language: DisplayLanguage, today = new Date()): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const options: Intl.DateTimeFormatOptions = year === today.getFullYear()
    ? { month: "numeric", day: "numeric" }
    : { year: "2-digit", month: "numeric", day: "numeric" };
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), options).format(new Date(year, month - 1, date, 12));
}

/** The newest kept days, the new one first and lit, with the earlier times counted quietly after them. */
function HeroDays({ item }: { readonly item: AchievementItem }) {
  const { effectiveLanguage, t } = useLocalization();
  const history = historyFor(item);
  if (!history) return null;
  const entries = historyEntries(history);
  const shown = entries.slice(0, HERO_DAYS);
  const earlier = entries.length - shown.length + history.earlier;
  return (
    <ol className="c9c-days">
      {shown.map((entry, index) => (
        <li key={entry.day} className="c9c-day" data-new={index === 0 ? "true" : undefined}>
          <span className="c9c-day__nth">{t("achievements.c9.nth", { count: entry.ordinal })}</span>
          <span className="c9c-day__date">{chipDay(entry.day, effectiveLanguage)}</span>
        </li>
      ))}
      {earlier > 0 ? <li className="c9c-days__earlier">{t("achievements.c9.earlier", { count: earlier })}</li> : null}
    </ol>
  );
}

/** The new repeat's kept days stand in for its "Nth · day" line when there are any. */
function hasDays(item: AchievementItem): boolean {
  const history = historyFor(item);
  return history ? historyEntries(history).length > 0 : false;
}

/** The goal closest to done among the ones not just earned, from the saved record. */
function useNextGoal(ordered: readonly AchievementItem[]): AlmostThereEntry | null {
  return useMemo(() => {
    const fresh = new Map(ordered.map((item) => [item.definition.id, item]));
    const items = buildAchievementItems(readAchievementStore()).map((item) => fresh.get(item.definition.id) ?? item);
    return almostThere(items, { limit: items.length }).find((entry) => !fresh.has(entry.item.definition.id)) ?? null;
  }, [ordered]);
}

/** The lead: a large medal landing in its slot, its name, "Nth · day · tier", and what it means. */
function Hero({ item, title, count }: { readonly item: AchievementItem; readonly title: ReactNode; readonly count: "nth" | "times" }) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const rarity = shownRarity(item);
  const day = achievementDay(item);
  const days = count === "nth" && Boolean(earned) && definition.repeatable && hasDays(item);
  const meta: { key: string; node: ReactNode }[] = [];
  // With kept days, the lit first chip is the new day and this line is left out.
  if (!days && earned && definition.repeatable && (count === "nth" || earned.count > 1)) {
    const label = count === "nth" ? t("achievements.c9.nth", { count: earned.count }) : t("achievements.c9.times", { count: earned.count });
    meta.push({ key: "count", node: <span className="c9c-hero__nth">{label}</span> });
  }
  if (!days && day) meta.push({ key: "day", node: <span>{shortDay(day, effectiveLanguage)}</span> });
  return (
    <div className="c9c-hero">
      <C9Medal item={item} className="c9-medal c9c-hero__medal" />
      <div className="c9c-hero__body">
        {title}
        {meta.length > 0 ? (
          <p className="c9c-hero__meta">
            {meta.map((part, index) => (
              <Fragment key={part.key}>
                {index > 0 ? <span className="c9c-hero__sep" aria-hidden="true"> · </span> : null}
                {part.node}
              </Fragment>
            ))}
          </p>
        ) : null}
        {days ? <HeroDays item={item} /> : null}
        {rarity ? (
          <p className="c9c-hero__rarity">
            <span className="c9c-hero__tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</span>
            <span className="c9c-hero__sep" aria-hidden="true"> · </span>
            {raritySentence(rarity, t, effectiveLanguage, "card")}
          </p>
        ) : null}
        <p className="c9c-hero__condition">{achievementCondition(item, t)}</p>
      </div>
    </div>
  );
}

type RowProps = {
  readonly item: AchievementItem;
  readonly rarityShown: boolean;
  /** "19th" for a new repeat, "×19" when listing what is held. */
  readonly count: "nth" | "times";
  readonly at: number;
  readonly isNew?: boolean;
};

function Row({ item, rarityShown, count, at, isNew = false }: RowProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const rarity = shownRarity(item);
  const day = achievementDay(item);
  const once = !definition.repeatable || (count === "times" && earned?.count === 1);
  const times = !earned ? null
    : once ? timesLabel(1, t)
      : count === "nth" ? t("achievements.c9.nth", { count: earned.count })
        : t("achievements.c9.times", { count: earned.count });
  return (
    <div className="c9c-row" style={{ "--c9c-at": at + "ms" } as CSSProperties}>
      <C9Medal item={item} small className="c9-medal c9c-row__medal" />
      <span className="c9c-row__name">
        {isNew ? <span className="c9c-dot" aria-hidden="true" /> : null}
        {achievementName(item, t)}
      </span>
      <span className="c9c-row__times" data-once={once ? "true" : undefined}>{times}</span>
      {rarityShown ? (
        <span className="c9c-row__rarity" data-notable={rarity && rarityIsNotable(item, rarity) ? "true" : undefined}>
          {rarity ? rarityTierName(item, rarity, t) : null}
        </span>
      ) : null}
      <span className="c9c-row__day">{day ? shortDay(day, effectiveLanguage) : null}</span>
    </div>
  );
}

/** The next almost-there goal as the row that follows the new ones. */
function NextRow({ entry, at }: { readonly entry: AlmostThereEntry; readonly at: number }) {
  const { effectiveLanguage, t } = useLocalization();
  return (
    <div className="c9c-next" style={{ "--c9c-at": at + "ms" } as CSSProperties}>
      <p className="c9c-next__label">{t("achievements.near.title")}</p>
      <div className="c9c-row c9c-row--next">
        <C9Medal item={entry.item} small className="c9-medal c9c-row__medal" />
        <span className="c9c-row__name">{achievementName(entry.item, t)}</span>
        <span className="c9c-goal">
          <span className="c9c-goal__left">{nearLeft(entry, t, effectiveLanguage)}</span>
          <span className="c9c-bar" aria-hidden="true"><span style={{ "--c9-share": entry.share } as CSSProperties} /></span>
          <span className="c9c-goal__share">{percentText(entry.share, effectiveLanguage)}</span>
        </span>
      </div>
    </div>
  );
}

/** One or several new: the lead as the hero, the others as table rows under it, then the next goal. */
function Excerpt({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  const [lead, ...others] = ordered;
  const next = useNextGoal(ordered);
  const rarityShown = ordered.some((item) => shownRarity(item) !== null);
  return (
    <>
      <p className="c9c-eyebrow">
        {others.length > 0 ? t("achievements.dialog.eyebrowMany", { count: ordered.length }) : t("achievements.dialog.eyebrow")}
      </p>
      <Hero item={lead} count="nth" title={<h2 id={titleId} className="c9c-title">{achievementName(lead, t)}</h2>} />
      <div className="c9c-table" data-rarity={rarityShown ? "shown" : "none"}>
        {others.map((item, index) => (
          <Row key={item.definition.id} item={item} rarityShown={rarityShown} count="nth" isNew at={FIRST_ROW_AT_MS + index * ROW_STEP_MS} />
        ))}
        {next ? <NextRow entry={next} at={FIRST_ROW_AT_MS + others.length * ROW_STEP_MS + 60} /> : null}
      </div>
    </>
  );
}

/** First look: what was found with its tiers on top, the lead as the hero, the rest under their groups. */
function FirstLook({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  const [lead, ...rest] = ordered;
  const holdings = achievementHoldings(ordered);
  const rarityShown = ordered.some((item) => shownRarity(item) !== null);
  const groups = ACHIEVEMENT_GROUPS
    .map((group) => ({ group, items: rest.filter((item) => item.definition.group === group) }))
    .filter(({ items }) => items.length > 0);
  let row = 0;
  return (
    <>
      <div className="c9c-look-head">
        <h2 id={titleId} className="c9c-title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
        <p className="c9c-look-head__body">{t("achievements.dialog.firstLookBody")}</p>
        {holdings ? <C9Held holdings={holdings} className="c9-held c9c-held" /> : null}
      </div>
      <Hero item={lead} count="times" title={<p className="c9c-hero__name">{achievementName(lead, t)}</p>} />
      <div className="c9c-table c9c-table--look" data-rarity={rarityShown ? "shown" : "none"}>
        {groups.map(({ group, items }) => (
          <section key={group} className="c9c-group" aria-label={t(("achievements.group." + group) as TranslationKey)}>
            <p className="c9c-group__title" aria-hidden="true">{t(("achievements.group." + group) as TranslationKey)}</p>
            {items.map((item) => (
              <Row key={item.definition.id} item={item} rarityShown={rarityShown} count="times" at={FIRST_ROW_AT_MS + row++ * ROW_STEP_MS} />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

export function C9Card({ ordered, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { t } = useLocalization();
  return (
    <div className="c9c">
      {showFirstLook ? <FirstLook ordered={ordered} titleId={titleId} /> : <Excerpt ordered={ordered} titleId={titleId} />}
      <div className="c9c-actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </div>
  );
}
