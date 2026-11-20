import { useId, useRef, useState, type FormEvent } from "react";
import { KeyHint } from "../../components/KeyHint";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { Toggle } from "../../components/Toggle";
import { formatLocalizedCompactDurationFromSeconds, formatStartOfDayOptionLabel, localeForDisplayLanguage } from "../../lib/formatting";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import { pomodoroPlanMinutes, type PomodoroPlan } from "./focusSession";
import "./focusSessionCustomDialog.css";

export type PendingFocusStart =
  | { readonly mode: "single"; readonly minutes: number }
  | { readonly mode: "pomodoro"; readonly plan: PomodoroPlan };

/**
 * The first session picked from the menu bar while Automatic close is off (owner review
 * 2026-11-20): before it starts, the main window names the session and when it ends, with
 * Automatic close for sessions switched on. Start begins the session with what the switch says;
 * the dialog itself is the consent, so it says plainly that tabs close.
 */
export function FocusStartOfferDialog({ pending, onCancel, onStart }: {
  readonly pending: PendingFocusStart;
  readonly onCancel: () => void;
  readonly onStart: (autoClose: boolean) => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const [autoClose, setAutoClose] = useState(true);
  const dialogRef = useRef<HTMLElement>(null);
  const idPrefix = useId().replace(/:/g, "") + "-";
  useModalDismiss(onCancel);
  useAnchoredDialog(dialogRef);
  const overlayDismiss = useOverlayDismiss(onCancel);
  const minutes = pending.mode === "single" ? pending.minutes : pomodoroPlanMinutes(pending.plan);
  const end = new Date(Date.now() + minutes * 60_000);
  const ends = formatStartOfDayOptionLabel(end.getHours() * 60 + end.getMinutes(), localeForDisplayLanguage(effectiveLanguage));
  const title = pending.mode === "single"
    ? t("focus.start.titleSingle", { duration: formatLocalizedCompactDurationFromSeconds(minutes * 60, effectiveLanguage) })
    : t("focus.start.titlePomodoro");
  const label = t("settings.notifications.extreme");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onStart(autoClose);
  };
  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section ref={dialogRef} className="auth-modal modal-shell fs-custom fs-offer" data-modal-variant="compact" role="dialog" aria-modal="true"
        aria-labelledby={idPrefix + "title"} data-modal-initial-selector=".modal-btn--primary" onClick={(event) => event.stopPropagation()}>
        <ModalCloseButton label={t("focus.custom.close")} onClick={onCancel} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id={idPrefix + "title"}>{title}</h2>
            <p>{t("focus.session.endsAt", { time: ends })}</p>
          </div>
        </div>
        <form onSubmit={submit}>
          <div className="fs-offer__row" data-on={autoClose || undefined}>
            <span className="fs-offer__copy">
              <span className="fs-offer__title">{label}<span className="status-badge status-badge--beta">{t("common.beta")}</span></span>
              <span className="fs-offer__desc" id={idPrefix + "desc"}>{t("focus.start.autoCloseBody")}</span>
            </span>
            <Toggle checked={autoClose} onChange={setAutoClose} ariaLabel={label} ariaDescribedBy={idPrefix + "desc"} />
          </div>
          <div className="modal-foot">
            <button type="button" className="modal-btn modal-btn--ghost" onClick={onCancel}>
              {t("common.cancel")}<KeyHint shortcut="escape" />
            </button>
            <button type="submit" className="modal-btn modal-btn--primary">
              {t("focus.custom.start")}<KeyHint shortcut="enter" />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
