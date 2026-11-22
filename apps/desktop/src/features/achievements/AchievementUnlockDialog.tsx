import { useId } from "react";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import { achievementCondition, achievementDay, achievementName, formatAchievementDay } from "./AchievementsPanel";
import { AchievementMedal } from "./AchievementMedal";
import type { AchievementItem } from "./useAchievements";
import { formatRarityPercent } from "./achievementRarity";
import "./achievements.css";

export type AchievementUnlockDialogProps = {
  /** Achievements not shown before, most notable first. */
  readonly items: readonly AchievementItem[];
  /** The first look-back found these together. */
  readonly firstLook: boolean;
  readonly onClose: () => void;
  readonly onView: () => void;
};

/** Order newly earned achievements so the most notable leads the card. */
export function orderNewAchievements(items: readonly AchievementItem[]): AchievementItem[] {
  return [...items].sort((left, right) => right.definition.weight - left.definition.weight
    || (right.earned?.lastDay ?? "").localeCompare(left.earned?.lastDay ?? ""));
}

const FIRST_LOOK_MEDALS = 6;

/** Opens with the app when achievements arrived since it was last shown, as Whoop's card does on Home. */
export function AchievementUnlockDialog({ items, firstLook, onClose, onView }: AchievementUnlockDialogProps) {
  const { effectiveLanguage, t } = useLocalization();
  const titleId = useId();
  useModalDismiss(onClose);
  const overlayDismiss = useOverlayDismiss(onClose);
  const ordered = orderNewAchievements(items);
  const lead = ordered[0];
  if (!lead) return null;
  const showFirstLook = firstLook && ordered.length > 1;
  const others = ordered.slice(1);

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        className="auth-modal modal-shell achievement-unlock"
        data-modal-variant="compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("achievements.dialog.close")} onClick={onClose} />
        {showFirstLook ? (
          <div className="achievement-unlock__body">
            <div className="achievement-unlock__medals">
              {ordered.slice(0, FIRST_LOOK_MEDALS).map((item) => <AchievementMedal key={item.definition.id} item={item} size="md" />)}
            </div>
            <h2 id={titleId} className="achievement-unlock__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
            <p className="achievement-unlock__condition">{t("achievements.dialog.firstLookBody")}</p>
          </div>
        ) : (
          <div className="achievement-unlock__body">
            <AchievementMedal item={lead} size="xl" />
            <p className="achievement-unlock__eyebrow">{t("achievements.dialog.eyebrow")}</p>
            <h2 id={titleId} className="achievement-unlock__title">{achievementName(lead, t)}</h2>
            <p className="achievement-unlock__condition">{achievementCondition(lead, t)}</p>
            {lead.rarity ? (
              <p className="achievement-unlock__rarity">{t("achievements.rarity.card", { percent: formatRarityPercent(lead.rarity.percent, effectiveLanguage) })}</p>
            ) : null}
            {lead.earned ? <p className="achievement-unlock__date">{formatAchievementDay(achievementDay(lead) ?? lead.earned.firstDay, effectiveLanguage)}</p> : null}
            {others.length > 0 ? (
              <div className="achievement-unlock__more">
                <span className="achievement-unlock__more-medals" aria-hidden="true">
                  {others.slice(0, 3).map((item) => <AchievementMedal key={item.definition.id} item={item} size="sm" />)}
                </span>
                <span>{t("achievements.dialog.more", { count: others.length })}</span>
              </div>
            ) : null}
          </div>
        )}
        <div className="achievement-unlock__actions">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
          <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
        </div>
      </section>
    </div>
  );
}

