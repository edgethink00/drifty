import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import { AchievementMedal } from "../../AchievementMedal";
import { achievementBadgeStage } from "../../achievementBadge";
import {
  achievementDay,
  formatAchievementDay,
  medalName,
  rarityHolders,
  rarityIsNotable,
  rarityReadsAsFew,
  rarityTierName,
  shownRarity,
  timesLabel,
} from "../../achievementCopy";
import { achievementMilestoneProgress } from "../../achievementMilestones";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import { formatRarityBasis, formatRarityPercent } from "../../achievementRarity";
import type { AchievementItem } from "../../useAchievements";

type Status = {
  readonly lead: string;
  readonly medal: string | null;
  readonly gold: boolean;
  readonly detail: string | null;
  readonly share: number | null;
  readonly tone: "gold" | "accent" | null;
  readonly quiet: boolean;
};

export function earnedRecord(item: AchievementItem, t: Translate, language: DisplayLanguage): string {
  const earned = item.earned;
  if (!earned) return "";
  return item.definition.repeatable && earned.count > 1
    ? timesLabel(earned.count, t)
    : formatAchievementDay(achievementDay(item) ?? earned.firstDay, language);
}

function statusOf(item: AchievementItem, t: Translate, language: DisplayLanguage): Status {
  const { definition, earned } = item;
  if (earned) {
    const stage = achievementBadgeStage(item);
    const next = nextMedal(item);
    const milestone = !next && definition.repeatable ? achievementMilestoneProgress(earned.count) : null;
    return {
      lead: earnedRecord(item, t, language),
      medal: medalName(item, t),
      gold: stage === "gold" || stage === "ring",
      detail: next ? t(next.key, { remaining: next.remaining }) : milestone ? t("achievements.milestone.next", { target: milestone.target }) : null,
      share: next ? next.share : milestone ? milestone.share : null,
      tone: next || milestone ? "gold" : null,
      quiet: false,
    };
  }
  const progress = definition.hidden ? null : progressText(item, t, language);
  if (progress && progressShare(item) >= 1) {
    return { lead: progress, medal: null, gold: false, detail: null, share: null, tone: null, quiet: false };
  }
  if (progress) {
    return { lead: remainingText(item, t, language) ?? progress, medal: null, gold: false, detail: progress, share: progressShare(item), tone: "accent", quiet: false };
  }
  return { lead: t("achievements.notEarned"), medal: null, gold: false, detail: null, share: null, tone: null, quiet: true };
}

export function C2Status({ item, t, language }: { readonly item: AchievementItem; readonly t: Translate; readonly language: DisplayLanguage }) {
  const status = statusOf(item, t, language);
  return (
    <span className="c2-status" data-quiet={status.quiet ? "true" : undefined}>
      <span className="c2-status__lead">
        {status.lead}
        {status.medal ? (
          <span className="c2-status__medal" data-gold={status.gold ? "true" : undefined}>
            <span aria-hidden="true"> · </span>
            {status.medal}
          </span>
        ) : null}
      </span>
      {status.detail ? (
        <span className="c2-status__detail">
          {status.share !== null ? (
            <span className="c2-bar" data-tone={status.tone ?? undefined} aria-hidden="true">
              <span style={{ width: Math.round(status.share * 100) + "%" }} />
            </span>
          ) : null}
          <span className="c2-status__detail-text">{status.detail}</span>
        </span>
      ) : null}
    </span>
  );
}

export function rarityFigure(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const rarity = shownRarity(item);
  if (!rarity) return null;
  return rarityReadsAsFew(rarity)
    ? t("achievements.c2.rarityFew", { count: formatRarityBasis(rarityHolders(rarity), language), basis: formatRarityBasis(rarity.basisCount, language) })
    : t("achievements.c2.rarityShare", { percent: formatRarityPercent(rarity.percent, language) });
}

export function C2Rarity({ item, t, language }: { readonly item: AchievementItem; readonly t: Translate; readonly language: DisplayLanguage }) {
  const rarity = shownRarity(item);
  const figure = rarityFigure(item, t, language);
  if (!rarity || !figure) return <span className="c2-rarity" />;
  return (
    <span className="c2-rarity">
      <span className="c2-rarity__figure">{figure}</span>
      <span className="c2-rarity__tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</span>
    </span>
  );
}

export function C2Plinth({ item, size, arrive = false }: { readonly item: AchievementItem; readonly size: "detail" | "hero" | "lead"; readonly arrive?: boolean }) {
  return (
    <span className={"c2-plinth c2-plinth--" + size} data-arrive={arrive ? "true" : undefined}>
      <span className="c2-plinth__floor" aria-hidden="true" />
      <span className="c2-plinth__medal">
        <AchievementMedal item={item} size="xl" />
      </span>
    </span>
  );
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}
