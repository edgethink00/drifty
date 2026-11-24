import { useMemo, useRef } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import type { AchievementId } from "../../achievementCatalog";
import { ACHIEVEMENT_GROUPS } from "../../achievementCatalog";
import { achievementHoldings, almostThere } from "../../achievementCollection";
import { achievementDay, achievementName } from "../../achievementCopy";
import { nextMedal, progressShare, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutTabProps } from "../types";
import { C10Detail } from "./C10Detail";
import { C10Medal, medalRows, shortDay, tierRows, type SummaryRow } from "./c10Parts";
import "./c10-tab.css";

function C10Loading({ label }: { readonly label: string }) {
  return (
    <div className="c10 c10--loading">
      <div className="c10-grid">
        <div className="c10-side">
          <p className="c10-held__label" role="status">{label}</p>
          <span className="c10-skeleton c10-skeleton--count" aria-hidden="true" />
          <span className="c10-skeleton c10-skeleton--line" aria-hidden="true" />
          <span className="c10-skeleton c10-skeleton--line" aria-hidden="true" />
        </div>
        <div className="c10-main" aria-hidden="true">
          <div className="c10-cabinet">
            {ACHIEVEMENT_GROUPS.map((group) => (
              <div key={group} className="c10-group">
                <span className="c10-skeleton c10-skeleton--label" />
                <div className="c10-group__grid">
                  {[0, 1, 2, 3].map((slot) => (
                    <span key={slot} className="c10-tile c10-tile--skeleton"><span className="c10-medal c10-tile__medal c10-skeleton c10-skeleton--medal" /></span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Held by rarity tier, or by medal metal when rarity is not known for every held one. */
function TierSummary({ items }: { readonly items: readonly AchievementItem[] }) {
  const { t } = useLocalization();
  const holdings = achievementHoldings(items);
  const rows: SummaryRow[] = !holdings ? [] : holdings.kind === "rarity" ? tierRows(holdings.tiers, t) : medalRows(holdings.medals, t);
  const title = holdings?.kind === "rarity" ? t("achievements.c10.byTier") : t("achievements.c10.byMedal");
  return (
    <section className="c10-side__block c10-tiers" data-tier-summary aria-label={holdings ? title : undefined}>
      {holdings ? (
        <>
          <p className="c10-side__label" aria-hidden="true">{title}</p>
          <ul className="c10-tiers__list">
            {rows.map((row) => (
              <li key={row.key} className="c10-tier" data-empty={row.count === 0 ? "true" : undefined}>
                <span className="c10-tier__name">{row.label}</span>
                <span className="c10-tier__count">{row.count}</span>
                <span className="c10-bar c10-tier__bar" aria-hidden="true"><span style={{ width: Math.round((row.count / holdings.total) * 100) + "%" }} /></span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="c10-side__quiet">{t("achievements.c10.noneHeld")}</p>
      )}
    </section>
  );
}

function AlmostThere({ items, onChoose }: { readonly items: readonly AchievementItem[]; readonly onChoose: (id: AchievementId) => void }) {
  const { effectiveLanguage, t } = useLocalization();
  const entries = useMemo(() => almostThere(items, { limit: 3 }), [items]);
  if (entries.length === 0) return null;
  return (
    <section className="c10-side__block c10-near" aria-labelledby="c10-near-title">
      <h2 id="c10-near-title" className="c10-side__label">{t("achievements.near.title")}</h2>
      <ol className="c10-near__list" data-almost-there>
        {entries.map(({ item, kind, share }) => {
          const step = kind === "medal" ? nextMedal(item) : null;
          const left = step ? t(step.key, { remaining: step.remaining }) : remainingText(item, t, effectiveLanguage);
          return (
            <li key={item.definition.id}>
              <button type="button" className="c10-near__item" data-almost-there-id={item.definition.id} onClick={() => onChoose(item.definition.id)}>
                <C10Medal item={item} small className="c10-medal c10-near__medal" />
                <span className="c10-near__text">
                  <span className="c10-near__name">{achievementName(item, t)}</span>
                  <span className="c10-near__left">{left}</span>
                  <span className="c10-bar c10-near__bar" aria-hidden="true"><span style={{ width: Math.round(share * 100) + "%" }} /></span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function tileLine(item: AchievementItem, t: ReturnType<typeof useLocalization>["t"], language: ReturnType<typeof useLocalization>["effectiveLanguage"]): string | null {
  const earned = item.earned;
  if (earned) {
    if (item.definition.repeatable && earned.count > 1) return t("achievements.c10.multiplier", { count: earned.count });
    return shortDay(achievementDay(item) ?? earned.firstDay, language);
  }
  if (item.definition.hidden) return null;
  return progressShare(item) > 0 ? null : t("achievements.c10.notYet");
}

/** Insights › Achievements: the summary column beside the medal cabinet, the chosen one's record as a band under it. */
export function C10Tab({ model }: AchievementLayoutTabProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { status, items, byGroup, earnedCount, failedEmpty, selected, choose, isNew, onOpenDay, onRetry } = model;
  const bandRef = useRef<HTMLElement>(null);
  const selectedId = selected?.definition.id;

  if (model.loading) return <C10Loading label={t("achievements.loading")} />;

  const pick = (id: AchievementId) => {
    choose(id);
    window.requestAnimationFrame(() => {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      bandRef.current?.scrollIntoView?.({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    });
  };

  return (
    <div className="c10">
      <div className="c10-grid">
        <div className="c10-side">
          <section className="c10-side__block c10-held">
            <p className="c10-held__figure" aria-hidden="true">
              <span className="c10-held__num">{earnedCount}</span>
              <span className="c10-held__of">/{items.length}</span>
            </p>
            <p className="c10-held__label">
              <span aria-hidden="true">{t("achievements.c10.held")}</span>
              <span className="c10-sr">{t("achievements.summary", { earned: earnedCount, total: items.length })}</span>
            </p>
            <span className="c10-bar c10-held__bar" aria-hidden="true"><span style={{ width: Math.round((earnedCount / Math.max(1, items.length)) * 100) + "%" }} /></span>
            {status === "error" && !failedEmpty ? (
              <p className="c10-notice" role="alert">
                <span>{t("achievements.error")}</span>
                <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
              </p>
            ) : null}
          </section>
          <TierSummary items={items} />
          <AlmostThere items={items} onChoose={pick} />
        </div>

        <div className="c10-main">
          <div className="c10-cabinet">
            {byGroup.map(({ group, items: groupItems }) => (
              <section key={group} className="c10-group" aria-labelledby={"c10-group-" + group}>
                <div className="c10-group__head">
                  <h2 id={"c10-group-" + group} className="c10-group__title">{t(("achievements.group." + group) as TranslationKey)}</h2>
                  <span className="c10-group__count">{groupItems.filter((item) => item.earned).length}/{groupItems.length}</span>
                </div>
                <div className="c10-group__grid">
                  {groupItems.map((item) => {
                    const name = achievementName(item, t);
                    const line = tileLine(item, t, effectiveLanguage);
                    const share = item.earned || item.definition.hidden ? 0 : progressShare(item);
                    return (
                      <button
                        key={item.definition.id}
                        type="button"
                        className="c10-tile"
                        data-state={item.earned ? "earned" : "locked"}
                        aria-pressed={item.definition.id === selectedId}
                        aria-label={t(item.earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
                        onClick={() => pick(item.definition.id)}
                      >
                        <C10Medal item={item} className="c10-medal c10-tile__medal" />
                        <span className="c10-tile__name">
                          {isNew(item) ? <span className="c10-dot" aria-hidden="true" /> : null}
                          {name}
                        </span>
                        {share > 0 ? (
                          <span className="c10-bar c10-tile__bar" aria-hidden="true"><span style={{ width: Math.round(share * 100) + "%" }} /></span>
                        ) : line ? (
                          <span className="c10-tile__line" data-times={item.earned && item.definition.repeatable && item.earned.count > 1 ? "true" : undefined}>{line}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {failedEmpty ? (
            <div className="c10-band c10-band--error" role="alert">
              <p>{t("achievements.error")}</p>
              <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
            </div>
          ) : selected ? (
            <C10Detail ref={bandRef} item={selected} isNew={isNew(selected)} onOpenDay={onOpenDay} />
          ) : null}

          <p className="c10-footnote" role={status === "loading" ? "status" : undefined}>
            {status === "loading" ? t("achievements.loading") : t("achievements.note")}
          </p>
        </div>
      </div>
    </div>
  );
}
