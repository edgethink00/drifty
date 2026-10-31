import { FloatingNoticePortal } from "../../components/FloatingNoticePortal";
import { useFloatingNotice } from "../../components/useFloatingNotice";
import { useLocalization } from "../localization/LocalizationContext";
import type { PendingActivityDeletionEntry } from "./pendingActivityDeletion";
import "../settings/HistoryDeletionNotice.css";
import "./ActivityDeletionUndoNotice.css";

type ActivityDeletionUndoNoticeProps = {
  readonly entry: PendingActivityDeletionEntry;
  readonly onUndo: (id: number) => void;
  /** The notice has left: commit the deletion unless it was undone. */
  readonly onClosed: (id: number) => void;
};

/**
 * The app's floating notice with Undo for the "Delete, then Undo" candidate.
 * Its five-second window pauses under the pointer or keyboard focus, like the
 * history deletion notice it shares its card with.
 */
export function ActivityDeletionUndoNotice({ entry, onUndo, onClosed }: ActivityDeletionUndoNoticeProps) {
  const { t } = useLocalization();
  const { id } = entry;
  const count = entry.ids.length;
  const undone = entry.phase === "undone";
  const notice = useFloatingNotice(() => onClosed(id));
  const title = count > 1
    ? t("dashboard.activityDetail.deletedMany", { count })
    : t("dashboard.activityDetail.deletedOne");
  const className = [
    "history-deletion-notice",
    "activity-deletion-notice",
    notice.isLeaving ? "is-leaving" : notice.hasEntered ? "is-settled" : "is-entering",
    notice.isTimerPaused ? "is-paused" : "",
  ].filter(Boolean).join(" ");
  if (typeof document === "undefined") return null;
  return (
    <FloatingNoticePortal>
      <section ref={notice.rootRef} className={className} role="status" aria-atomic="true" aria-label={title} {...notice.handlers}>
        <span className="history-deletion-notice__copy">
          <strong>{title}</strong>
          <span>{t("dashboard.activityDetail.deletedDetail")}</span>
        </span>
        <button
          type="button"
          className="activity-deletion-notice__undo"
          disabled={undone}
          onClick={() => {
            onUndo(id);
            notice.requestLeave();
          }}
        >
          {t("dashboard.week.inspector.undo")}
        </button>
        <button className="history-deletion-notice__dismiss" type="button" aria-label={t("settings.deleteHistory.dismissNotice")} onClick={notice.requestLeave}>
          <svg className="history-deletion-notice__ring" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
            <circle className="history-deletion-notice__ring-track" cx="14" cy="14" r="11" />
            <circle className="history-deletion-notice__ring-progress" cx="14" cy="14" r="11" />
          </svg>
          <span className="history-deletion-notice__dismiss-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" /></svg></span>
        </button>
        <span className="sr-only" role="timer" aria-label={t("settings.deleteHistory.noticeTimer")} />
      </section>
    </FloatingNoticePortal>
  );
}
