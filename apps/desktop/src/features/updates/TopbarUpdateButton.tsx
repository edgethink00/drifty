import type { CSSProperties } from "react";

import { remainingLabelText } from "../loading/remainingEstimateCopy";
import { useRemainingEstimate } from "../loading/useRemainingEstimate";
import { useLocalization } from "../localization/LocalizationContext";
import "./TopbarUpdateButton.css";
import type { UpdateLifecycleStatus } from "./useUpdateController";

type TopbarUpdateButtonProps = {
  readonly onInstall: () => void;
  /** 0..1 of the update payload transferred, or null while the size is unknown. */
  readonly progress?: number | null;
  readonly status: UpdateLifecycleStatus;
  readonly version: string;
};

export function TopbarUpdateButton({ onInstall, progress = null, status, version }: TopbarUpdateButtonProps) {
  const { t } = useLocalization();
  const isPreparing = status === "downloading" || status === "installing";
  const measured = isPreparing && progress !== null && Number.isFinite(progress);
  const percent = measured ? Math.min(100, Math.max(0, Math.round((progress as number) * 100))) : null;
  const remaining = useRemainingEstimate({
    enabled: isPreparing,
    resetKey: version,
    value: measured ? progress : null,
  });
  // Two separate cases, deliberately. A measured transfer shows its percentage,
  // because that is the number people want while an app restarts itself. A
  // transfer with no reported size shows nothing new — it keeps the action word
  // rather than swapping in a "Preparing" that says less than the dimmed pill
  // already does.
  const remainingCopy = remainingLabelText(remaining, t);
  const label = [
    isPreparing ? t("updates.preparingAria", { version }) : t("updates.installAria", { version }),
    percent === null ? null : `${percent}%`,
    remainingCopy,
  ].filter(Boolean).join(" · ");
  const style = measured ? ({ "--topbar-update-progress": `${percent}%` } as CSSProperties) : undefined;
  const visibleText = percent === null ? t("updates.install") : `${percent}%`;
  // The action word is the longest thing this pill can ever say, so holding its
  // width behind every state keeps a window-chrome control from resizing as the
  // percentage counts up. "100%" is reserved too, in case a language ever makes
  // the action word the shorter one.
  const reservedLabels = [t("updates.install"), "100%"];

  return (
    <button
      type="button"
      className={measured ? "topbar-update-button topbar-update-button--progress" : "topbar-update-button"}
      aria-label={label}
      // `aria-disabled` rather than `disabled`: a disabled control stops
      // receiving pointer events, which would also swallow the tooltip carrying
      // the percentage and the time left.
      aria-disabled={isPreparing || undefined}
      onClick={() => { if (!isPreparing) onInstall(); }}
      style={style}
      title={label}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 2.5v6" />
        <path d="m5.5 6.4 2.5 2.5 2.5-2.5" />
        <path d="M3.5 10.8v1.4c0 .7.6 1.3 1.3 1.3h6.4c.7 0 1.3-.6 1.3-1.3v-1.4" />
      </svg>
      <span className="topbar-update-button__label">
        <span className="topbar-update-button__label-reserve" aria-hidden="true">
          {reservedLabels.map((reserved) => <span key={reserved}>{reserved}</span>)}
        </span>
        <span className="topbar-update-button__label-text">{visibleText}</span>
      </span>
    </button>
  );
}
