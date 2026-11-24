import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { achievementBadgeStage } from "../../achievementBadge";
import type { AchievementId } from "../../achievementCatalog";
import { achievementHoldings, almostThere } from "../../achievementCollection";
import { achievementCondition, achievementDay, achievementName, rarityIsNotable, rarityTierName, shownRarity, timesLabel } from "../../achievementCopy";
import { progressShare, progressText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutTabProps } from "../types";
import { C9Detail } from "./C9Detail";
import { C9Held, C9Medal } from "./C9Parts";
import { nearLeft, percentText, shortDay } from "./c9Copy";
import "./c9-tab.css";

const LEAD_COUNT = 3;
const STAGE_RANK: Record<string, number> = { ring: 3, gold: 2, silver: 1 };

/** The held medals to lead with: the rarest first, then the highest metal, then the most earned. */
function leadMedals(items: readonly AchievementItem[]): AchievementItem[] {
  return items
    .filter((item) => item.earned)
    .map((item) => ({ item, share: shownRarity(item)?.percent ?? Infinity, stage: STAGE_RANK[achievementBadgeStage(item)] ?? 0, count: item.earned?.count ?? 0 }))
    .sort((a, b) => a.share - b.share || b.stage - a.stage || b.count - a.count)
    .slice(0, LEAD_COUNT)
    .map(({ item }) => item);
}

/** What opens when nothing has been chosen: one just earned, else the one earned most recently (on a tie, the repeatable). */
function latestEarned(items: readonly AchievementItem[], isNew: (item: AchievementItem) => boolean): AchievementItem | undefined {
  const fresh = items.find(isNew);
  if (fresh) return fresh;
  return items.filter((item) => item.earned).sort((left, right) =>
    (right.earned?.lastDay ?? "").localeCompare(left.earned?.lastDay ?? "")
    || Number(right.definition.repeatable) - Number(left.definition.repeatable)
    || (right.earned?.count ?? 0) - (left.earned?.count ?? 0))[0];
}

const NEAR_LIMIT = 3;
const SKELETON_ROWS = 7;

function Columns({ rarityShown }: { readonly rarityShown: boolean }) {
  const { t } = useLocalization();
  return (
    <div className="c9-cols" aria-hidden="true">
      <span className="c9-cols__name">{t("achievements.c9.col.name")}</span>
      <span className="c9-cols__condition">{t("achievements.c9.col.condition")}</span>
      {rarityShown ? <span className="c9-cols__rarity">{t("achievements.c9.col.rarity")}</span> : null}
      <span className="c9-cols__times">{t("achievements.c9.col.times")}</span>
      <span className="c9-cols__last">{t("achievements.c9.col.last")}</span>
    </div>
  );
}

function C9Loading({ label }: { readonly label: string }) {
  return (
    <div className="c9 c9--loading">
      <div className="editorial-panel c9-sheet" data-rarity="none">
        <div className="c9-head">
          <p className="c9-head__count" role="status">{label}</p>
        </div>
        <Columns rarityShown={false} />
        <div aria-hidden="true">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <div key={index} className="c9-row c9-row--skeleton">
              <span className="c9-medal c9-row__medal c9-skeleton c9-skeleton--medal" />
              <span className="c9-row__name"><span className="c9-skeleton c9-skeleton--name" /></span>
              <span className="c9-row__condition"><span className="c9-skeleton c9-skeleton--line" /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type RowProps = {
  readonly item: AchievementItem;
  readonly open: boolean;
  readonly detailId: string;
  readonly isNew: boolean;
  readonly rarityShown: boolean;
  readonly onOpen: () => void;
};

/** One achievement as a list row; the whole row is the button that opens its record. */
function Row({ item, open, detailId, isNew, rarityShown, onOpen }: RowProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const name = achievementName(item, t);
  const rarity = shownRarity(item);
  const progress = earned || definition.hidden ? null : progressText(item, t, effectiveLanguage);
  const day = achievementDay(item);
  return (
    <button
      type="button"
      className="c9-row"
      data-state={earned ? "earned" : "locked"}
      data-id={definition.id}
      aria-pressed={open}
      aria-controls={open ? detailId : undefined}
      aria-label={t(earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
      onClick={onOpen}
    >
      <C9Medal item={item} small className="c9-medal c9-row__medal" />
      <span className="c9-row__name">
        {isNew ? <span className="c9-dot" aria-hidden="true" /> : null}
        {name}
      </span>
      <span className="c9-row__condition">{achievementCondition(item, t)}</span>
      {rarityShown ? (
        <span className="c9-row__rarity" data-notable={rarity && rarityIsNotable(item, rarity) ? "true" : undefined}>
          {rarity ? rarityTierName(item, rarity, t) : null}
        </span>
      ) : null}
      {earned ? (
        <>
          <span className="c9-row__times" data-once={earned.count === 1 ? "true" : undefined}>
            {earned.count > 1 ? t("achievements.c9.times", { count: earned.count }) : timesLabel(1, t)}
          </span>
          <span className="c9-row__last">{day ? shortDay(day, effectiveLanguage) : null}</span>
        </>
      ) : progress ? (
        <span className="c9-row__progress">
          <span className="c9-bar" aria-hidden="true"><span style={{ "--c9-share": progressShare(item) } as CSSProperties} /></span>
          <span className="c9-row__progress-text">{progress}</span>
          <span className="c9-row__progress-share">{percentText(progressShare(item), effectiveLanguage)}</span>
        </span>
      ) : (
        <span className="c9-row__progress c9-row__progress--none">{t("achievements.c9.notYet")}</span>
      )}
    </button>
  );
}

/** Insights › Achievements as a list view: held count and tiers over column labels, almost-there pinned, then the four groups. */
export function C9Tab({ model }: AchievementLayoutTabProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { status, items, byGroup, earnedCount, failedEmpty, choose, isNew, onOpenDay, onRetry } = model;
  const [open, setOpen] = useState(true);
  // Until the person picks a row, the open one follows the latest earned as the records arrive.
  const [picked, setPicked] = useState(false);
  const latest = useMemo(() => latestEarned(items, isNew), [items, isNew]);
  const selected = picked ? model.selected : latest ?? model.selected;
  const [reveal, setReveal] = useState<AchievementId | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const near = useMemo(() => almostThere(items, { limit: NEAR_LIMIT }), [items]);
  const holdings = useMemo(() => achievementHoldings(items), [items]);
  const lead = useMemo(() => leadMedals(items), [items]);
  const rarityShown = items.some((item) => shownRarity(item) !== null);
  const selectedId = selected?.definition.id;

  useEffect(() => {
    if (!reveal) return;
    const entry = sheetRef.current?.querySelector<HTMLElement>(`.c9-entry[data-entry="${reveal}"]`);
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    entry?.scrollIntoView?.({ block: "nearest", behavior: still ? "auto" : "smooth" });
    setReveal(null);
  }, [reveal]);

  if (model.loading) return <C9Loading label={t("achievements.loading")} />;

  function openRow(id: AchievementId) {
    setPicked(true);
    choose(id);
    setOpen(true);
  }

  function closeAndFocus(id: AchievementId) {
    setOpen(false);
    sheetRef.current?.querySelector<HTMLElement>(`.c9-row[data-id="${id}"]`)?.focus();
  }

  function openFromNear(id: AchievementId) {
    openRow(id);
    setReveal(id);
  }

  return (
    <div className="c9">
      <div ref={sheetRef} className="editorial-panel c9-sheet" data-rarity={rarityShown ? "shown" : "none"}>
        <div className="c9-head">
          <div className="c9-head__text">
            <p className="c9-head__count">{t("achievements.summary", { earned: earnedCount, total: items.length })}</p>
            {holdings ? <C9Held holdings={holdings} className="c9-held c9-head__held" /> : null}
          </div>
          {lead.length > 0 ? (
            <ul className="c9-lead">
              {lead.map((item) => (
                <li key={item.definition.id}>
                  <button
                    type="button"
                    className="c9-lead__item"
                    aria-label={t("achievements.c9.featured", { name: achievementName(item, t) })}
                    title={achievementName(item, t)}
                    onClick={() => openFromNear(item.definition.id)}
                  >
                    <C9Medal item={item} small className="c9-medal c9-lead__medal" />
                    <span className="c9-lead__times" aria-hidden="true">
                      {item.earned && item.earned.count > 1 ? t("achievements.c9.times", { count: item.earned.count }) : timesLabel(1, t)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {status === "error" && !failedEmpty ? (
            <p className="c9-head__notice" role="alert">
              <span>{t("achievements.error")}</span>
              <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
            </p>
          ) : null}
        </div>

        {failedEmpty ? (
          <div className="c9-failed" role="alert">
            <p>{t("achievements.error")}</p>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </div>
        ) : null}

        <Columns rarityShown={rarityShown} />

        {near.length > 0 ? (
          <section className="c9-group c9-near" data-almost-there aria-labelledby="c9-near-title">
            <div className="c9-group__head">
              <h2 id="c9-near-title" className="c9-group__title">{t("achievements.near.title")}</h2>
            </div>
            {near.map((entry) => {
              const { item } = entry;
              const name = achievementName(item, t);
              const left = nearLeft(entry, t, effectiveLanguage);
              return (
                <button
                  key={item.definition.id + entry.kind}
                  type="button"
                  className="c9-row c9-near__row"
                  data-kind={entry.kind}
                  data-almost-there-id={item.definition.id}
                  aria-label={t("achievements.c9.nearLabel", { name, left })}
                  onClick={() => openFromNear(item.definition.id)}
                >
                  <C9Medal item={item} small className="c9-medal c9-row__medal" />
                  <span className="c9-row__name">{name}</span>
                  <span className="c9-near__goal">
                    <span className="c9-near__left">{left}</span>
                    <span className="c9-bar c9-bar--near" aria-hidden="true"><span style={{ "--c9-share": entry.share } as CSSProperties} /></span>
                    <span className="c9-near__share">{percentText(entry.share, effectiveLanguage)}</span>
                  </span>
                </button>
              );
            })}
          </section>
        ) : null}

        {byGroup.map(({ group, items: groupItems }) => (
          <section key={group} className="c9-group" aria-labelledby={"c9-group-" + group}>
            <div className="c9-group__head">
              <h2 id={"c9-group-" + group} className="c9-group__title">{t(("achievements.group." + group) as TranslationKey)}</h2>
              <span className="c9-group__count">{groupItems.filter((item) => item.earned).length}/{groupItems.length}</span>
            </div>
            {groupItems.map((item) => {
              const id = item.definition.id;
              const expanded = open && id === selectedId;
              const detailId = "c9-record-" + id;
              return (
                <div key={id} className="c9-entry" data-entry={id} data-open={expanded ? "true" : undefined}>
                  <Row item={item} open={expanded} detailId={detailId} isNew={isNew(item)} rarityShown={rarityShown} onOpen={() => openRow(id)} />
                  {expanded ? <C9Detail id={detailId} item={item} isNew={isNew(item)} onOpenDay={onOpenDay} onClose={() => closeAndFocus(id)} /> : null}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <p className="c9-footnote" role={status === "loading" ? "status" : undefined}>
        {status === "loading" ? t("achievements.loading") : t("achievements.note")}
      </p>
    </div>
  );
}
