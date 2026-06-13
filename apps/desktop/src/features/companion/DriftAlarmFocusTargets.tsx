import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { ArrowRightIcon } from "./DriftAlarmIcons";
import type { DriftAlarmFocusTarget } from "./driftAlarmEvent";

type DriftAlarmFocusTargetListProps = {
  readonly backToDashboardLabel: string;
  readonly focusTargets: readonly DriftAlarmFocusTarget[];
  readonly noFocusTargetLabel: string;
  readonly selectedTargetId: string | null;
  readonly onSelectTarget: (targetId: string) => void;
};

export function DriftAlarmFocusTargetList({
  backToDashboardLabel,
  focusTargets,
  noFocusTargetLabel,
  selectedTargetId,
  onSelectTarget,
}: DriftAlarmFocusTargetListProps) {
  if (focusTargets.length === 0) {
    return (
      <div className="da__target-empty">
        <span>{noFocusTargetLabel}</span>
        <button
          className={`da__target da__target--primary${selectedTargetId === "dashboard" ? " is-selected" : ""}`}
          type="button"
          onClick={() => onSelectTarget("dashboard")}
          data-drift-alarm-initial-focus="true"
        >
          <span className="da__target-icon" aria-hidden="true"><span className="da__target-glyph">Dr</span></span>
          <span className="da__target-copy"><strong>{backToDashboardLabel}</strong><small aria-hidden="true">Choose a focus destination</small></span>
          <span className="da__target-go" aria-hidden="true"><ArrowRightIcon /></span>
        </button>
      </div>
    );
  }

  return (
    <>
      {focusTargets.map((target, index) => (
        <button
          className={`da__target${index === 0 ? " da__target--primary" : ""}${selectedTargetId === target.targetId ? " is-selected" : ""}`}
          key={target.targetId}
          type="button"
          onClick={() => onSelectTarget(target.targetId)}
          data-drift-alarm-initial-focus={index === 0 ? "true" : undefined}
        >
          <DriftAlarmFocusTargetIcon target={target} />
          <span className="da__target-copy">
            <strong>{target.label}</strong>
            <small>{target.detail}</small>
          </span>
          <span className="da__target-go" aria-hidden="true">
            <ArrowRightIcon />
          </span>
        </button>
      ))}
    </>
  );
}

function DriftAlarmFocusTargetIcon({ target }: { readonly target: DriftAlarmFocusTarget }) {
  if (target.siteDomain) {
    return (
      <span className="da__target-icon">
        <SiteFavicon domain={target.siteDomain} size={22} fallbackIconSrc={target.iconSrc} />
      </span>
    );
  }

  return (
    <span className="da__target-icon">
      <AppGlyph appName={target.appName || target.label} iconSrc={target.iconSrc} size="sm" />
    </span>
  );
}
