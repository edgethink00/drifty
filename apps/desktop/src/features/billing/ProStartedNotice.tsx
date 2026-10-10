import { useFloatingNotice } from "../../components/useFloatingNotice";
import { FloatingNoticePortal } from "../../components/FloatingNoticePortal";
import { useLocalization } from "../localization/LocalizationContext";
import "./CloudTrialStartedNotice.css";

type ProStartedNoticeProps = {
  readonly onDismiss: () => void;
};

/**
 * Confirms a Pro purchase made from the app, in the trial-start notice's place
 * and form: top-right lane, five seconds, paused on hover or focus. One line for
 * everyone; a Local AI user was told before paying that the route would switch.
 */
export function ProStartedNotice({ onDismiss }: ProStartedNoticeProps) {
  const { t } = useLocalization();
  const { rootRef, hasEntered, isLeaving, isTimerPaused, requestLeave, handlers } = useFloatingNotice(onDismiss);
  const className = [
    "cloud-trial-started-notice",
    isLeaving ? "is-leaving" : hasEntered ? "is-settled" : "is-entering",
    isTimerPaused ? "is-paused" : "",
  ].filter(Boolean).join(" ");

  return (
    <FloatingNoticePortal><section
      ref={rootRef}
      className={className}
      role="status"
      aria-label={t("billing.proStarted.aria")}
      {...handlers}
    >
      <span className="cloud-trial-started-notice__copy">
        <strong>{t("billing.proStarted.title")}</strong>
        <span className="cloud-trial-started-notice__detail">{t("billing.proStarted.detail")}</span>
      </span>
      <button
        type="button"
        className="cloud-trial-started-notice__dismiss"
        aria-label={t("billing.proStarted.dismiss")}
        onClick={requestLeave}
      >
        <svg className="cloud-trial-started-notice__ring" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
          <circle className="cloud-trial-started-notice__ring-track" cx="14" cy="14" r="11" />
          <circle className="cloud-trial-started-notice__ring-progress" cx="14" cy="14" r="11" />
        </svg>
        <span className="cloud-trial-started-notice__dismiss-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
          </svg>
        </span>
      </button>
      <span className="sr-only" role="timer" aria-label={t("billing.proStarted.timerAria")} />
    </section></FloatingNoticePortal>
  );
}
