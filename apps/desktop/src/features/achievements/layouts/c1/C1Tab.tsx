import { useMemo } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_GROUPS } from "../../achievementCatalog";
import { achievementName } from "../../achievementCopy";
import { closestAchievements, progressShare, remainingText } from "../../achievementProgress";
import type { AchievementLayoutTabProps } from "../types";
import { C1Detail } from "./C1Detail";
import { C1Medal } from "./C1Medal";
import { tileStatus } from "./c1Copy";
import "./c1-tab.css";

function C1Loading({ label }: { readonly label: string }) {
  return (
    <div className="c1 c1--loading">
      <div className="c1-summary">
        <p className="c1-summary__count" role="status">{label}</p>
      </div>
      <div className="c1-body" aria-hidden="true">
        <div className="editorial-panel c1-board">
          {ACHIEVEMENT_GROUPS.map((group) => (
            <div key={group} className="c1-row">
              <span className="c1-row__head"><span className="c1-skeleton c1-skeleton--label" /></span>
              {[0, 1, 2, 3].map((slot) => (
                <span key={slot} className="c1-tile c1-tile--skeleton"><span className="c1-medal c1-skeleton c1-skeleton--medal" /></span>
              ))}
            </div>
          ))}
        </div>
        <div className="editorial-panel c1-detail">
          <div className="c1-detail__inner">
            <span className="c1-medal c1-detail__medal c1-skeleton c1-skeleton--medal" />
            <span className="c1-skeleton c1-skeleton--title" />
            <span className="c1-skeleton c1-skeleton--line" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Insights › Achievements: a one-line summary, the four groups as rows, and the chosen one beside them. */
export function C1Tab({ model }: AchievementLayoutTabProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { status, items, byGroup, earnedCount, failedEmpty, selected, choose, isNew, onOpenDay, onRetry } = model;
  const closest = useMemo(() => closestAchievements(items), [items]);
  const selectedId = selected?.definition.id;
  const siblings = selected
    ? (byGroup.find(({ group }) => group === selected.definition.group)?.items ?? []).filter((item) => item.definition.id !== selectedId)
    : [];

  if (model.loading) return <C1Loading label={t("achievements.loading")} />;

  return (
    <div className="c1">
      <div className="c1-summary">
        <p className="c1-summary__count">
          <span>{t("achievements.summary", { earned: earnedCount, total: items.length })}</span>
          <span className="c1-bar c1-summary__bar" aria-hidden="true"><span style={{ width: Math.round((earnedCount / Math.max(1, items.length)) * 100) + "%" }} /></span>
        </p>
        {status === "error" && !failedEmpty ? (
          <p className="c1-summary__notice" role="alert">
            <span>{t("achievements.error")}</span>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </p>
        ) : closest.length > 0 ? (
          <p className="c1-near">
            <span className="c1-near__title">{t("achievements.near.title")}</span>
            {closest.map((item) => (
              <button key={item.definition.id} type="button" className="c1-link c1-near__item" onClick={() => choose(item.definition.id)}>
                <span className="c1-near__name">{achievementName(item, t)}</span>
                <span className="c1-near__left">{remainingText(item, t, effectiveLanguage)}</span>
              </button>
            ))}
          </p>
        ) : null}
      </div>

      <div className="c1-body">
        <div className="editorial-panel c1-board">
          {byGroup.map(({ group, items: groupItems }) => {
            const earnedInGroup = groupItems.filter((item) => item.earned).length;
            return (
            <section key={group} className="c1-row" aria-labelledby={"c1-group-" + group}>
              <div className="c1-row__head">
                <h2 id={"c1-group-" + group} className="c1-row__title">{t(("achievements.group." + group) as TranslationKey)}</h2>
                <span className="c1-row__meta">
                  <span className="c1-row__count">{earnedInGroup}/{groupItems.length}</span>
                  <span className="c1-pips" aria-hidden="true">
                    {groupItems.map((item) => <span key={item.definition.id} className="c1-pip" data-on={item.earned ? "true" : undefined} />)}
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
                    className="c1-tile"
                    data-state={item.earned ? "earned" : "locked"}
                    aria-pressed={item.definition.id === selectedId}
                    aria-label={t(item.earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
                    onClick={() => choose(item.definition.id)}
                  >
                    <C1Medal item={item} className="c1-medal c1-tile__medal" />
                    <span className="c1-tile__name">{name}</span>
                    <span className="c1-tile__status" data-kind={line.kind} data-times={line.kind === "earned" && line.times ? "true" : undefined}>
                      {isNew(item) ? <span className="c1-dot" aria-hidden="true" /> : null}
                      {line.kind === "earned" ? (
                        <>
                          <span className="c1-tile__day">{line.day}</span>
                          {line.times ? <><span className="c1-tile__sep"> · </span><span>{line.times}</span></> : null}
                        </>
                      ) : line.text}
                    </span>
                    {line.kind === "progress" ? (
                      <span className="c1-bar c1-tile__bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
                    ) : null}
                  </button>
                );
              })}
            </section>
            );
          })}
        </div>

        {failedEmpty ? (
          <div className="editorial-panel c1-detail c1-detail--error" role="alert">
            <p>{t("achievements.error")}</p>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </div>
        ) : selected ? (
          <C1Detail item={selected} isNew={isNew(selected)} onOpenDay={onOpenDay} siblings={siblings} onChoose={choose} />
        ) : null}
      </div>

      <p className="c1-footnote" role={status === "loading" ? "status" : undefined}>
        {status === "loading" ? t("achievements.loading") : t("achievements.note")}
      </p>
    </div>
  );
}
