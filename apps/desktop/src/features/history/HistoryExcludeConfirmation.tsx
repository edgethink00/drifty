import { useId, useRef, useState, type ReactNode } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import { KeyHint } from "../../components/KeyHint";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import type { DescribedActionError } from "../../lib/actionErrors";
import { useLocalization } from "../localization/LocalizationContext";
import type { HistoryExclusionTarget } from "./historyExclusion";

type HistoryExcludeConfirmationProps = {
  readonly target: HistoryExclusionTarget;
  readonly icon: ReactNode;
  /** Past records the rule would match; null while counting, "error" when the count failed. */
  readonly pastCount: number | null | "error";
  readonly saving: boolean;
  readonly error: DescribedActionError | null;
  readonly onCancel: () => void;
  readonly onConfirm: (deletePast: boolean) => void;
};

/**
 * Keeping a History row's site or app out of history asks first: it changes
 * what is recorded from now on. Past records stay unless the user also ticks
 * their deletion, which the button then names.
 */
export function HistoryExcludeConfirmation({ target, icon, pastCount, saving, error, onCancel, onConfirm }: HistoryExcludeConfirmationProps) {
  const { t } = useLocalization();
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const detailId = useId();
  const [deletePast, setDeletePast] = useState(false);
  useModalDismiss(onCancel, { disabled: saving });
  const overlayDismiss = useOverlayDismiss(onCancel, { disabled: saving });
  useAnchoredDialog(panelRef);
  const count = typeof pastCount === "number" ? pastCount : 0;
  const deleting = deletePast && count > 0;
  const confirmLabel = t("history.exclude.confirm");
  const confirmDeleteLabel = t("history.exclude.confirmDelete");

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={panelRef}
        className="auth-modal modal-shell history-exclude-modal"
        data-modal-variant="compact"
        role="dialog"
        aria-modal="true"
        aria-busy={saving}
        aria-labelledby={titleId}
        aria-describedby={detailId}
        data-modal-initial-selector="[data-history-exclude-cancel]"
      >
        <div className="auth-modal__header">
          <h2 id={titleId}>{t(target.kind === "site" ? "history.exclude.titleSite" : "history.exclude.titleApp")}</h2>
        <div className="history-exclude-modal__target">
          <span className="history-exclude-modal__icon" aria-hidden="true">{icon}</span>
          <span className="history-exclude-modal__name">
            <strong>{target.name}</strong>
            {target.recordedHost ? <span>{t("history.exclude.coversHost", { host: target.recordedHost })}</span> : null}
          </span>
        </div>
        {/* A failure takes the explanation's place in one grid cell, so the
            buttons below stay where they are. */}
        <div className={`history-exclude-modal__detail${error ? " has-error" : ""}`}>
          <p id={detailId}>{t("history.exclude.detail")}{deleting ? ` ${t("screenContext.activityDeleteHint")}` : ""}</p>
          {error ? (
            <p className="history-exclude-modal__error" role="alert" title={error.detail ?? undefined}>
              {error.message}
              {error.detail ? <span className="sr-only"> {error.detail}</span> : null}
            </p>
          ) : null}
        </div>
        </div>
        <div className="history-exclude-modal__past">
          {pastCount === null ? (
            <span className="history-exclude-modal__past-note">{t("history.exclude.pastCounting")}</span>
          ) : pastCount === "error" ? (
            <span className="history-exclude-modal__past-note">{t("history.exclude.pastCountError")}</span>
          ) : pastCount === 0 ? (
            <span className="history-exclude-modal__past-note">{t("history.exclude.pastNone")}</span>
          ) : (
            <label className="history-exclude-modal__past-choice">
              <input type="checkbox" checked={deletePast} disabled={saving} onChange={(event) => setDeletePast(event.currentTarget.checked)} />
              <span>
                {t(count === 1 ? "history.exclude.deletePastOne" : "history.exclude.deletePast", { count })}
                <span className="history-exclude-modal__past-hint">{t("history.exclude.deletePastHint")}</span>
              </span>
            </label>
          )}
        </div>
        {saving ? <span className="action-status" role="status">{t(deleting ? "common.deleting" : "history.exclude.saving")}</span> : null}
        <div className="history-exclude-modal__actions">
          <button type="button" className="modal-btn modal-btn--ghost" data-history-exclude-cancel disabled={saving} onClick={onCancel}>
            {t("common.cancel")}
            <KeyHint shortcut="escape" />
          </button>
          <button
            type="button"
            className={`modal-btn ${deleting ? "modal-btn--danger" : "modal-btn--primary"}`}
            disabled={saving}
            aria-busy={saving}
            onClick={() => onConfirm(deleting)}
          >
            <ActionLabel busy={saving} reserve={[confirmLabel, confirmDeleteLabel]}>{deleting ? confirmDeleteLabel : confirmLabel}</ActionLabel>
          </button>
        </div>
      </section>
    </div>
  );
}
