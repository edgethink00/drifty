import { FloatingNoticePortal } from "../../components/FloatingNoticePortal";
import { useFloatingNotice } from "../../components/useFloatingNotice";
import { useLocalization } from "../localization/LocalizationContext";
import type { AiClassificationRunNoticeModel } from "./aiClassificationRunNoticeModel";
import "../settings/HistoryDeletionNotice.css";

/** The result of a manual AI classification command, in the shared five-second floating notice frame. */
export function AiClassificationRunNotice({ notice, onDismiss }: { readonly notice: AiClassificationRunNoticeModel; readonly onDismiss: () => void }) {
  const { t } = useLocalization();
  const floating = useFloatingNotice(onDismiss);
  const className = ["history-deletion-notice", floating.isLeaving ? "is-leaving" : floating.hasEntered ? "is-settled" : "is-entering", floating.isTimerPaused ? "is-paused" : ""].filter(Boolean).join(" ");
  if (typeof document === "undefined") return null;
  return <FloatingNoticePortal>
    <section ref={floating.rootRef} className={className} role={notice.role} aria-atomic="true" aria-label={notice.title} {...floating.handlers}>
      <span className="history-deletion-notice__copy">
        <strong>{notice.title}</strong>
        <span>{notice.detail}</span>
      </span>
      <button className="history-deletion-notice__dismiss" type="button" aria-label={t("classification.runNotice.dismiss")} onClick={floating.requestLeave}>
        <svg className="history-deletion-notice__ring" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
          <circle className="history-deletion-notice__ring-track" cx="14" cy="14" r="11" />
          <circle className="history-deletion-notice__ring-progress" cx="14" cy="14" r="11" />
        </svg>
        <span className="history-deletion-notice__dismiss-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" /></svg></span>
      </button>
      <span className="sr-only" role="timer" aria-label={t("settings.deleteHistory.noticeTimer")} />
    </section>
  </FloatingNoticePortal>;
}
