import { useEffect, useState } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import type { ActivityInspectorLabel } from "./activityInspectorLabel";
import { useActivityLabels } from "./ActivityLabelsContext";

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

const EYE_PATH = "M2.75 12s3.4-6.25 9.25-6.25S21.25 12 21.25 12 17.85 18.25 12 18.25 2.75 12 2.75 12Z";

function clock(ms: number): string {
  const date = new Date(ms);
  return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}

function HideIcon() {
  return (
    <svg {...iconProps}>
      <path d={EYE_PATH} />
      <circle cx="12" cy="12" r="2.6" />
      <path d="m4.5 4.5 15 15" />
    </svg>
  );
}

function ShowIcon() {
  return (
    <svg {...iconProps}>
      <path d={EYE_PATH} />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

/**
 * The block's name as read-only context beneath the card's own app/site
 * header: it uses the card's full width above the Category/Productivity rows,
 * with its label kept for screen readers only. Day and Week cards share it.
 * When other timeline cards hold a real part of the block, they follow in
 * time order so a long block reads as the sequence it was.
 */
export function ActivityLabelRow({ label }: { readonly label: ActivityInspectorLabel | null | undefined }) {
  const { t } = useLocalization();
  const display = label?.display;
  if (!display) return null;
  const others = label.block.otherCards;
  return (
    <div className="activity-label-row">
      <span className="activity-label-row__title">
        <span className="sr-only">{t("activityLabels.sectionLabel")}: </span>
        {display.title}
      </span>
      {display.description ? <span className="activity-label-row__description">{display.description}</span> : null}
      {others.length > 0 ? (
        <ul className="activity-label-row__more">
          {others.map((other) => (
            <li key={other.startMs}>
              <span className="activity-label-row__time">{clock(other.startMs)}</span>
              <span>{other.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The one correction a name offers: hide it for this block, which brings back
 * the app/site display and keeps the AI from naming the block again, or show
 * it again. Only the pinned card offers it, where the tracker can store it.
 */
export function ActivityLabelVisibilityAction({ label }: { readonly label: ActivityInspectorLabel | null | undefined }) {
  const { t } = useLocalization();
  const controller = useActivityLabels();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const blockKey = label?.block.key ?? null;

  useEffect(() => {
    setError(false);
  }, [blockKey]);

  if (!label || !controller?.editingEnabled) return null;
  const hidden = label.block.resolution.kind === "user" && label.display === null;
  if (!label.display && !hidden) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      for (const block of label.members ?? [label.block]) {
        if (hidden) await controller.resetUserLabel(block);
        else await controller.saveUserLabel(block, "", "");
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="week-activity-inspector__action activity-label-visibility"
        onClick={() => { void toggle(); }}
        disabled={busy}
        aria-busy={busy}
      >
        <span className="week-activity-inspector__action-icon">{hidden ? <ShowIcon /> : <HideIcon />}</span>
        <span><strong>{hidden ? t("activityLabels.show") : t("activityLabels.hide")}</strong></span>
        <span aria-hidden="true" />
      </button>
      {error ? <p className="activity-label-visibility__error" role="alert">{t("activityLabels.saveError")}</p> : null}
    </>
  );
}
