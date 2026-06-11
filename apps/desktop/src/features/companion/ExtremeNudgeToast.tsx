import { useEffect, useState } from "react";

export type ExtremeNudgeToastEvent = {
  kind: "extremeNudgeToast";
  placement: "top-right";
  id: string;
  generatedAt: string;
  title: string;
  closedLabel: string;
  focusLabel: string | null;
};

type ToastPhase = "visible" | "leaving";

const EXTREME_NUDGE_TOAST_VISIBLE_MS = 4_000;
const EXTREME_NUDGE_TOAST_EXIT_MS = 280;

export function ExtremeNudgeToast({
  event,
  onDismiss,
  isPreview = false,
}: {
  event: ExtremeNudgeToastEvent;
  onDismiss?: () => void;
  isPreview?: boolean;
}) {
  const [phase, setPhase] = useState<ToastPhase>("visible");

  useEffect(() => {
    setPhase("visible");
    if (isPreview) return undefined;
    const exitTimer = window.setTimeout(() => setPhase("leaving"), EXTREME_NUDGE_TOAST_VISIBLE_MS);
    const dismissTimer = window.setTimeout(() => onDismiss?.(), EXTREME_NUDGE_TOAST_VISIBLE_MS + EXTREME_NUDGE_TOAST_EXIT_MS);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(dismissTimer);
    };
  }, [event.id, isPreview, onDismiss]);

  return (
    <aside
      className="extreme-nudge-toast"
      data-phase={phase}
      role={isPreview ? "group" : "status"}
      aria-live={isPreview ? undefined : "polite"}
      aria-atomic={isPreview ? undefined : "true"}
    >
      <div className="extreme-nudge-toast__mark" aria-hidden="true">
        <ExtremeNudgeScissorsIcon />
      </div>
      <div className="extreme-nudge-toast__copy">
        <p className="extreme-nudge-toast__eyebrow">Extreme nudge</p>
        <h2>{event.title}</h2>
        <p>{event.focusLabel ? `Focus switched to ${event.focusLabel}` : "Focus target was not available"}</p>
      </div>
    </aside>
  );
}

function ExtremeNudgeScissorsIcon() {
  return (
    <svg className="extreme-nudge-toast__icon" viewBox="0 0 24 24" fill="none" focusable="false">
      <circle cx="6.4" cy="7.2" r="2.25" />
      <circle cx="6.4" cy="16.8" r="2.25" />
      <path d="M8.25 8.45 19 19.2" />
      <path d="M8.25 15.55 19 4.8" />
    </svg>
  );
}
