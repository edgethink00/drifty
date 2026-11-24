import { useMemo, useState } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { AchievementId } from "../../achievementCatalog";
import { achievementRowParts } from "../../achievementRows";
import { achievementSummary } from "../../achievementSummary";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutTabProps } from "../types";
import { C13Row } from "./C13Row";
import { C13Summary } from "./C13Summary";

const SKELETON_ROWS = 6;

function C13Loading({ label }: { readonly label: string }) {
  return (
    <div className="c13 c13--loading">
      <p className="c13-summary" role="status"><span className="c13-summary__count">{label}</span></p>
      <ol className="c13-list" aria-hidden="true">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <li key={index} className="c13-item">
            <div className="c13-row c13-row--skeleton">
              <span className="c13-medal c13-row__medal c13-skeleton c13-skeleton--medal" />
              <span className="c13-row__main">
                <span className="c13-skeleton c13-skeleton--name" />
                <span className="c13-skeleton c13-skeleton--line" />
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Insights › Achievements: one list at a readable measure, two lines per achievement, a row grows to show its record. */
export function C13Tab({ model }: AchievementLayoutTabProps) {
  const { t } = useLocalization();
  const { status, items, failedEmpty, isNew, onOpenDay, onRetry } = model;
  const parts = useMemo(() => achievementRowParts(items, { almost: Infinity, earned: "rarest" }), [items]);
  const [openId, setOpenId] = useState<AchievementId | null>(null);

  if (model.loading) return <C13Loading label={t("achievements.loading")} />;

  const row = (item: AchievementItem, underWay = false) => {
    const id = item.definition.id;
    return (
      <li key={id} className="c13-item" data-almost-there-id={underWay ? id : undefined}>
        <C13Row
          item={item}
          open={openId === id}
          fresh={isNew(item)}
          underWay={underWay}
          onToggle={() => setOpenId((current) => (current === id ? null : id))}
          onOpenDay={onOpenDay}
        />
      </li>
    );
  };
  const later = [...parts.notYet, ...parts.hidden];

  return (
    <div className="c13">
      <C13Summary summary={achievementSummary(items, t)} />
      {status === "error" && !failedEmpty ? (
        <p className="c13-notice" role="alert">
          <span>{t("achievements.error")}</span>
          <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
        </p>
      ) : null}

      {failedEmpty ? (
        <div className="c13-failed" role="alert">
          <p>{t("achievements.error")}</p>
          <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
        </div>
      ) : (
        <div className="c13-parts">
          {parts.almost.length > 0 ? (
            <div className="c13-part" data-almost-there="">
              <p className="c13-part__label">{t("achievements.near.title")}</p>
              <ol className="c13-list">{parts.almost.map((entry) => row(entry.item, true))}</ol>
            </div>
          ) : null}
          {parts.earned.length > 0 ? (
            <div className="c13-part">
              <p className="c13-part__label">{t("achievements.c13.earned")}</p>
              <ol className="c13-list">{parts.earned.map((item) => row(item))}</ol>
            </div>
          ) : null}
          {later.length > 0 ? (
            <div className="c13-part">
              <p className="c13-part__label">{t("achievements.c13.notYet")}</p>
              <ol className="c13-list">{later.map((item) => row(item))}</ol>
            </div>
          ) : null}
        </div>
      )}

      <p className="c13-footnote" role={status === "loading" ? "status" : undefined}>
        {status === "loading" ? t("achievements.loading") : t("achievements.note")}
      </p>
    </div>
  );
}
