import { useCallback, useState, type MouseEvent } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_GROUPS, type AchievementId } from "../../achievementCatalog";
import { achievementName } from "../../achievementCopy";
import type { AchievementLayoutTabProps } from "../types";
import { tileStatus } from "./c6Copy";
import { C6Drawer } from "./C6Drawer";
import { C6Medal } from "./C6Medal";
import "./c6-tab.css";

const LOADING_TILES = [4, 3, 3, 3] as const;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function C6Loading({ label }: { readonly label: string }) {
  return (
    <div className="c6-loading">
      <p className="c6-loading__label" role="status">{label}</p>
      {ACHIEVEMENT_GROUPS.map((group, index) => (
        <div key={group} className="c6-loading__group" aria-hidden="true">
          <span className="c6-loading__title" />
          <span className="c6-loading__row">
            {Array.from({ length: LOADING_TILES[index] }, (_, tile) => <span key={tile} className="c6-loading__medal" />)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Insights › Achievements as a gallery: every medal large, by group; the chosen one in a drawer at the bottom. */
export function C6Tab({ model }: AchievementLayoutTabProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { status, items, byGroup, earnedCount, failedEmpty, selected, isNew, onOpenDay, onRetry } = model;
  const [open, setOpen] = useState(false);
  const { choose } = model;

  const pick = useCallback((id: AchievementId, event: MouseEvent<HTMLButtonElement>) => {
    const tile = event.currentTarget;
    choose(id);
    setOpen(true);
    window.requestAnimationFrame(() => tile.scrollIntoView?.({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" }));
  }, [choose]);

  if (model.loading) return <C6Loading label={t("achievements.loading")} />;

  return (
    <div className="c6-root" data-drawer={open && selected && !failedEmpty ? "open" : "closed"}>
      <div className="c6-head">
        <p className="c6-head__count">{t("achievements.summary", { earned: earnedCount, total: items.length })}</p>
        {status === "error" && !failedEmpty ? (
          <p className="c6-head__notice" role="alert">
            <span>{t("achievements.error")}</span>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </p>
        ) : (
          <p className="c6-head__note" role={status === "loading" ? "status" : undefined}>
            {status === "loading" ? t("achievements.loading") : t("achievements.note")}
          </p>
        )}
      </div>

      {failedEmpty ? (
        <div className="c6-error" role="alert">
          <p>{t("achievements.error")}</p>
          <button type="button" className="app-btn app-btn--secondary" onClick={onRetry}>{t("achievements.retry")}</button>
        </div>
      ) : null}

      <div className="c6-gallery">
        {byGroup.map(({ group, items: groupItems }) => (
          <section key={group} className="c6-group" aria-labelledby={"c6-group-" + group}>
            <div className="c6-group__head">
              <h2 id={"c6-group-" + group} className="c6-group__title">{t(("achievements.group." + group) as TranslationKey)}</h2>
              <span className="c6-group__count">{groupItems.filter((item) => item.earned).length}/{groupItems.length}</span>
            </div>
            <div className="c6-group__row">
              {groupItems.map((item) => {
                const name = achievementName(item, t);
                const line = tileStatus(item, t, effectiveLanguage);
                const fresh = isNew(item);
                return (
                  <button
                    key={item.definition.id}
                    type="button"
                    className="c6-tile"
                    data-state={item.earned ? "earned" : "locked"}
                    aria-pressed={item.definition.id === selected?.definition.id}
                    aria-label={t(item.earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
                    onClick={(event) => pick(item.definition.id, event)}
                  >
                    <C6Medal item={item} floor={item.earned !== null} className="c6-tile__medal" />
                    <span className="c6-tile__name">{name}</span>
                    <span className="c6-tile__status" data-kind={line.kind}>
                      {fresh ? <span className="c6-dot" aria-hidden="true" /> : null}
                      {line.text}
                    </span>
                    {line.kind === "progress" ? (
                      <span className="c6-progress__bar c6-progress__bar--tile" aria-hidden="true"><span style={{ transform: "scaleX(" + line.share + ")" }} /></span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {selected && !failedEmpty ? (
        <C6Drawer item={selected} isNew={isNew(selected)} open={open} onOpenChange={setOpen} onOpenDay={onOpenDay} />
      ) : null}
    </div>
  );
}
