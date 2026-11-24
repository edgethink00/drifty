import { useId, useMemo, useState } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { AchievementId } from "../../achievementCatalog";
import { achievementRowParts } from "../../achievementRows";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutTabProps } from "../types";
import { C14Holdings } from "./C14Holdings";
import { C14Row } from "./C14Row";

const SKELETON_ROWS = 7;

function C14Loading({ label }: { readonly label: string }) {
  return (
    <div className="c14 c14--loading">
      <div className="c14-summary">
        <p className="c14-summary__count" role="status">{label}</p>
      </div>
      <div className="editorial-panel c14-list" aria-hidden="true">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} className="c14-row c14-row--skeleton">
            <span className="c14-medal c14-skeleton c14-skeleton--medal" />
            <span className="c14-row__text">
              <span className="c14-skeleton c14-skeleton--name" />
              <span className="c14-skeleton c14-skeleton--line" />
            </span>
            <span className="c14-skeleton c14-skeleton--rail" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Insights › Achievements: one list of rows, each carrying its own record on its right half. */
export function C14Tab({ model }: AchievementLayoutTabProps) {
  const { t } = useLocalization();
  const { status, items, earnedCount, failedEmpty, selected, choose, isNew, onOpenDay, onRetry } = model;
  const idBase = useId();
  const parts = useMemo(() => achievementRowParts(items, { almost: 3, earned: "recent" }), [items]);
  const [openId, setOpenId] = useState<AchievementId | null>(() => (selected && isNew(selected) ? selected.definition.id : null));

  if (model.loading) return <C14Loading label={t("achievements.loading")} />;

  const toggle = (id: AchievementId) => {
    setOpenId((current) => (current === id ? null : id));
    choose(id);
  };
  const row = (item: AchievementItem, almostThere = false) => {
    const id = item.definition.id;
    return (
      <C14Row
        item={item}
        idBase={idBase + id}
        open={openId === id}
        isNew={isNew(item)}
        almostThere={almostThere}
        onToggle={() => toggle(id)}
        onOpenDay={onOpenDay}
      />
    );
  };
  const later = [...parts.notYet, ...parts.hidden];

  return (
    <div className="c14">
      <div className="c14-summary">
        <p className="c14-summary__count">{t("achievements.c14.held", { earned: earnedCount, total: items.length })}</p>
        <C14Holdings items={items} className="c14-summary__tiers" />
        {status === "error" && !failedEmpty ? (
          <p className="c14-summary__notice" role="alert">
            <span>{t("achievements.error")}</span>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </p>
        ) : null}
      </div>

      {failedEmpty ? (
        <div className="editorial-panel c14-failed" role="alert">
          <p>{t("achievements.error")}</p>
          <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
        </div>
      ) : null}

      <div className="editorial-panel c14-list">
        {parts.almost.length > 0 ? (
          <div className="c14-part" data-almost-there="" role="group" aria-labelledby={idBase + "-almost"}>
            <h2 id={idBase + "-almost"} className="c14-part__title">{t("achievements.near.title")}</h2>
            <ul className="c14-rows">
              {parts.almost.map((entry) => (
                <li key={entry.item.definition.id} data-almost-there-id={entry.item.definition.id}>{row(entry.item, true)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {parts.earned.length > 0 ? (
          <div className="c14-part" role="group" aria-labelledby={idBase + "-earned"}>
            <h2 id={idBase + "-earned"} className="c14-part__title">
              {t("achievements.c14.earnedPart")}
              <span className="c14-part__count">{parts.earned.length}</span>
            </h2>
            <ul className="c14-rows">
              {parts.earned.map((item) => <li key={item.definition.id}>{row(item)}</li>)}
            </ul>
          </div>
        ) : null}
        {later.length > 0 ? (
          <div className="c14-part" role="group" aria-labelledby={idBase + "-later"}>
            <h2 id={idBase + "-later"} className="c14-part__title">
              {t("achievements.c14.notYetPart")}
              <span className="c14-part__count">{later.length}</span>
            </h2>
            <ul className="c14-rows">
              {later.map((item) => <li key={item.definition.id}>{row(item)}</li>)}
            </ul>
          </div>
        ) : null}
      </div>

      <p className="c14-footnote" role={status === "loading" ? "status" : undefined}>
        {status === "loading" ? t("achievements.loading") : t("achievements.note")}
      </p>
    </div>
  );
}
