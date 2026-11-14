import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FloatingNoticePortal } from "../../components/FloatingNoticePortal";
import { useFloatingNotice } from "../../components/useFloatingNotice";
import { useLocalization } from "../localization/LocalizationContext";
import type { ScreenContextClient } from "./screenContextClient";
import { decodeScreenStatus } from "./screenContextWire";
import { markScreenTextNoticed, screenTextNoticed } from "./screenTextUse";
import "../settings/HistoryDeletionNotice.css";
import "../dashboard/ActivityDeletionUndoNotice.css";

const SCREEN_TEXT_NOTICE_MS = 8_000;

/**
 * Someone whose screen recording was already on before screen text joined classification
 * hears it once. Showing the notice is what starts the use; with recording off nothing is
 * shown, because turning recording on later says it in its own description.
 */
export function useScreenTextNotice(client: ScreenContextClient, enabled: boolean): { readonly visible: boolean; readonly dismiss: () => void } {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [visible, setVisible] = useState(false);
  const checked = useRef(false);
  useEffect(() => {
    if (!enabled || checked.current || !client.isDesktop() || snapshot.connection !== "ready" || screenTextNoticed()) return;
    checked.current = true;
    void client.consume("screen_context_get_status", {}, decodeScreenStatus, (value) => {
      if (!value.helperInstalled || !value.preferences.enabled || screenTextNoticed()) return;
      markScreenTextNoticed();
      setVisible(true);
    }).catch(() => { checked.current = false; });
  }, [client, enabled, snapshot.connection, snapshot.generation]);
  return { visible, dismiss: () => setVisible(false) };
}

export function ScreenTextNotice({ onDismiss, onManage }: { readonly onDismiss: () => void; readonly onManage: () => void }) {
  const { t } = useLocalization();
  const notice = useFloatingNotice(onDismiss, SCREEN_TEXT_NOTICE_MS);
  const className = [
    "history-deletion-notice",
    "activity-deletion-notice",
    notice.isLeaving ? "is-leaving" : notice.hasEntered ? "is-settled" : "is-entering",
    notice.isTimerPaused ? "is-paused" : "",
  ].filter(Boolean).join(" ");
  if (typeof document === "undefined") return null;
  return (
    <FloatingNoticePortal>
      <section ref={notice.rootRef} className={className} role="status" aria-atomic="true" aria-label={t("screenRecording.textUse.aria")} {...notice.handlers}>
        <span className="history-deletion-notice__copy">
          <strong>{t("screenRecording.textUse.notice")}</strong>
        </span>
        <button
          type="button"
          className="activity-deletion-notice__undo"
          onClick={() => {
            onManage();
            notice.requestLeave();
          }}
        >
          {t("screenRecording.textUse.manage")}
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
