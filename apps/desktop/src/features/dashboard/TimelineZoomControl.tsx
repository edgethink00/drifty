import type { ReactNode } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import type { DisplayLanguage } from "../localization/languagePreference";
import { SettingsSelect } from "../settings/SettingsSelect";
import { TIMELINE_ZOOM_STEPS, type TimelineZoomState } from "./timelineZoom";
import "./timeline-zoom.css";

const TITLE: Record<DisplayLanguage, string> = {
  en: "Time zoom",
  ko: "시간 확대",
  es: "Escala de tiempo",
  ja: "時間の拡大率",
  "pt-BR": "Zoom da linha do tempo",
  "zh-Hans": "时间缩放",
  fr: "Zoom temporel",
  de: "Zeitskalierung",
};

const OPTIONS = TIMELINE_ZOOM_STEPS.map((step) => ({ value: String(step), label: step + "%" }));

/**
 * The time zoom in its own capsule. Its list is the app's own menu, the one the device menu in the
 * page head uses, so it looks the same in the Mac app and a browser (a native <select> opened the
 * system menu, 21 rows tall); the steps are TIMELINE_ZOOM_STEPS.
 */
export function TimelineZoomControl({ percent, onChange }: TimelineZoomState) {
  const { effectiveLanguage } = useLocalization();
  const title = TITLE[effectiveLanguage];
  return <div className="seg timeline-zoom" role="group" aria-label={title}>
    <SettingsSelect<string>
      ariaLabel={title}
      className="timeline-zoom__menu"
      value={String(percent)}
      options={OPTIONS}
      onChange={(value) => onChange(Number(value))}
      placement="below"
      menuSize="content"
    />
  </div>;
}

/**
 * The Day and Week chart heads' controls: the colour switch (children), then the time zoom at the
 * right edge, so the zoom stays put when the switch gains or loses its Project option.
 */
export function ChartHeadControls({ children, timeZoom }: {
  readonly children: ReactNode;
  readonly timeZoom?: TimelineZoomState | null;
}) {
  return (
    <div className="flow-chart-head__controls">
      {children}
      {timeZoom ? <TimelineZoomControl percent={timeZoom.percent} onChange={timeZoom.onChange} /> : null}
    </div>
  );
}
