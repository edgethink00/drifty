import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { shiftIsoDate } from "@drifty/domain";
import type { DeleteHistoryRangeResult, DeleteHistoryRangeScopes } from "@drifty/domain";

import { trackerClient } from "../../lib/api/trackerClient";
import { localDateKey } from "../../lib/formatting";
import { SettingsSelect } from "./SettingsSelect";
import type { SettingsSelectOption } from "./SettingsSelect";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import "./DeleteHistoryModal.css";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
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
  readonly deviceSyncEnabled?: boolean;
};

export function DeleteHistoryModal({ onClose, onDeleted, deviceSyncEnabled = false }: DeleteHistoryModalProps) {
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
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState<DeleteHistoryRangeResult | null>(null);
  const armTimer = useRef<number | null>(null);
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);

  const bounds = rangeBounds(preset, customStart, customEnd);

  useEffect(() => {
    return () => {
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    };
  }, []);

  useModalDismiss(onClose, { disabled: deleting });

  useEffect(() => {
    setArmed(false);
  }, [preset, customStart, customEnd]);

  // The delete button unmounts with the form, so hand focus to the result's
  // own action (once the post-delete refresh has finished and it is enabled)
  // instead of dropping it on the page behind the dialog.
  useEffect(() => {
    if (done && !deleting) doneButtonRef.current?.focus();
  }, [done, deleting]);

  const canDelete = Boolean(bounds) && !deleting && !done;
  const needsArm = preset === "all";

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !deleting) onClose();
  };

  const handleDelete = async () => {
    if (!bounds || !canDelete) return;
    if (needsArm && !armed) {
      setArmed(true);
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArmed(false), 3000);
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      const result = await trackerClient.deleteHistoryRange({ ...bounds, scopes: DELETE_SCOPES, dryRun: false });
      setDone(result);
      if (preset === "all") await clearIconCachesBestEffort();
      await onDeleted();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      // The result stays until the user closes it: this is an irreversible
      // action, and its counts are the only confirmation of what was removed.
      // Closing stays locked until the refresh settles so its error, if any,
      // lands in a dialog that is still open.
      setDeleting(false);
    }
  };

  return (
    <div className="auth-modal__overlay" onClick={handleOverlayClick}>
      <section
        aria-labelledby="delete-history-modal-title"
        aria-modal="true"
        className="auth-modal modal-shell delete-history-modal"
        data-modal-variant="compact"
        role="dialog"
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

        {error ? <p className="auth-modal__error" role="alert">{localizeSettingsError(error, effectiveLanguage, t)}</p> : null}

        {done ? (
          <>
            <p className="auth-modal__success" role="status">
              {t("settings.deleteHistory.deleted", { summary: summarizeCounts(done, effectiveLanguage, t) })}
            </p>
            <div className="modal-foot">
              <button ref={doneButtonRef} className="modal-btn modal-btn--primary" disabled={deleting} type="button" onClick={onClose}>
                {t("settings.deleteHistory.done")}
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
              />
            </div>
            {preset === "custom" ? (
              <div className="delete-history-modal__custom-range">
                <label>
                  <span>{t("settings.deleteHistory.from")}</span>
                  <input max={localDateKey(new Date())} type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
                </label>
                <label>
                  <span>{t("settings.deleteHistory.to")}</span>
                  <input max={localDateKey(new Date())} type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
                </label>
              </div>
            ) : null}

            <div className="modal-foot">
              <span className="modal-foot__note">{t("settings.deleteHistory.note")}</span>
              <button className="modal-btn modal-btn--ghost" disabled={deleting} type="button" onClick={onClose}>
                {t("settings.deleteHistory.cancel")}
              </button>
              <button
                className={`modal-btn modal-btn--danger${armed ? " is-armed" : ""}`}
                disabled={!canDelete}
                type="button"
                onClick={handleDelete}
              >
                {deleting ? t("settings.deleteHistory.deleting") : armed ? t("settings.deleteHistory.confirmAgain") : t("settings.deleteHistory.deletePermanently")}
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

function summarizeCounts(result: DeleteHistoryRangeResult, language: "en" | "ko", t: LocalizationController["t"]): string {
  const parts: string[] = [];
  const locale = language === "ko" ? "ko-KR" : "en-US";
  if (result.activitySegments > 0) parts.push(t(result.activitySegments === 1 ? "settings.deleteHistory.activitySingle" : "settings.deleteHistory.activityPlural", { count: result.activitySegments.toLocaleString(locale) }));
  if (result.classifications > 0) parts.push(t(result.classifications === 1 ? "settings.deleteHistory.classificationSingle" : "settings.deleteHistory.classificationPlural", { count: result.classifications.toLocaleString(locale) }));
  if (result.youtubeMetadata > 0) parts.push(t(result.youtubeMetadata === 1 ? "settings.deleteHistory.youtubeSingle" : "settings.deleteHistory.youtubePlural", { count: result.youtubeMetadata.toLocaleString(locale) }));
  return parts.length > 0 ? parts.join(" · ") : t("settings.deleteHistory.noRows");
}
