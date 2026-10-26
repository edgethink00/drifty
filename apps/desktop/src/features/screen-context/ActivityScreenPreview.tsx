import { useEffect, useMemo, useState, type Ref } from "react";
import { localeForDisplayLanguage } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import type { ActivityEvidenceSelection } from "./activityEvidenceSelection";
import type { ScreenContextClient } from "./screenContextClient";
import { decodeScreenDetail } from "./screenContextWire";
import { useScreenEvidenceRows, type ScreenEvidenceSource } from "./useScreenEvidenceRows";

type Bound<T> = { readonly generation: number; readonly value: T };

function ExpandIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" />
  </svg>;
}

/** The saved screen of an activity, shown in its detail. Renders nothing when no screen was kept. */
export function ActivityScreenPreview({ client, selection, mode, buttonRef, onOpen }: {
  readonly client: ScreenContextClient;
  readonly selection: ActivityEvidenceSelection;
  readonly mode: "preview" | "button";
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly onOpen: (recordId: string | null) => void;
}) {
  const { t, effectiveLanguage } = useLocalization();
  const locale = localeForDisplayLanguage(effectiveLanguage);
  const source = useMemo<ScreenEvidenceSource>(() => ({ kind: "activity", selection }), [selection]);
  const rows = useScreenEvidenceRows(client, source);
  const middle = rows && rows.length > 0 ? rows[Math.floor((rows.length - 1) / 2)] : null;
  const middleId = middle?.id ?? null;
  const [frame, setFrame] = useState<Bound<string | null> | null>(null);
  useEffect(() => {
    setFrame(null);
    if (mode !== "preview" || !middleId) return;
    let alive = true;
    void client.consume("screen_context_read_evidence", { recordId: middleId, includeFrame: true }, decodeScreenDetail, (value, generation) => {
      if (alive) setFrame({ value: value?.frameUrl ?? null, generation });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [client, middleId, mode]);
  if (!rows || rows.length === 0 || !middle) return null;
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const meta = rows.length === 1
    ? t("screenRecording.preview.metaOne", { time: clock(rows[0].observedAtMs) })
    : t("screenRecording.preview.meta", { start: clock(rows[0].observedAtMs), end: clock(rows[rows.length - 1].observedAtMs), count: rows.length });
  if (mode === "button") {
    return <button ref={buttonRef} type="button" className="app-btn app-btn--secondary week-activity-inspector__evidence-entry screen-preview-entry" onClick={() => onOpen(null)}>
      <span>{t("screenRecording.preview.open")}</span><span className="screen-preview-entry__meta">{t("screenRecording.preview.count", { count: rows.length })}</span>
    </button>;
  }
  const image = frame && client.canDisplay(frame.generation) ? frame.value : null;
  return <button ref={buttonRef} type="button" className="screen-preview" onClick={() => onOpen(middle.id)} aria-label={`${t("screenRecording.preview.open")} · ${meta}`}>
    <span className="screen-preview__frame">
      {image ? <img src={image} alt="" /> : <span className="screen-preview__placeholder">{frame ? null : t("screenRecording.preview.loading")}</span>}
      <span className="screen-preview__expand" aria-hidden="true"><ExpandIcon /></span>
    </span>
    <span className="screen-preview__meta"><span className="screen-preview__label">{t("screenRecording.preview.label")}</span><span>{meta}</span></span>
  </button>;
}
