import { useId } from "react";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import { useActiveAchievementLayout, type AchievementLayoutId } from "./achievementDesignReview";
import { ACHIEVEMENT_LAYOUT_REGISTRY } from "./layouts/registry";
import type { AchievementItem } from "./useAchievements";

export type AchievementUnlockDialogProps = {
  /** Achievements not shown before, most notable first. */
  readonly items: readonly AchievementItem[];
  /** The first look-back found these together. */
  readonly firstLook: boolean;
  readonly onClose: () => void;
  readonly onView: () => void;
  /** Draw this composition's card instead of the active one's. */
  readonly layout?: AchievementLayoutId;
};

/** Order newly earned achievements so the most notable leads the card. */
export function orderNewAchievements(items: readonly AchievementItem[]): AchievementItem[] {
  return [...items].sort((left, right) => right.definition.weight - left.definition.weight
    || (right.earned?.lastDay ?? "").localeCompare(left.earned?.lastDay ?? ""));
}

/** Opens with the app when achievements arrived since it was last shown. */
export function AchievementUnlockDialog({ items, firstLook, onClose, onView, layout }: AchievementUnlockDialogProps) {
  const { effectiveLanguage, t } = useLocalization();
  const titleId = useId();
  useModalDismiss(onClose);
  const overlayDismiss = useOverlayDismiss(onClose);
  const active = useActiveAchievementLayout();
  const { Card, cardLayout } = ACHIEVEMENT_LAYOUT_REGISTRY[layout ?? active];
  const cardOwner = cardLayout ?? layout ?? active;
  const ordered = orderNewAchievements(items);
  const lead = ordered[0];
  if (!lead) return null;
  const showFirstLook = firstLook && ordered.length > 1;
  const others = ordered.slice(1);

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        className="auth-modal modal-shell achievement-unlock"
        data-modal-variant={ACHIEVEMENT_LAYOUT_REGISTRY[cardOwner].dialogVariant ?? "compact"}
        data-layout={cardOwner}
        data-kind={showFirstLook ? "first-look" : others.length > 0 ? "several" : "single"}
        lang={effectiveLanguage}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("achievements.dialog.close")} onClick={onClose} />
        <Card ordered={ordered} lead={lead} others={others} showFirstLook={showFirstLook} titleId={titleId} onClose={onClose} onView={onView} />
      </section>
    </div>
  );
}
