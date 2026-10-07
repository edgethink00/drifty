import type { DeleteHistoryRangeResult } from "@drifty/domain";
import { FloatingNoticePortal } from "../../components/FloatingNoticePortal";
import { useFloatingNotice } from "../../components/useFloatingNotice";
import { useLocalization } from "../localization/LocalizationContext";
import { summarizeHistoryDeletion } from "./historyDeletionSummary";
import "./HistoryDeletionNotice.css";

type HistoryDeletionNoticeProps = {
  readonly result: DeleteHistoryRangeResult;
  readonly onDismiss: () => void;
};

export function HistoryDeletionNotice({ result, onDismiss }: HistoryDeletionNoticeProps) {
  const { effectiveLanguage, t } = useLocalization();
  const notice = useFloatingNotice(onDismiss);
  const className = ["history-deletion-notice", notice.isLeaving ? "is-leaving" : notice.hasEntered ? "is-settled" : "is-entering", notice.isTimerPaused ? "is-paused" : ""].filter(Boolean).join(" ");
  if (typeof document === "undefined") return null;
  return <FloatingNoticePortal>
    <section ref={notice.rootRef} className={className} role="status" aria-atomic="true" aria-label={t("settings.deleteHistory.completedTitle")} {...notice.handlers}>
      <span className="history-deletion-notice__copy">
        <strong>{t("settings.deleteHistory.completedTitle")}</strong>
        <span>{summarizeHistoryDeletion(result, effectiveLanguage, t)}</span>
      </span>
      <button className="history-deletion-notice__dismiss" type="button" aria-label={t("settings.deleteHistory.dismissNotice")} onClick={notice.requestLeave}>
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
