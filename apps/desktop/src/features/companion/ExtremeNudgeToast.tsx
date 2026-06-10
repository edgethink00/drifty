import { useEffect, useState } from "react";

export type ExtremeNudgeToastEvent = {
  kind: "extremeNudgeToast";
  placement: "top-right";
  id: string;
  generatedAt: string;
  closedLabel: string;
  focusLabel: string | null;
};

type ToastPhase = "visible" | "leaving";

const EXTREME_NUDGE_TOAST_VISIBLE_MS = 4_000;
const EXTREME_NUDGE_TOAST_EXIT_MS = 280;

export function ExtremeNudgeToast({
  event,
  onDismiss,
}: {
  event: ExtremeNudgeToastEvent;
  onDismiss?: () => void;
}) {
  const [phase, setPhase] = useState<ToastPhase>("visible");

  useEffect(() => {
    setPhase("visible");
    const exitTimer = window.setTimeout(() => setPhase("leaving"), EXTREME_NUDGE_TOAST_VISIBLE_MS);
    const dismissTimer = window.setTimeout(() => onDismiss?.(), EXTREME_NUDGE_TOAST_VISIBLE_MS + EXTREME_NUDGE_TOAST_EXIT_MS);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(dismissTimer);
    };
  }, [event.id, onDismiss]);

  return (
    <aside className="extreme-nudge-toast" data-phase={phase} role="status" aria-live="polite" aria-atomic="true">
      <div className="extreme-nudge-toast__mark" aria-hidden="true">
        <span />
      </div>
      <div className="extreme-nudge-toast__copy">
        <p className="extreme-nudge-toast__eyebrow">Extreme nudge</p>
        <h2>Closed {event.closedLabel}</h2>
        <p>{event.focusLabel ? `Returned to ${event.focusLabel}` : "Drift target is out of the way"}</p>
      </div>
    </aside>
  );
}
