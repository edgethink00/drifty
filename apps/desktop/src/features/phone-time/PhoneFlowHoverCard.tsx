import type { CSSProperties, Ref } from "react";
import { HOVER_CARD_OFFSET } from "../../components/hoverCardPosition";
import { useLocalization } from "../localization/LocalizationContext";
import type { PhoneTimeBlock } from "./phoneFlowCells";
import { phoneTimeDurationLabel, phoneTimeRangeLabel } from "./phoneTimeFormat";

export type PhoneFlowHoverState = {
  readonly block: PhoneTimeBlock;
  readonly x: number;
  readonly y: number;
};

/** Says what a hatched iPhone cell is: approximate, and outside the Mac's totals. */
export function PhoneFlowHoverCard({ hover, cardRef }: { readonly hover: PhoneFlowHoverState; readonly cardRef?: Ref<HTMLDivElement> }) {
  const { effectiveLanguage, t } = useLocalization();
  const position: CSSProperties = { left: hover.x + HOVER_CARD_OFFSET, top: hover.y + HOVER_CARD_OFFSET };
  const groupLabel = hover.block.label.trim() || t("dashboard.today.phoneTimeDefaultGroup");
  return (
    <div ref={cardRef} className="flow-hover-card phone-flow-hover-card" style={position} role="tooltip">
      <div className="phone-flow-hover-card__head">
        <span className="phone-flow-hover-card__swatch" aria-hidden="true" />
        <strong>{t("dashboard.today.phoneTime")}</strong>
        <span>{phoneTimeRangeLabel(hover.block, effectiveLanguage)}</span>
      </div>
      <div className="phone-flow-hover-card__metric">
        <span>{groupLabel}</span>
        <strong>{t("dashboard.today.phoneTimeAbout", { duration: phoneTimeDurationLabel(hover.block, effectiveLanguage) })}</strong>
      </div>
      <p>{t("dashboard.today.phoneTimeNote")}</p>
    </div>
  );
}
