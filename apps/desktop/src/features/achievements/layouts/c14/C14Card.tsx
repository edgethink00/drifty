import type { CSSProperties } from "react";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { Translate } from "../../../localization/translate";
import { achievementBadgeStage } from "../../achievementBadge";
import {
  achievementCondition,
  achievementDay,
  achievementName,
  formatAchievementDay,
  medalName,
  raritySentence,
  rarityTierName,
  shownRarity,
  timesLabel,
} from "../../achievementCopy";
import { historyFor } from "../../achievementHistory";
import { nextMedal } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C14Holdings } from "./C14Holdings";
import { C14Medal } from "./C14Medal";
import { C14Ribbon } from "./C14Ribbon";
import { ordinal } from "./c14Copy";

const SINGLE_TICKS = 4;
const LEAD_TICKS = 3;
const ROW_STEP_MS = 60;

function isGold(item: AchievementItem): boolean {
  const stage = achievementBadgeStage(item);
  return stage === "gold" || stage === "ring";
}

/** With rarity, the tier and the share; without, the medal metal and what it takes to climb. */
function standingLine(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const rarity = shownRarity(item);
  if (rarity) return t("achievements.c14.tier", { tier: rarityTierName(item, rarity, t) }) + " · " + raritySentence(rarity, t, language, "card");
  const metal = medalName(item, t);
  const next = nextMedal(item);
  return metal ? (next ? metal + " · " + t(next.key, { remaining: next.remaining }) : metal) : null;
}

/** "57th time · November 20" for a repeat, "Earned November 2" for a first. */
function whenLine(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const earned = item.earned;
  if (!earned) return null;
  const day = formatAchievementDay(achievementDay(item) ?? earned.firstDay, language);
  return item.definition.repeatable && earned.count > 1
    ? t("achievements.c14.nthTime", { nth: ordinal(earned.count, t, language) }) + " · " + day
    : t("achievements.dialog.earnedOn", { date: day });
}

/** The lead's own days on the rail; a first time or a one-off reads better as a sentence. */
function LeadRecord({ item, ticks }: { readonly item: AchievementItem; readonly ticks: number }) {
  const { effectiveLanguage, t } = useLocalization();
  const history = historyFor(item);
  const when = whenLine(item, t, effectiveLanguage);
  if (!item.definition.repeatable || !history || history.days.length + history.earlier < 2) {
    return when ? <p className="c14-card__when">{when}</p> : null;
  }
  const total = history.days.length + history.earlier;
  return (
    <div className="c14-card__record">
      <C14Ribbon days={history.days} total={total} max={ticks} gold={isGold(item)} className="c14-card__ribbon" />
      <p className="c14-card__when">{t("achievements.c14.nthTime", { nth: ordinal(total, t, effectiveLanguage) })}</p>
    </div>
  );
}

/** One found or also-earned achievement as a row: medal, name and condition, then its latest day. */
function CardRow({ item, index }: { readonly item: AchievementItem; readonly index: number }) {
  const { effectiveLanguage, t } = useLocalization();
  const earned = item.earned;
  const day = earned ? formatAchievementDay(achievementDay(item) ?? earned.firstDay, effectiveLanguage) : null;
  const count = earned && item.definition.repeatable && earned.count > 1 ? timesLabel(earned.count, t) : null;
  return (
    <li className="c14-cardrow" style={{ "--c14-row-delay": index * ROW_STEP_MS + "ms" } as CSSProperties}>
      <C14Medal item={item} small className="c14-medal c14-cardrow__medal" />
      <span className="c14-cardrow__text">
        <span className="c14-cardrow__name">{achievementName(item, t)}</span>
        <span className="c14-cardrow__condition">{achievementCondition(item, t)}</span>
      </span>
      <span className="c14-cardrow__when" data-metal={isGold(item) ? "gold" : "silver"}>
        {count ? <span className="c14-cardrow__count">{count}</span> : null}
        {day ? <span className="c14-cardrow__day">{day}</span> : null}
      </span>
    </li>
  );
}

function Single({ lead, titleId }: { readonly lead: AchievementItem; readonly titleId: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const standing = standingLine(lead, t, effectiveLanguage);
  return (
    <div className="c14-card c14-card--single">
      <p className="c14-card__eyebrow">{t("achievements.dialog.eyebrow")}</p>
      <div className="c14-card__stage">
        <C14Medal item={lead} className="c14-medal c14-card__hero" />
      </div>
      <h2 id={titleId} className="c14-card__title">{achievementName(lead, t)}</h2>
      <p className="c14-card__condition">{achievementCondition(lead, t)}</p>
      <LeadRecord item={lead} ticks={SINGLE_TICKS} />
      {standing ? <p className="c14-card__standing">{standing}</p> : null}
    </div>
  );
}

function Several({ ordered, lead, others, titleId }: { readonly ordered: readonly AchievementItem[]; readonly lead: AchievementItem; readonly others: readonly AchievementItem[]; readonly titleId: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const standing = standingLine(lead, t, effectiveLanguage);
  return (
    <div className="c14-card c14-card--several">
      <p className="c14-card__eyebrow">{t("achievements.dialog.eyebrowMany", { count: ordered.length })}</p>
      <div className="c14-card__lead">
        <C14Medal item={lead} className="c14-medal c14-card__hero" />
        <div className="c14-card__lead-text">
          <h2 id={titleId} className="c14-card__title">{achievementName(lead, t)}</h2>
          <p className="c14-card__condition">{achievementCondition(lead, t)}</p>
          <LeadRecord item={lead} ticks={LEAD_TICKS} />
          {standing ? <p className="c14-card__standing">{standing}</p> : null}
        </div>
      </div>
      <p className="c14-card__also">{t("achievements.dialog.alsoEarned")}</p>
      <ul className="c14-cardrows">
        {others.map((item, index) => <CardRow key={item.definition.id} item={item} index={index} />)}
      </ul>
    </div>
  );
}

function FirstLook({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  return (
    <div className="c14-card c14-card--look">
      <p className="c14-card__eyebrow">{t("achievements.dialog.firstLookEyebrow")}</p>
      <h2 id={titleId} className="c14-card__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
      <p className="c14-card__condition">{t("achievements.dialog.firstLookBody")}</p>
      <C14Holdings items={ordered} className="c14-card__tiers" />
      <ul className="c14-cardrows">
        {ordered.map((item, index) => <CardRow key={item.definition.id} item={item} index={index} />)}
      </ul>
    </div>
  );
}

export function C14Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { t } = useLocalization();
  return (
    <>
      {showFirstLook ? <FirstLook ordered={ordered} titleId={titleId} />
        : others.length > 0 ? <Several ordered={ordered} lead={lead} others={others} titleId={titleId} />
          : <Single lead={lead} titleId={titleId} />}
      <div className="c14-card__actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </>
  );
}
