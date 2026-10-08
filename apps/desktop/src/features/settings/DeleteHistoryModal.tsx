import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { shiftIsoDate } from "@drifty/domain";
import type { DeleteHistoryRangeResult, DeleteHistoryRangeScopes } from "@drifty/domain";

import { trackerClient } from "../../lib/api/trackerClient";
import { localDateKey } from "../../lib/formatting";
import { SettingsSelect } from "./SettingsSelect";
import type { SettingsSelectOption } from "./SettingsSelect";
import { ActionLabel } from "../../components/ActionLabel";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import "./DeleteHistoryModal.css";
import { useLocalization } from "../localization/LocalizationContext";
import { summarizeHistoryDeletion } from "./historyDeletionSummary";
import { localizeSettingsError } from "../localization/settingsMessageTranslations";

type RangePreset = "lastHour" | "today" | "last7" | "last30" | "all" | "custom";

// The deletion scope is fixed: tracked activity for the range, its
// classifications (via cascade), and cached YouTube metadata. Classification
// rules and settings are never touched.
const DELETE_SCOPES: DeleteHistoryRangeScopes = {
  activity: true,
  aiClassifications: false,
  youtubeMetadata: true,
};

type DeleteHistoryModalProps = {
  readonly onClose: () => void;
  readonly onDeleted: () => Promise<void> | void;
  readonly onCompleted: (result: DeleteHistoryRangeResult) => void;
  readonly deviceSyncEnabled?: boolean;
};

export function DeleteHistoryModal({ onClose, onDeleted, onCompleted, deviceSyncEnabled = false }: DeleteHistoryModalProps) {
  const { effectiveLanguage, t } = useLocalization();
  const rangeOptions: readonly SettingsSelectOption<RangePreset>[] = [
    { value: "lastHour", label: t("settings.deleteHistory.lastHour") },
    { value: "today", label: t("settings.deleteHistory.today") },
    { value: "last7", label: t("settings.deleteHistory.last7") },
    { value: "last30", label: t("settings.deleteHistory.last30") },
    { value: "all", label: t("settings.deleteHistory.all") },
    { value: "custom", label: t("settings.deleteHistory.custom") },
  ];
  const [preset, setPreset] = useState<RangePreset>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletedResult, setDeletedResult] = useState<DeleteHistoryRangeResult | null>(null);
  const armTimer = useRef<number | null>(null);
  const refreshButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const requestInFlight = useRef(false);

  const bounds = rangeBounds(preset, customStart, customEnd);
  const dateOrderInvalid = Boolean(customStart && customEnd && customStart > customEnd);

  useEffect(() => {
    return () => {
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    };
  }, []);

  useModalDismiss(onClose, { disabled: deleting });
  useAnchoredDialog(dialogRef);

  useEffect(() => {
    setArmed(false);
  }, [preset, customStart, customEnd]);

  // A failed refresh replaces the form; put keyboard focus on its recovery action.
  useEffect(() => {
    if (deletedResult && refreshError && !deleting) refreshButtonRef.current?.focus();
  }, [deletedResult, refreshError, deleting]);

  const canDelete = Boolean(bounds) && !deleting && !deletedResult;
  const needsArm = preset === "all";

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !deleting) onClose();
  };

  const handleDelete = async () => {
    if (!bounds || !canDelete || requestInFlight.current) return;
    if (needsArm && !armed) {
      setArmed(true);
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArmed(false), 3000);
      return;
    }

    requestInFlight.current = true;
    setDeleting(true);
    setError(null);
    setRefreshError(null);
    let completed: DeleteHistoryRangeResult | null = null;
    try {
      const result = await trackerClient.deleteHistoryRange({ ...bounds, scopes: DELETE_SCOPES, dryRun: false });
      setDeletedResult(result);
      if (preset === "all") await clearIconCachesBestEffort();
      try {
        await onDeleted();
        completed = result;
      } catch (refreshFailure) {
        setRefreshError(refreshFailure instanceof Error ? refreshFailure.message : String(refreshFailure));
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      // A successful write stays successful even if refreshing the views fails.
      setDeleting(false);
      requestInFlight.current = false;
    }
    // The caller closes the dialog and keeps the receipt on the originating page.
    if (completed) onCompleted(completed);
  };

  const retryRefresh = async () => {
    if (requestInFlight.current || !deletedResult) return;
    requestInFlight.current = true;
    setDeleting(true);
    let refreshed = false;
    try {
      await onDeleted();
      refreshed = true;
    } catch (refreshFailure) {
      setRefreshError(refreshFailure instanceof Error ? refreshFailure.message : String(refreshFailure));
    } finally {
      setDeleting(false);
      requestInFlight.current = false;
    }
    if (refreshed) onCompleted(deletedResult);
  };

  return (
    <div className="auth-modal__overlay" onClick={handleOverlayClick}>
      <section
        ref={dialogRef}
        aria-labelledby="delete-history-modal-title"
        aria-modal="true"
        aria-busy={deleting}
        className="auth-modal modal-shell delete-history-modal"
        data-modal-variant="compact"
        role="dialog"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton disabled={deleting} label={t("settings.deleteHistory.cancel")} onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="delete-history-modal-title">{t("settings.deleteHistory.title")}</h2>
            <p>
              {t("settings.deleteHistory.description")}
              {deviceSyncEnabled ? ` ${t("settings.deleteHistory.syncDescription")}` : ""}
            </p>
          </div>
        </div>

        {deletedResult && refreshError ? (
          <>
            <p className="auth-modal__success" role="status">
              {t("settings.deleteHistory.deleted", { summary: summarizeHistoryDeletion(deletedResult, effectiveLanguage, t) })}
            </p>
            <p className="auth-modal__error" role="alert">
              {t("settings.deleteHistory.refreshFailed")} {localizeSettingsError(refreshError, effectiveLanguage, t)}
            </p>
            <div className="modal-foot">
              <button
                ref={refreshButtonRef}
                aria-busy={deleting}
                className="modal-btn modal-btn--primary"
                disabled={deleting}
                type="button"
                onClick={() => void retryRefresh()}
              >
                <ActionLabel busy={deleting} busyLabel={t("settings.deleteHistory.processing")}>{t("history.refreshView")}</ActionLabel>
              </button>
              <button className="modal-btn modal-btn--ghost" disabled={deleting} type="button" onClick={onClose}>
                {t("settings.deleteHistory.close")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="delete-history-modal__range-row">
              <span className="delete-history-modal__range-label">{t("settings.deleteHistory.range")}</span>
              <SettingsSelect
                ariaLabel={t("settings.deleteHistory.rangeAria")}
                className="delete-history-modal__range-select"
                options={rangeOptions}
                value={preset}
                onChange={setPreset}
                disabled={deleting}
              />
            </div>
            {preset === "custom" ? (
              <div className="delete-history-modal__custom-range">
                <label>
                  <span>{t("settings.deleteHistory.from")}</span>
                  <input disabled={deleting} aria-invalid={dateOrderInvalid} aria-describedby="delete-history-date-hint" max={localDateKey(new Date())} type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
                </label>
                <label>
                  <span>{t("settings.deleteHistory.to")}</span>
                  <input disabled={deleting} aria-invalid={dateOrderInvalid} aria-describedby="delete-history-date-hint" max={localDateKey(new Date())} type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
                </label>
                <p id="delete-history-date-hint" className={`delete-history-modal__date-hint${dateOrderInvalid ? " is-invalid" : ""}`} role={dateOrderInvalid ? "alert" : undefined}>
                  {dateOrderInvalid ? t("settings.deleteHistory.dateOrderError") : !bounds ? t("settings.deleteHistory.chooseDates") : "\u00a0"}
                </p>
              </div>
            ) : null}

            {deleting ? (
              <span className="action-status" role="status">
                {t(deletedResult ? "settings.deleteHistory.refreshing" : "settings.deleteHistory.deleting")}
              </span>
            ) : null}

            <div className="modal-foot">
              {error ? (
                // The request's detail stays in the alert for assistive technology
                // and shows on hover; the visible line keeps to what fits beside
                // the actions.
                <p className="modal-foot__note modal-foot__note--error" role="alert" title={error}>
                  {t("settings.deleteHistory.deleteFailed")}<span className="action-status"> {error}</span>
                </p>
              ) : (
                <span className="modal-foot__note">{t("settings.deleteHistory.note")}</span>
              )}
              <button className="modal-btn modal-btn--ghost" disabled={deleting} type="button" onClick={onClose}>
                {t("settings.deleteHistory.cancel")}
              </button>
              <button
                aria-busy={deleting}
                className={`modal-btn modal-btn--danger${armed && !deleting ? " is-armed" : ""}`}
                disabled={!canDelete}
                type="button"
                onClick={handleDelete}
              >
                <ActionLabel
                  busy={deleting}
                  busyLabel={t("settings.deleteHistory.processing")}
                  reserve={needsArm ? [t("settings.deleteHistory.deletePermanently"), t("settings.deleteHistory.confirmAgain")] : [t("settings.deleteHistory.deletePermanently")]}
                >
                  {armed ? t("settings.deleteHistory.confirmAgain") : t("settings.deleteHistory.deletePermanently")}
                </ActionLabel>
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Cached app and site icons are named after what was tracked. A full wipe clears them
 * too, so no trace of the history remains. They are regenerable and nothing is left to
 * fetch icons for; a failure here must not turn a completed deletion into an error.
 */
async function clearIconCachesBestEffort(): Promise<void> {
  try {
    await trackerClient.clearIconCaches();
  } catch {
    // Best effort only.
  }
}

function rangeBounds(
  preset: RangePreset,
  customStart: string,
  customEnd: string,
): { readonly start?: string; readonly end?: string } | null {
  const today = localDateKey(new Date());
  switch (preset) {
    case "lastHour":
      // Full datetime bounds pass through to the tracker untouched (naive =
      // local time); the open end keeps the currently tracked segment included.
      return { start: localDateTimeKey(new Date(Date.now() - 60 * 60 * 1000)) };
    case "today":
      return { start: today, end: today };
    case "last7":
      return { start: shiftIsoDate(today, -6), end: today };
    case "last30":
      return { start: shiftIsoDate(today, -29), end: today };
    case "all":
      return {};
    case "custom":
      if (!customStart || !customEnd || customStart > customEnd) return null;
      return { start: customStart, end: customEnd };
    default:
      return null;
  }
}

function localDateTimeKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
