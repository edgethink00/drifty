import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { shiftIsoDate } from "@drifty/domain";
import type { DeleteHistoryRangeResult, DeleteHistoryRangeScopes } from "@drifty/domain";

import { trackerClient } from "../../lib/api/trackerClient";
import { localDateKey } from "../../lib/formatting";
import { SettingsSelect } from "./SettingsSelect";
import type { SettingsSelectOption } from "./SettingsSelect";
import "./DeleteHistoryModal.css";

type RangePreset = "today" | "last7" | "last30" | "all" | "custom";

const RANGE_OPTIONS: readonly SettingsSelectOption<RangePreset>[] = [
  { value: "today", label: "Today" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
] as const;

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
};

export function DeleteHistoryModal({ onClose, onDeleted }: DeleteHistoryModalProps) {
  const [preset, setPreset] = useState<RangePreset>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState<DeleteHistoryRangeResult | null>(null);
  const armTimer = useRef<number | null>(null);

  const bounds = rangeBounds(preset, customStart, customEnd);

  useEffect(() => {
    return () => {
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    setArmed(false);
  }, [preset, customStart, customEnd]);

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
      await onDeleted();
      window.setTimeout(onClose, 1600);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      setDeleting(false);
    }
  };

  return (
    <div className="auth-modal__overlay" onClick={handleOverlayClick}>
      <section
        aria-labelledby="delete-history-modal-title"
        aria-modal="true"
        className="auth-modal delete-history-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="auth-modal__header">
          <h2 id="delete-history-modal-title">Delete history</h2>
          <p>Removes tracked activity for the selected range, including its AI labels and cached YouTube metadata. Classification rules and settings are kept. This cannot be undone.</p>
        </div>

        {error ? <p className="auth-modal__error" role="alert">{error}</p> : null}

        {done ? (
          <p className="auth-modal__success" role="status">
            Deleted {summarizeCounts(done)}.
          </p>
        ) : (
          <>
            <div className="delete-history-modal__range-row">
              <span className="delete-history-modal__range-label">Range</span>
              <SettingsSelect
                ariaLabel="Delete range"
                className="delete-history-modal__range-select"
                options={RANGE_OPTIONS}
                value={preset}
                onChange={setPreset}
              />
            </div>
            {preset === "custom" ? (
              <div className="delete-history-modal__custom-range">
                <label>
                  <span>From</span>
                  <input max={localDateKey(new Date())} type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
                </label>
                <label>
                  <span>To</span>
                  <input max={localDateKey(new Date())} type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
                </label>
              </div>
            ) : null}

            <div className="delete-history-modal__actions">
              <button className="settings-btn" disabled={deleting} type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className={`settings-btn danger${armed ? " is-armed" : ""}`}
                disabled={!canDelete}
                type="button"
                onClick={handleDelete}
              >
                {deleting ? "Deleting…" : armed ? "Click again to confirm" : "Delete permanently"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function rangeBounds(
  preset: RangePreset,
  customStart: string,
  customEnd: string,
): { readonly start?: string; readonly end?: string } | null {
  const today = localDateKey(new Date());
  switch (preset) {
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

function summarizeCounts(result: DeleteHistoryRangeResult): string {
  const parts: string[] = [];
  if (result.activitySegments > 0) parts.push(`${result.activitySegments.toLocaleString()} activity ${result.activitySegments === 1 ? "segment" : "segments"}`);
  if (result.classifications > 0) parts.push(`${result.classifications.toLocaleString()} ${result.classifications === 1 ? "classification" : "classifications"}`);
  if (result.youtubeMetadata > 0) parts.push(`${result.youtubeMetadata.toLocaleString()} YouTube metadata ${result.youtubeMetadata === 1 ? "entry" : "entries"}`);
  return parts.length > 0 ? parts.join(" · ") : "no rows";
}
