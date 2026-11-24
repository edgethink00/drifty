import { useId, useMemo, useState } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { AchievementId } from "../../achievementCatalog";
import { achievementCondition, achievementName, rarityIsNotable, rarityTierName, shownRarity } from "../../achievementCopy";
import { progressShare, progressText, remainingText } from "../../achievementProgress";
import { achievementRowParts } from "../../achievementRows";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutTabProps } from "../types";
import { C12Holdings } from "./C12Holdings";
import { C12Medal } from "./C12Medal";
import { C12Opened } from "./C12Opened";
import { groupLabel, rowDay, timesMark } from "./c12Copy";

const SKELETON_ROWS = 8;

function Chevron() {
  return (
    <svg className="c12-row__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

type RowProps = {
  readonly item: AchievementItem;
  readonly almost?: boolean;
  readonly open: boolean;
  readonly isNew: boolean;
  readonly panelId: string;
  readonly onToggle: () => void;
  readonly onOpenDay: (day: string) => void;
};

/** One ledger line: medal, name with its condition, group, rarity, times, day; opens in place below itself. */
function Row({ item, almost = false, open, isNew, panelId, onToggle, onOpenDay }: RowProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const name = achievementName(item, t);
  const rarity = shownRarity(item);
  const progress = almost ? progressText(item, t, effectiveLanguage) : null;
  const underWay = !earned && !definition.hidden && progressShare(item) < 1 && progressText(item, t, effectiveLanguage) !== null;
  const right = earned ? rowDay(item, effectiveLanguage) : underWay ? remainingText(item, t, effectiveLanguage) : null;

  return (
    <li className="c12-item" data-open={open ? "true" : undefined} data-almost-there-id={almost ? definition.id : undefined}>
      <button
        type="button"
        className="c12-row"
        data-state={earned ? "earned" : "locked"}
        data-almost={almost ? "true" : undefined}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t(earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
        onClick={onToggle}
      >
        <C12Medal item={item} className="c12-medal c12-row__medal" />
        <span className="c12-row__main">
          <span className="c12-row__name">
            {isNew ? <span className="c12-dot" aria-hidden="true" /> : null}
            {name}
          </span>
          {almost && progress ? (
            <span className="c12-row__progress">
              <span className="c12-bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
              <span className="c12-row__progress-text">{progress}</span>
            </span>
          ) : (
            <span className="c12-row__cond">{achievementCondition(item, t)}</span>
          )}
        </span>
        <span className="c12-row__group">{groupLabel(definition.group, t)}</span>
        <span className="c12-row__rarity" data-notable={rarity && earned && rarityIsNotable(item, rarity) ? "true" : undefined}>
          {rarity ? rarityTierName(item, rarity, t) : null}
        </span>
        <span className="c12-row__times">{timesMark(item)}</span>
        <span className="c12-row__date" data-kind={earned ? "day" : "left"}>{right}</span>
        <Chevron />
      </button>
      {open ? <C12Opened id={panelId} item={item} isNew={isNew} onOpenDay={onOpenDay} /> : null}
    </li>
  );
}

function C12Loading({ label }: { readonly label: string }) {
  return (
    <div className="c12 c12--loading">
      <div className="c12-head">
        <p className="c12-head__count" role="status">{label}</p>
      </div>
      <ul className="c12-list editorial-panel" aria-hidden="true">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <li key={index} className="c12-item">
            <span className="c12-row c12-row--skeleton">
              <span className="c12-medal c12-row__medal c12-skeleton c12-skeleton--medal" />
              <span className="c12-row__main"><span className="c12-skeleton c12-skeleton--line" style={{ width: 9 + (index % 3) * 3 + "rem" }} /></span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Insights › Achievements as a ledger: one aligned line per achievement, almost there first, then earned, then not yet. */
export function C12Tab({ model }: AchievementLayoutTabProps) {
  const { t } = useLocalization();
  const { status, items, earnedCount, failedEmpty, isNew, onOpenDay, onRetry } = model;
  const baseId = useId();
  const parts = useMemo(() => achievementRowParts(items, { almost: 3, earned: "recent" }), [items]);
  // Until someone opens or closes a row, the one just earned opens on arrival.
  const [chosen, setChosen] = useState<AchievementId | null | undefined>(undefined);
  const openId = chosen === undefined ? (items.find((item) => isNew(item))?.definition.id ?? null) : chosen;
  const anyRarity = items.some((item) => shownRarity(item) !== null);

  if (model.loading) return <C12Loading label={t("achievements.loading")} />;

  const row = (item: AchievementItem, almost = false) => {
    const id = item.definition.id;
    const panelId = baseId + "-" + id;
    return (
      <Row
        key={id}
        item={item}
        almost={almost}
        open={openId === id}
        isNew={isNew(item)}
        panelId={panelId}
        onToggle={() => setChosen(openId === id ? null : id)}
        onOpenDay={onOpenDay}
      />
    );
  };
  const notYet = [...parts.notYet, ...parts.hidden];

  return (
    <div className="c12" data-rarity={anyRarity ? undefined : "none"}>
      <div className="c12-head">
        <p className="c12-head__count">{t("achievements.c12.held", { earned: earnedCount, total: items.length })}</p>
        <C12Holdings items={items} className="c12-head__tiers" />
        {status === "error" && !failedEmpty ? (
          <p className="c12-head__notice" role="alert">
            <span>{t("achievements.error")}</span>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </p>
        ) : null}
      </div>

      {failedEmpty ? (
        <div className="c12-failed editorial-panel" role="alert">
          <p>{t("achievements.error")}</p>
          <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
        </div>
      ) : (
        <div className="c12-list editorial-panel">
          {parts.almost.length > 0 ? (
            <section className="c12-part c12-part--almost" data-almost-there="" aria-labelledby={baseId + "-almost"}>
              <h2 id={baseId + "-almost"} className="c12-part__title">{t("achievements.near.title")}</h2>
              <ul className="c12-rows">{parts.almost.map((entry) => row(entry.item, true))}</ul>
            </section>
          ) : null}
          {parts.earned.length > 0 ? (
            <section className="c12-part" aria-labelledby={baseId + "-earned"}>
              <h2 id={baseId + "-earned"} className="c12-part__title">{t("achievements.c12.earnedTitle")}</h2>
              <ul className="c12-rows">{parts.earned.map((item) => row(item))}</ul>
            </section>
          ) : null}
          {notYet.length > 0 ? (
            <section className="c12-part" aria-labelledby={baseId + "-notyet"}>
              <h2 id={baseId + "-notyet"} className="c12-part__title">{t("achievements.c12.notYetTitle")}</h2>
              <ul className="c12-rows">{notYet.map((item) => row(item))}</ul>
            </section>
          ) : null}
        </div>
      )}

      <p className="c12-footnote" role={status === "loading" ? "status" : undefined}>
        {status === "loading" ? t("achievements.loading") : t("achievements.note")}
      </p>
    </div>
  );
}
