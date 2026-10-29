import { useEffect, useRef, useState } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import { KeyHint } from "../../components/KeyHint";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { formatIntlRange, localeForDisplayLanguage } from "../../lib/formatting";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import { SettingsSelect } from "./SettingsSelect";
import type { ScreenDeleteRange, ScreenDeletionPreviewState } from "../screen-context/useScreenDeletionPreview";

const RANGE_LABEL = { "1": "screenRecording.delete.hour", "24": "screenRecording.delete.day", all: "screenRecording.delete.all" } as const;
const RANGES = Object.keys(RANGE_LABEL) as ScreenDeleteRange[];

function imageSize(bytes: number, locale: string): { readonly value: string; readonly unit: string } {
  const unit = bytes >= 1024 * 1024 ? "MB" : bytes >= 1024 ? "KB" : "B";
  const divisor = unit === "MB" ? 1024 * 1024 : unit === "KB" ? 1024 : 1;
  return { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / divisor), unit };
}

/**
 * Screen-only range deletion. It shares the Settings deletion dialog's chrome
 * (close control, title + subtitle, footer note, Esc hint) so both deletions on
 * Privacy & Data read as one family: the same period select, and the same
 * second press before deleting everything. As a plain delete it takes no Enter
 * shortcut (product decision 2026-10-13 "Dialog key hints"). Deletion stays disabled until
 * the estimate for the exact displayed interval has arrived and is non-empty.
 */
export function ScreenRecordingDeleteModal({ range, onRangeChange, preview, busy, error, onClose, onConfirm }: {
  readonly range: ScreenDeleteRange;
  readonly onRangeChange: (range: ScreenDeleteRange) => void;
  readonly preview: ScreenDeletionPreviewState;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  const { t, effectiveLanguage } = useLocalization();
  const locale = localeForDisplayLanguage(effectiveLanguage);
  const dialogRef = useRef<HTMLElement | null>(null);
  useModalDismiss(onClose, { disabled: busy });
  const overlayDismiss = useOverlayDismiss(onClose, { disabled: busy });
  useAnchoredDialog(dialogRef);
  const ready = preview.current;
  const state = ready ? (ready.value.recordCount === 0 ? "empty" : "ready") : preview.failed ? "failed" : "loading";
  const canDelete = !busy && state === "ready";
  // Deleting every saved screen asks for a second press, like activity history.
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<number | null>(null);
  useEffect(() => { setArmed(false); }, [range]);
  useEffect(() => () => { if (armTimer.current !== null) window.clearTimeout(armTimer.current); }, []);
  const confirm = () => {
    if (!canDelete) return;
    if (range === "all" && !armed) {
      setArmed(true);
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArmed(false), 3000);
      return;
    }
    onConfirm();
  };
  const size = ready ? imageSize(ready.value.imageBytes, locale) : null;
  const span = ready && ready.startMs !== null && ready.endMs !== null
    ? formatIntlRange(new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      new Date(ready.startMs), new Date(ready.endMs))
    : t("screenRecording.delete.allLocal");
  const count = ready?.value.recordCount ?? 0;
  const countText = count === 1 ? t("screenRecording.delete.countOne")
    : t("screenRecording.delete.countMany", { count: count.toLocaleString(locale) });
  // The count is bold inside a translated sentence; split around a marker so
  // each language keeps its own word order.
  const [summaryBefore, summaryAfter] = t("screenRecording.delete.summary", { count: "\u0000", size: size ? size.value + " " + size.unit : "" }).split("\u0000");

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section ref={dialogRef} className="auth-modal modal-shell screen-recording-delete" data-modal-variant="compact"
        role="dialog" aria-modal="true" aria-labelledby="screen-recording-delete-title" aria-busy={busy} tabIndex={-1}
        onClick={(event) => event.stopPropagation()}>
        <ModalCloseButton disabled={busy} label={t("screenRecording.delete.cancel")} onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="screen-recording-delete-title">{t("screenRecording.delete.title")}</h2>
            <p>{t("screenRecording.delete.body")}</p>
          </div>
        </div>
        <div className="modal-range-row">
          <span className="modal-range-row__label">{t("screenRecording.delete.range")}</span>
          <SettingsSelect ariaLabel={t("screenRecording.delete.rangeAria")} className="modal-range-row__select" disabled={busy}
            options={RANGES.map((value) => ({ value, label: t(RANGE_LABEL[value]) }))} value={range} onChange={onRangeChange} />
        </div>
        <div className="modal-foot">
          {error ? <p className="modal-foot__note modal-foot__note--error" role="alert">{error}</p>
            : (
              // What the period removes sits where activity-history deletion puts
              // its warning: directly above the action, with no extra rule.
              <span className="modal-foot__note screen-recording-delete__note" data-state={state} role="status" aria-live="polite" aria-busy={state === "loading"}>
                {state === "loading" ? <>
                  <span className="loading-skeleton-line screen-recording-delete__skeleton" aria-hidden="true" />
                  <span className="loading-skeleton-line screen-recording-delete__skeleton screen-recording-delete__skeleton--wide" aria-hidden="true" />
                  <span className="sr-only">{t("screenRecording.delete.calculating")}</span>
                </>
                  : state === "failed" ? (
                    <span className="screen-recording-delete__failed">
                      {t("screenRecording.delete.previewFailed")}
                      <button type="button" className="modal-btn modal-btn--ghost screen-recording-delete__retry" onClick={preview.retry}>
                        {t("screenRecording.viewer.retry")}
                      </button>
                    </span>
                  )
                  : <>
                    <span>{state === "empty" ? t("screenRecording.delete.empty") : <>{summaryBefore}<strong>{countText}</strong>{summaryAfter}</>}</span>
                    <span className="screen-recording-delete__time">{span}</span>
                  </>}
              </span>
            )}
          <button type="button" className="modal-btn modal-btn--ghost" disabled={busy} onClick={onClose}>
            {t("screenRecording.delete.cancel")}
            <KeyHint shortcut="escape" />
          </button>
          <button type="button" className={"modal-btn modal-btn--danger" + (armed && !busy ? " is-armed" : "")} disabled={!canDelete} aria-busy={busy} onClick={confirm}>
            <ActionLabel busy={busy} busyLabel={t("screenRecording.delete.deleting")}
              reserve={[t("screenRecording.delete.permanently"), t("screenRecording.delete.confirmAgain")]}>
              {armed ? t("screenRecording.delete.confirmAgain") : t("screenRecording.delete.permanently")}
            </ActionLabel>
          </button>
        </div>
      </section>
    </div>
  );
}
