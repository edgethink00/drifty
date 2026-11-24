import { useId, useMemo, useState } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { AchievementId } from "../../achievementCatalog";
import { achievementCondition, achievementName } from "../../achievementCopy";
import { achievementRowParts } from "../../achievementRows";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutTabProps } from "../types";
import { C16Medal } from "./C16Medal";
import { C16Open } from "./C16Open";
import { C16Summary } from "./C16Summary";
import { rowFact, type RowPart } from "./c16Copy";

const SKELETON_ROWS = 7;

function C16Loading({ label }: { readonly label: string }) {
  return (
    <div className="c16 c16--loading">
      <div className="c16-sheet">
        <p className="c16-summary" role="status">{label}</p>
        <ul className="c16-list" aria-hidden="true">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <li key={index} className="c16-skeleton">
              <span className="c16-skeleton__medal" />
              <span className="c16-skeleton__line" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type RowProps = {
  readonly item: AchievementItem;
  readonly part: RowPart;
  readonly share?: number;
  readonly open: boolean;
  readonly regionId: string;
  readonly isNew: boolean;
  readonly onToggle: () => void;
  readonly onOpenDay: (day: string) => void;
};

function C16Row({ item, part, share, open, regionId, isNew, onToggle, onOpenDay }: RowProps) {
  const { effectiveLanguage, t } = useLocalization();
  const name = achievementName(item, t);
  const fact = rowFact(item, part, t, effectiveLanguage);
  const goal = part === "almost" || part === "notYet" ? achievementCondition(item, t) : null;
  const nameLine = (
    <span className="c16-row__name">
      {isNew ? <span className="c16-dot" aria-hidden="true" /> : null}
      {name}
    </span>
  );
  return (
    <li
      className="c16-item"
      data-part={part}
      data-open={open ? "true" : undefined}
      data-almost-there-id={part === "almost" ? item.definition.id : undefined}
    >
      <button
        type="button"
        className="c16-row"
        data-state={item.earned ? "earned" : "locked"}
        aria-expanded={open}
        aria-controls={open ? regionId : undefined}
        aria-label={t(item.earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
        onClick={onToggle}
      >
        <C16Medal item={item} className="c16-medal c16-row__medal" />
        {goal ? (
          <span className="c16-row__text">
            {nameLine}
            <span className="c16-row__goal">{goal}</span>
          </span>
        ) : nameLine}
        {fact ? <span className="c16-row__fact" data-kind={fact.kind}>{fact.text}</span> : null}
        {share !== undefined ? (
          <span className="c16-bar" aria-hidden="true"><span style={{ width: Math.round(share * 100) + "%" }} /></span>
        ) : null}
      </button>
      {open ? <C16Open item={item} id={regionId} isNew={isNew} conditionShown={goal !== null} onOpenDay={onOpenDay} /> : null}
    </li>
  );
}

/** Insights › Achievements as a quiet checklist: one line per achievement, opened in place. */
export function C16Tab({ model }: AchievementLayoutTabProps) {
  const { t } = useLocalization();
  const { status, items, failedEmpty, isNew, onOpenDay, onRetry } = model;
  const parts = useMemo(() => achievementRowParts(items, { almost: 3, earned: "recent" }), [items]);
  const [openId, setOpenId] = useState<AchievementId | null>(null);
  const baseId = useId();

  if (model.loading) return <C16Loading label={t("achievements.loading")} />;

  const row = (item: AchievementItem, part: RowPart, share?: number) => {
    const id = item.definition.id;
    return (
      <C16Row
        key={id}
        item={item}
        part={part}
        share={share}
        open={openId === id}
        regionId={baseId + "-" + id}
        isNew={isNew(item)}
        onToggle={() => setOpenId((current) => (current === id ? null : id))}
        onOpenDay={onOpenDay}
      />
    );
  };
  const later = [...parts.notYet, ...parts.hidden];

  return (
    <div className="c16">
      <div className="c16-sheet">
        <C16Summary items={items} className="c16-summary" />
        {failedEmpty || status === "error" ? (
          <p className="c16-notice" role="alert">
            <span>{t("achievements.error")}</span>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </p>
        ) : null}

        {parts.almost.length > 0 ? (
          <section className="c16-part" data-almost-there="" aria-labelledby={baseId + "-almost"}>
            <h2 id={baseId + "-almost"} className="c16-part__label">{t("achievements.near.title")}</h2>
            <ul className="c16-list">{parts.almost.map((entry) => row(entry.item, "almost", entry.share))}</ul>
          </section>
        ) : null}

        {parts.earned.length > 0 ? (
          <section className="c16-part" aria-labelledby={baseId + "-earned"}>
            <h2 id={baseId + "-earned"} className="c16-part__label">{t("achievements.c16.earned")}</h2>
            <ul className="c16-list">{parts.earned.map((item) => row(item, "earned"))}</ul>
          </section>
        ) : null}

        {later.length > 0 ? (
          <section className="c16-part" aria-labelledby={baseId + "-later"}>
            <h2 id={baseId + "-later"} className="c16-part__label">{t("achievements.c16.notYet")}</h2>
            <ul className="c16-list">
              {parts.notYet.map((item) => row(item, "notYet"))}
              {parts.hidden.map((item) => row(item, "hidden"))}
            </ul>
          </section>
        ) : null}

        <p className="c16-footnote" role={status === "loading" ? "status" : undefined}>
          {status === "loading" ? t("achievements.loading") : t("achievements.note")}
        </p>
      </div>
    </div>
  );
}
