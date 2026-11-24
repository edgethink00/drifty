import { useMemo, useState, type CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import { achievementBadgeStage } from "../../achievementBadge";
import { ACHIEVEMENT_DEFINITIONS } from "../../achievementCatalog";
import { HELD_MEDALS, almostThere } from "../../achievementCollection";
import {
  achievementCondition,
  achievementDay,
  achievementName,
  formatAchievementDay,
  raritySentence,
  shownRarity,
} from "../../achievementCopy";
import { REVIEW_RARITY, useAchievementReviewState } from "../../achievementDesignReview";
import { historyEntries, historyFor } from "../../achievementHistory";
import { nextMedal, remainingText } from "../../achievementProgress";
import { ACHIEVEMENT_TIERS, achievementTier } from "../../achievementRarity";
import { readAchievementStore } from "../../achievementStore";
import { buildAchievementItems, type AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C10Medal, YearStrip, medalRows, tierRows, type SummaryRow } from "./c10Parts";
import "./c10-card.css";

/** Every achievement as it stands now: the new ones as given, the rest from the saved record (none on the first look), rarity as the tab gets it. */
function collectionNow(fresh: readonly AchievementItem[], saved: boolean, mockRarity: boolean): AchievementItem[] {
  const byId = new Map(fresh.map((item) => [item.definition.id, item]));
  const stored = new Map((saved ? buildAchievementItems(readAchievementStore(), mockRarity ? REVIEW_RARITY : {}) : []).map((item) => [item.definition.id, item]));
  return ACHIEVEMENT_DEFINITIONS.map((definition) => byId.get(definition.id)
    ?? stored.get(definition.id)
    ?? { definition, earned: null, progress: null, rarity: null });
}

/** The same collection just before: each new one a time short, or not held at all when this was its first time. */
function collectionBefore(now: readonly AchievementItem[], fresh: readonly AchievementItem[], firstLook: boolean): AchievementItem[] {
  const freshIds = new Set(fresh.map((item) => item.definition.id));
  return now.map((item) => {
    if (!freshIds.has(item.definition.id) || !item.earned) return item;
    if (firstLook || item.earned.count <= 1) return { ...item, earned: null };
    return { ...item, earned: { ...item.earned, count: item.earned.count - 1 } };
  });
}

type TickRow = SummaryRow & { readonly from: number; readonly joined: boolean };

/**
 * Held by rarity tier when every new one has a rarity to show, else by medal
 * metal. Held ones without a rarity of their own take the catalogue's tier
 * (achievementTier's own fallback), so a tier row counts the whole collection.
 */
function summaryRows(before: readonly AchievementItem[], now: readonly AchievementItem[], lead: AchievementItem, byRarity: boolean, t: ReturnType<typeof useLocalization>["t"]): TickRow[] {
  const held = (items: readonly AchievementItem[]) => items.filter((item) => item.earned);
  if (byRarity) {
    const tierOf = (item: AchievementItem) => achievementTier(item.definition, shownRarity(item));
    const count = (items: readonly AchievementItem[]) => ACHIEVEMENT_TIERS.map((tier) => ({ tier, count: held(items).filter((item) => tierOf(item) === tier).length }));
    const leadTier = tierOf(lead);
    const after = tierRows(count(now), t);
    const prior = count(before);
    return after.map((row, index) => ({ ...row, from: prior[index]?.count ?? 0, joined: ACHIEVEMENT_TIERS[index] === leadTier }));
  }
  const count = (items: readonly AchievementItem[]) => HELD_MEDALS.map((medal) => ({ medal, count: held(items).filter((item) => achievementBadgeStage(item) === medal).length }));
  const leadMedal = achievementBadgeStage(lead);
  const after = medalRows(count(now), t);
  const prior = count(before);
  return after.map((row, index) => ({ ...row, from: prior[index]?.count ?? 0, joined: HELD_MEDALS[index] === leadMedal }));
}

/** A count that rolls from its old value to the new one; the old value is drawn only. */
function Tick({ from, to, delay }: { readonly from: number; readonly to: number; readonly delay: number }) {
  if (from === to) return <span className="c10c-tick">{to}</span>;
  return (
    <span className="c10c-tick" data-moving="true" style={{ "--c10c-delay": delay + "ms" } as CSSProperties}>
      <span className="c10c-tick__from" aria-hidden="true">{from}</span>
      <span className="c10c-tick__to">{to}</span>
    </span>
  );
}

const TICK_AT_MS = 520;
const TICK_STEP_MS = 70;

function Summary({ before, now, lead, byRarity }: { readonly before: readonly AchievementItem[]; readonly now: readonly AchievementItem[]; readonly lead: AchievementItem; readonly byRarity: boolean }) {
  const { t } = useLocalization();
  const rows = summaryRows(before, now, lead, byRarity, t);
  const heldNow = now.filter((item) => item.earned).length;
  const heldBefore = before.filter((item) => item.earned).length;
  let step = 0;
  return (
    <div className="c10c-sum">
      <p className="c10c-sum__figure">
        <span className="c10c-sum__num"><Tick from={heldBefore} to={heldNow} delay={TICK_AT_MS} /></span>
        <span className="c10c-sum__of">/{now.length}</span>
      </p>
      <p className="c10c-sum__label">{t("achievements.c10.held")}</p>
      <p className="c10c-sum__title">{byRarity ? t("achievements.c10.byTier") : t("achievements.c10.byMedal")}</p>
      <ul className="c10c-sum__list" data-tier-summary>
        {rows.map((row) => {
          const moving = row.from !== row.count;
          const delay = TICK_AT_MS + (moving ? step++ : 0) * TICK_STEP_MS;
          return (
            <li key={row.key} className="c10c-row" data-joined={row.joined ? "true" : undefined} data-empty={row.count === 0 ? "true" : undefined} data-moving={moving ? "true" : undefined}>
              <span className="c10c-row__name">{row.label}</span>
              <span className="c10c-row__count"><Tick from={row.from} to={row.count} delay={delay} /></span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NextGoal({ now, lead }: { readonly now: readonly AchievementItem[]; readonly lead: AchievementItem }) {
  const { effectiveLanguage, t } = useLocalization();
  const next = almostThere(now, { limit: 4 }).find((entry) => entry.item.definition.id !== lead.definition.id);
  if (!next) return null;
  const step = next.kind === "medal" ? nextMedal(next.item) : null;
  const left = step ? t(step.key, { remaining: step.remaining }) : remainingText(next.item, t, effectiveLanguage);
  return <p className="c10c-next">{t("achievements.c10.nextGoal", { name: achievementName(next.item, t), left: left ?? "" })}</p>;
}

function Single({ lead, now, titleId }: { readonly lead: AchievementItem; readonly now: readonly AchievementItem[]; readonly titleId: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const rarity = shownRarity(lead);
  const history = historyFor(lead);
  const entries = history ? historyEntries(history) : [];
  const day = achievementDay(lead);
  const count = lead.earned?.count ?? 1;
  return (
    <div className="c10c-lead c10c-lead--single">
      <p className="c10c-eyebrow">{t("achievements.dialog.eyebrow")}</p>
      <div className="c10c-stage">
        <C10Medal item={lead} className="c10-medal c10c-hero" />
        {lead.definition.repeatable && count > 1 ? <span className="c10c-nth">{t("achievements.c10.nthCard", { count })}</span> : null}
      </div>
      <div className="c10c-text">
        <h2 id={titleId} className="c10c-title">{achievementName(lead, t)}</h2>
        <p className="c10c-condition">{achievementCondition(lead, t)}</p>
        {rarity ? <p className="c10c-rarity">{raritySentence(rarity, t, effectiveLanguage, "card")}</p> : null}
      </div>
      {day ? (
        <div className="c10c-strip">
          <YearStrip entries={entries.length > 0 ? entries : [{ day, ordinal: count }]} litDay={day} label={() => t("achievements.dialog.earnedOn", { date: formatAchievementDay(day, effectiveLanguage) })} />
        </div>
      ) : null}
      <NextGoal now={now} lead={lead} />
    </div>
  );
}

const OTHERS_AT_MS = 300;
const OTHERS_STEP_MS = 60;

function Several({ ordered, lead, now, titleId }: { readonly ordered: readonly AchievementItem[]; readonly lead: AchievementItem; readonly now: readonly AchievementItem[]; readonly titleId: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const rarity = shownRarity(lead);
  const count = lead.earned?.count ?? 1;
  const others = ordered.slice(1);
  return (
    <div className="c10c-lead">
      <div className="c10c-head">
        <div className="c10c-mark">
          <C10Medal item={lead} className="c10-medal c10c-hero c10c-hero--several" />
          {lead.definition.repeatable && count > 1 ? <span className="c10c-nth">{t("achievements.c10.nthCard", { count })}</span> : null}
        </div>
        <div className="c10c-text">
          <p className="c10c-eyebrow">{t("achievements.dialog.eyebrowMany", { count: ordered.length })}</p>
          <h2 id={titleId} className="c10c-title">{achievementName(lead, t)}</h2>
          <p className="c10c-condition">{achievementCondition(lead, t)}</p>
          {rarity ? <p className="c10c-rarity">{raritySentence(rarity, t, effectiveLanguage, "card")}</p> : null}
        </div>
      </div>
      <section className="c10c-others" aria-label={t("achievements.dialog.alsoEarned")}>
        <p className="c10c-others__title" aria-hidden="true">{t("achievements.dialog.alsoEarned")}</p>
        <ul className="c10c-others__list" style={{ "--c10c-cols": others.length <= 4 ? others.length : Math.ceil(others.length / 2) } as CSSProperties}>
          {others.map((item, index) => (
            <li key={item.definition.id} className="c10c-other" style={{ "--c10c-delay": OTHERS_AT_MS + index * OTHERS_STEP_MS + "ms" } as CSSProperties}>
              <C10Medal item={item} className="c10-medal c10c-other__medal" />
              <span className="c10c-other__name">{achievementName(item, t)}</span>
              {item.definition.repeatable && (item.earned?.count ?? 0) > 1 ? (
                <span className="c10c-other__times">{t("achievements.c10.multiplier", { count: item.earned?.count ?? 0 })}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <NextGoal now={now} lead={lead} />
    </div>
  );
}

function FirstLook({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  return (
    <div className="c10c-lead">
      <div className="c10c-text c10c-text--start">
        <p className="c10c-eyebrow">{t("achievements.dialog.firstLookEyebrow")}</p>
        <h2 id={titleId} className="c10c-title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
        <p className="c10c-condition">{t("achievements.dialog.firstLookBody")}</p>
      </div>
      <ul className="c10c-found">
        {ordered.map((item, index) => (
          <li key={item.definition.id} className="c10c-other" style={{ "--c10c-delay": 180 + index * OTHERS_STEP_MS + "ms" } as CSSProperties}>
            <C10Medal item={item} className="c10-medal c10c-other__medal" />
            <span className="c10c-other__name">{achievementName(item, t)}</span>
            {item.definition.repeatable && (item.earned?.count ?? 0) > 1 ? (
              <span className="c10c-other__times">{t("achievements.c10.multiplier", { count: item.earned?.count ?? 0 })}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The card: a summary column of what is held, ticking up as the new ones join, beside the new medal or medals. */
export function C10Card({ ordered, lead, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { t } = useLocalization();
  const { mockRarity } = useAchievementReviewState();
  const [now] = useState(() => collectionNow(ordered, !showFirstLook, mockRarity));
  const before = useMemo(() => collectionBefore(now, ordered, showFirstLook), [now, ordered, showFirstLook]);
  const byRarity = ordered.every((item) => shownRarity(item) !== null);
  return (
    <>
      <div className="c10c">
        <Summary before={before} now={now} lead={lead} byRarity={byRarity} />
        {showFirstLook ? <FirstLook ordered={ordered} titleId={titleId} />
          : ordered.length > 1 ? <Several ordered={ordered} lead={lead} now={now} titleId={titleId} />
            : <Single lead={lead} now={now} titleId={titleId} />}
      </div>
      <div className="c10c-actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </>
  );
}
