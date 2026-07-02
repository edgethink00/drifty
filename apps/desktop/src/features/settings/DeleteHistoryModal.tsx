import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { shiftIsoDate } from "@drifty/domain";
import type { DeleteHistoryRangeResult, DeleteHistoryRangeScopes } from "@drifty/domain";

import { trackerClient } from "../../lib/api/trackerClient";
import { localDateKey } from "../../lib/formatting";
import "./DeleteHistoryModal.css";

type RangePreset = "today" | "last7" | "last30" | "all" | "custom";

const RANGE_PRESETS: readonly { readonly id: RangePreset; readonly label: string }[] = [
  { id: "today", label: "Today" },
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
] as const;

const SCOPE_ITEMS: readonly {
  readonly key: keyof DeleteHistoryRangeScopes;
  readonly label: string;
  readonly detail: string;
}[] = [
  {
    key: "activity",
    label: "Activity history",
    detail: "Raw tracked segments for this range. Their classifications are removed together.",
  },
  {
    key: "aiClassifications",
    label: "AI classification results",
    detail: "Clear AI labels only. Raw activity rows and your rules are kept.",
  },
  {
    key: "youtubeMetadata",
    label: "YouTube metadata",
    detail: "Cached video titles, channels, and descriptions for this range.",
  },
] as const;

type DeleteHistoryModalProps = {
  readonly onClose: () => void;
  readonly onDeleted: () => Promise<void> | void;
};

export function DeleteHistoryModal({ onClose, onDeleted }: DeleteHistoryModalProps) {
  const [preset, setPreset] = useState<RangePreset>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [scopes, setScopes] = useState<DeleteHistoryRangeScopes>({
    activity: true,
    aiClassifications: false,
    youtubeMetadata: false,
  });
  const [preview, setPreview] = useState<DeleteHistoryRangeResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState<DeleteHistoryRangeResult | null>(null);
  const previewSeq = useRef(0);
  const armTimer = useRef<number | null>(null);

  const bounds = rangeBounds(preset, customStart, customEnd);
  const anyScope = scopes.activity || scopes.aiClassifications || scopes.youtubeMetadata;

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
    const nextBounds = rangeBounds(preset, customStart, customEnd);
    const hasScope = scopes.activity || scopes.aiClassifications || scopes.youtubeMetadata;
    if (!nextBounds || !hasScope || done) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }

    setPreviewLoading(true);
    const seq = ++previewSeq.current;
    const handle = window.setTimeout(async () => {
      try {
        const result = await trackerClient.deleteHistoryRange({ ...nextBounds, scopes, dryRun: true });
        if (seq !== previewSeq.current) return;
        setPreview(result);
        setError(null);
      } catch (previewError) {
        if (seq !== previewSeq.current) return;
        setPreview(null);
        setError(previewError instanceof Error ? previewError.message : String(previewError));
      } finally {
        if (seq === previewSeq.current) setPreviewLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [preset, customStart, customEnd, scopes, done]);

  const previewTotal = preview ? preview.activitySegments + preview.classifications + preview.youtubeMetadata : 0;
  const canDelete = Boolean(bounds) && anyScope && !deleting && !done && previewTotal > 0 && !previewLoading;
  const needsArm = preset === "all" && scopes.activity;

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !deleting) onClose();
  };

  const handleScopeToggle = (key: keyof DeleteHistoryRangeScopes) => {
    setScopes((current) => ({ ...current, [key]: !current[key] }));
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
      const result = await trackerClient.deleteHistoryRange({ ...bounds, scopes, dryRun: false });
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
          <p>Choose a time range and what to remove. This cannot be undone.</p>
        </div>

        {error ? <p className="auth-modal__error" role="alert">{error}</p> : null}

        {done ? (
          <p className="auth-modal__success" role="status">
            Deleted {summarizeCounts(done)}.
          </p>
        ) : (
          <>
            <fieldset className="delete-history-modal__group">
              <legend>Range</legend>
              <div aria-label="Delete range" className="delete-history-modal__presets" role="radiogroup">
                {RANGE_PRESETS.map((item) => (
                  <button
                    aria-checked={preset === item.id}
                    className={`delete-history-modal__preset${preset === item.id ? " is-active" : ""}`}
                    key={item.id}
                    role="radio"
                    type="button"
                    onClick={() => setPreset(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
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
            </fieldset>

            <fieldset className="delete-history-modal__group">
              <legend>What to delete</legend>
              <div className="delete-history-modal__scopes">
                {SCOPE_ITEMS.map((item) => {
                  const includedByActivity = item.key === "aiClassifications" && scopes.activity;
                  return (
                    <label
                      className={`delete-history-modal__scope${scopes[item.key] || includedByActivity ? " is-selected" : ""}`}
                      key={item.key}
                    >
                      <input
                        checked={includedByActivity ? true : scopes[item.key]}
                        disabled={includedByActivity || deleting}
                        type="checkbox"
                        onChange={() => handleScopeToggle(item.key)}
                      />
                      <span className="delete-history-modal__scope-copy">
                        <strong>{item.label}</strong>
                        <small>{item.detail}</small>
                      </span>
                      {includedByActivity ? <span className="chip gray">Included</span> : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <p aria-live="polite" className={`delete-history-modal__preview${previewTotal > 0 ? " has-items" : ""}`}>
              {previewMessage(bounds, anyScope, previewLoading, preview, previewTotal)}
            </p>

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

function previewMessage(
  bounds: { readonly start?: string; readonly end?: string } | null,
  anyScope: boolean,
  loading: boolean,
  preview: DeleteHistoryRangeResult | null,
  total: number,
): string {
  if (!anyScope) return "Select at least one data type to delete.";
  if (!bounds) return "Pick a valid start and end date.";
  if (loading) return "Checking what this range contains…";
  if (!preview) return "Nothing to preview yet.";
  if (total === 0) return "Nothing matches this range.";
  return `Will delete ${summarizeCounts(preview)}.`;
}

function summarizeCounts(result: DeleteHistoryRangeResult): string {
  const parts: string[] = [];
  if (result.activitySegments > 0) parts.push(`${result.activitySegments.toLocaleString()} activity ${result.activitySegments === 1 ? "segment" : "segments"}`);
  if (result.classifications > 0) parts.push(`${result.classifications.toLocaleString()} ${result.classifications === 1 ? "classification" : "classifications"}`);
  if (result.youtubeMetadata > 0) parts.push(`${result.youtubeMetadata.toLocaleString()} YouTube metadata ${result.youtubeMetadata === 1 ? "entry" : "entries"}`);
  return parts.length > 0 ? parts.join(" · ") : "no rows";
}
