import { useMemo } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_GROUPS } from "../../achievementCatalog";
import { almostThere } from "../../achievementCollection";
import { achievementName } from "../../achievementCopy";
import { progressShare } from "../../achievementProgress";
import type { AchievementLayoutTabProps } from "../types";
import { C7Detail } from "./C7Detail";
import { C7Holdings } from "./C7Holdings";
import { C7Medal } from "./C7Medal";
import { entryLeft, tileStatus } from "./c7Copy";

const NEAR_LIMIT = 3;

function C7Loading({ label }: { readonly label: string }) {
  return (
    <div className="c7 c7--loading">
      <div className="c7-head">
        <p className="c7-head__count" role="status">{label}</p>
      </div>
      <div className="c7-body" aria-hidden="true">
        <div className="editorial-panel c7-board">
          {["near", ...ACHIEVEMENT_GROUPS].map((row) => (
            <div key={row} className="c7-row">
              <span className="c7-row__head"><span className="c7-skeleton c7-skeleton--label" /></span>
              {[0, 1, 2, 3].map((slot) => (
                <span key={slot} className="c7-tile c7-tile--skeleton"><span className="c7-medal c7-skeleton c7-skeleton--medal" /></span>
              ))}
            </div>
          ))}
        </div>
        <div className="editorial-panel c7-detail">
          <div className="c7-detail__inner">
            <div className="c7-detail__top">
              <span className="c7-medal c7-detail__medal c7-skeleton c7-skeleton--medal" />
              <span className="c7-skeleton c7-skeleton--title" />
              <span className="c7-skeleton c7-skeleton--line" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Insights › Achievements: the count with what is held by tier, the board led by the goals closest to done, the chosen one beside it. */
export function C7Tab({ model }: AchievementLayoutTabProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { status, items, byGroup, earnedCount, failedEmpty, selected, choose, isNew, onOpenDay, onRetry } = model;
  const near = useMemo(() => almostThere(items, { limit: NEAR_LIMIT }), [items]);
  const selectedId = selected?.definition.id;

  if (model.loading) return <C7Loading label={t("achievements.loading")} />;

  return (
    <div className="c7">
      <div className="c7-head">
        <p className="c7-head__count">{t("achievements.c7.held", { earned: earnedCount, total: items.length })}</p>
        <C7Holdings items={items} className="c7-head__tiers" />
        {status === "error" && !failedEmpty ? (
          <p className="c7-head__notice" role="alert">
            <span>{t("achievements.error")}</span>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </p>
        ) : null}
      </div>

      <div className="c7-body">
        <div className="editorial-panel c7-board">
          {near.length > 0 ? (
            <section className="c7-row c7-row--near" data-almost-there="" aria-labelledby="c7-near-title">
              <div className="c7-row__head">
                <h2 id="c7-near-title" className="c7-row__title">{t("achievements.near.title")}</h2>
              </div>
              {near.map((entry) => {
                const name = achievementName(entry.item, t);
                const left = entryLeft(entry, t, effectiveLanguage);
                return (
                  <button
                    key={entry.item.definition.id}
                    type="button"
                    className="c7-tile c7-near"
                    data-kind={entry.kind}
                    data-almost-there-id={entry.item.definition.id}
                    aria-label={t("achievements.c7.nearLabel", { name, left })}
                    onClick={() => choose(entry.item.definition.id)}
                  >
                    <C7Medal item={entry.item} className="c7-medal c7-tile__medal" />
                    <span className="c7-tile__name">{name}</span>
                    <span className="c7-tile__status">{left}</span>
                    <span className="c7-bar c7-near__bar" aria-hidden="true"><span style={{ width: Math.round(entry.share * 100) + "%" }} /></span>
                  </button>
                );
              })}
            </section>
          ) : null}

          {byGroup.map(({ group, items: groupItems }) => {
            const earnedInGroup = groupItems.filter((item) => item.earned).length;
            return (
              <section key={group} className="c7-row" aria-labelledby={"c7-group-" + group}>
                <div className="c7-row__head">
                  <h2 id={"c7-group-" + group} className="c7-row__title">{t(("achievements.group." + group) as TranslationKey)}</h2>
                  <span className="c7-row__meta">
                    <span className="c7-row__count">{earnedInGroup}/{groupItems.length}</span>
                    <span className="c7-pips" aria-hidden="true">
                      {groupItems.map((item) => <span key={item.definition.id} className="c7-pip" data-on={item.earned ? "true" : undefined} />)}
                    </span>
                  </span>
                </div>
                {groupItems.map((item) => {
                  const name = achievementName(item, t);
                  const line = tileStatus(item, t, effectiveLanguage);
                  return (
                    <button
                      key={item.definition.id}
                      type="button"
                      className="c7-tile"
                      data-state={item.earned ? "earned" : "locked"}
                      aria-pressed={item.definition.id === selectedId}
                      aria-label={t(item.earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
                      onClick={() => choose(item.definition.id)}
                    >
                      <C7Medal item={item} className="c7-medal c7-tile__medal" />
                      <span className="c7-tile__name">
                        {isNew(item) ? <span className="c7-dot" aria-hidden="true" /> : null}
                        {name}
                      </span>
                      <span className="c7-tile__status" data-kind={line.kind} data-times={line.kind === "earned" && line.times ? "true" : undefined}>
                        {line.kind === "earned" ? (
                          <>
                            <span className="c7-tile__day">{line.day}</span>
                            {line.times ? <><span className="c7-tile__sep"> · </span><span>{line.times}</span></> : null}
                          </>
                        ) : line.text}
                      </span>
                      {line.kind === "progress" ? (
                        <span className="c7-bar c7-tile__bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
                      ) : null}
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>

        {failedEmpty ? (
          <div className="editorial-panel c7-detail c7-detail--error" role="alert">
            <p>{t("achievements.error")}</p>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </div>
        ) : selected ? (
          <C7Detail item={selected} isNew={isNew(selected)} onOpenDay={onOpenDay} />
        ) : null}
      </div>

      <p className="c7-footnote" role={status === "loading" ? "status" : undefined}>
        {status === "loading" ? t("achievements.loading") : t("achievements.note")}
      </p>
    </div>
  );
}
