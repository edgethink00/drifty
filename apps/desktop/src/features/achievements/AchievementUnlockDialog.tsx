import { useId } from "react";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import type { Translate } from "../localization/translate";
import type { DisplayLanguage } from "../localization/languagePreference";
import {
  achievementCondition,
  achievementDay,
  achievementName,
  formatAchievementDay,
  medalName,
  rarityIsNotable,
  raritySentence,
  rarityTierName,
  shownRarity,
  timesLabel,
} from "./achievementCopy";
import { AchievementMedal } from "./AchievementMedal";
import { nextMedal } from "./AchievementsPanel";
import { AchievementShowcase } from "./AchievementShowcase";
import type { AchievementItem } from "./useAchievements";
import "./achievement-medal.css";
import "./achievement-unlock.css";

export type AchievementUnlockDialogProps = {
  /** Achievements not shown before, most notable first. */
  readonly items: readonly AchievementItem[];
  /** The first look-back found these together. */
  readonly firstLook: boolean;
  readonly onClose: () => void;
  readonly onView: () => void;
};

/** Gives a two-line-clamped name its full text as a tooltip, only when the clamp hides some of it. */
function titleWhenClipped(node: HTMLElement | null) {
  if (!node) return;
  if (node.scrollHeight > node.clientHeight + 1) node.title = node.textContent ?? "";
  else node.removeAttribute("title");
}

/** Order newly earned achievements so the most notable leads the card. */
export function orderNewAchievements(items: readonly AchievementItem[]): AchievementItem[] {
  return [...items].sort((left, right) => right.definition.weight - left.definition.weight
    || (right.earned?.lastDay ?? "").localeCompare(left.earned?.lastDay ?? ""));
}

/** Achievements listed under the lead one before the rest are counted. */
const COMPANIONS_SHOWN = 4;

function earnedDay(item: AchievementItem, language: DisplayLanguage): string {
  return item.earned ? formatAchievementDay(achievementDay(item) ?? item.earned.firstDay, language) : "";
}

function companionLine(item: AchievementItem, t: Translate, language: DisplayLanguage): string {
  const parts = [earnedDay(item, language), medalName(item, t)];
  if (item.definition.repeatable && item.earned && item.earned.count > 1) parts.push(t("achievements.dialog.timesNth", { count: item.earned.count }));
  return parts.filter(Boolean).join(" · ");
}

function foundLine(item: AchievementItem, t: Translate, language: DisplayLanguage): string {
  return item.definition.repeatable && item.earned && item.earned.count > 1 ? timesLabel(item.earned.count, t) : earnedDay(item, language);
}

/** Opens with the app when achievements arrived since it was last shown. */
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
  const leadRarity = shownRarity(lead);
  const leadNext = nextMedal(lead);
  const rarest = ordered
    .filter((item) => shownRarity(item) !== null)
    .sort((left, right) => (left.rarity?.percent ?? 100) - (right.rarity?.percent ?? 100) || right.definition.weight - left.definition.weight)[0];
  const rarestRarity = rarest ? shownRarity(rarest) : null;

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        className="auth-modal modal-shell achievement-unlock"
        data-modal-variant="compact"
        data-kind={showFirstLook ? "first-look" : others.length > 0 ? "several" : "single"}
        lang={effectiveLanguage}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("achievements.dialog.close")} onClick={onClose} />
        {showFirstLook ? (
          <>
            <div className="achievement-unlock__text">
              <p className="achievement-unlock__context">{t("achievements.dialog.firstLookEyebrow")}</p>
              <h2 id={titleId} className="achievement-unlock__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
              <p className="achievement-unlock__condition">{t("achievements.dialog.firstLookBody")}</p>
            </div>
            <ul className="achievement-found">
              {ordered.map((item, index) => (
                <li key={item.definition.id} className="achievement-found__item" style={{ animationDelay: 120 + index * 40 + "ms" }}>
                  <AchievementMedal item={item} />
                  <span className="achievement-found__name" ref={titleWhenClipped}>{achievementName(item, t)}</span>
                  <span className="achievement-found__meta">{foundLine(item, t, effectiveLanguage)}</span>
                </li>
              ))}
            </ul>
            {rarest && rarestRarity ? (
              <p className="achievement-unlock__rarest">
                <span className="achievement-unlock__rarest-lead">
                  {t("achievements.dialog.rarest", { name: achievementName(rarest, t) })}
                </span>
                <span className="achievement-unlock__rarest-detail"> · {raritySentence(rarestRarity, t, effectiveLanguage, "tab")}</span>
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="achievement-unlock__stage">
              <AchievementShowcase item={lead} size="hero" entrance />
            </div>
            <div className="achievement-unlock__text">
              <p className="achievement-unlock__context">
                {others.length > 0 ? t("achievements.dialog.eyebrowMany", { count: ordered.length }) : t("achievements.dialog.eyebrow")}
              </p>
              <h2 id={titleId} className="achievement-unlock__title">{achievementName(lead, t)}</h2>
              <p className="achievement-unlock__condition">{achievementCondition(lead, t)}</p>
              <div className="achievement-unlock__facts">
                {leadRarity ? (
                  <p className="achievement-unlock__rarity">
                    <strong className="achievement-unlock__tier" data-notable={rarityIsNotable(lead, leadRarity) ? "true" : undefined}>{rarityTierName(lead, leadRarity, t)}</strong>
                    <span>{raritySentence(leadRarity, t, effectiveLanguage, "card")}</span>
                  </p>
                ) : null}
                {lead.earned ? (
                  <p className="achievement-unlock__date">
                    {[t("achievements.dialog.earnedOn", { date: earnedDay(lead, effectiveLanguage) }), medalName(lead, t)].filter(Boolean).join(" · ")}
                    {leadNext ? <span className="achievement-unlock__next">{t(leadNext.key === "achievements.medal.toGold" ? "achievements.dialog.toGold" : "achievements.dialog.toRing", { remaining: leadNext.remaining })}</span> : null}
                  </p>
                ) : null}
              </div>
            </div>
            {others.length > 0 ? (
              <div className="achievement-unlock__also">
                <p className="achievement-unlock__also-title">{t("achievements.dialog.alsoEarned")}</p>
                <ul className="achievement-unlock__companions">
                  {others.slice(0, COMPANIONS_SHOWN).map((item, index) => (
                    <li key={item.definition.id} className="achievement-companion" style={{ animationDelay: 260 + index * 40 + "ms" }}>
                      <AchievementMedal item={item} />
                      <span className="achievement-companion__text">
                        <span className="achievement-companion__name">{achievementName(item, t)}</span>
                        <span className="achievement-companion__meta">{companionLine(item, t, effectiveLanguage)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {others.length > COMPANIONS_SHOWN ? (
                  <p className="achievement-unlock__more">{t("achievements.dialog.more", { count: others.length - COMPANIONS_SHOWN })}</p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
        <div className="achievement-unlock__actions">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
          <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
        </div>
      </section>
    </div>
  );
}
