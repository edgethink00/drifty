import { useEffect, useId, useState } from "react";
import { Toggle } from "../../components/Toggle";
import type { HostPlatform } from "../../lib/api/accessibilityClient";
import { formatStartOfDayOptionLabel, localeForDisplayLanguage } from "../../lib/formatting";
import { QUIET_HOURS_MINUTE_OPTIONS, quietHoursMinuteToValue, quietHoursValueToMinute } from "../companion/quietHours";
import { useLocalization } from "../localization/LocalizationContext";
import { SettingsRowDescription } from "../settings/SettingsRowDescription";
import { SettingsSelect } from "../settings/SettingsSelect";
import { recordingSchedulePayload, updateCapturePolicy, useCapturePolicy } from "./capturePolicy";
import { useDockVisibility } from "./dockVisibility";
import { ALL_ISO_DAYS, isoWeekday, nextRecordingChange, recordingAllowedAt } from "./recordingSchedule";
import { ZOOM_LEVELS, appliedZoom, levelFits, setUiZoom, useUiZoom, useUiZoomLimit } from "./uiZoom";
import "./feedbackRequests.css";

/* ── Private windows (Privacy) ─────────────────────────────────────────── */

/** A title and one line: on leaves confirmed private windows out entirely. */
export function PrivateWindowSettingsRow() {
  const { t } = useLocalization();
  const { privateWindows } = useCapturePolicy();
  const descriptionId = useId();
  const skipping = privateWindows === "skip";
  return (
    <div data-setting-id="settings.privacy.privateWindows" className="settings-row">
      <div>
        <div className="lbl">{t("settings.privacy.privateWindowsToggle")}</div>
        <div className="desc" id={descriptionId}>
          {t(skipping ? "settings.privacy.privateWindowsDescription" : "settings.privacy.privateWindowsOffDescription")}
        </div>
      </div>
      <div className="ctrl">
        <Toggle
          checked={skipping}
          onChange={(enabled) => updateCapturePolicy({ privateWindows: enabled ? "skip" : "record" })}
          ariaLabel={t("settings.privacy.privateWindowsToggle")}
          ariaDescribedBy={descriptionId}
        />
      </div>
    </div>
  );
}

/* ── Recording hours (General) ─────────────────────────────────────────── */

function weekdayLabel(isoDay: number, locale: string, style: "narrow" | "short"): string {
  // 2026-10-19 is a Monday.
  return new Intl.DateTimeFormat(locale, { weekday: style }).format(new Date(2026, 9, 18 + isoDay));
}

/**
 * Two rows under "Start of the week": a switch, and once it is on, the days
 * and hours on one line. Whether recording is paused right now shows in the
 * account menu, not here.
 */
export function RecordingHoursSettingsRows() {
  const { effectiveLanguage, t } = useLocalization();
  const { recordingHours } = useCapturePolicy();
  const descriptionId = useId();
  const locale = localeForDisplayLanguage(effectiveLanguage);
  const options = QUIET_HOURS_MINUTE_OPTIONS.map((option) => ({ value: option.value, label: formatStartOfDayOptionLabel(option.minutes, locale) }));
  const update = (patch: Partial<typeof recordingHours>) => updateCapturePolicy({ recordingHours: { ...recordingHours, ...patch } });
  const toggleDay = (day: number) => update({
    days: recordingHours.days.includes(day) ? recordingHours.days.filter((value) => value !== day) : [...recordingHours.days, day].sort(),
  });
  const warning = recordingHours.days.length === 0
    ? t("settings.recordingHours.noDays")
    : recordingHours.startMinute === recordingHours.endMinute
      ? t("settings.recordingHours.sameTime")
      : null;
  return (
    <>
      <div data-setting-id="settings.recordingHours.enabled" className="settings-row">
        <div>
          <div className="lbl">{t("settings.recordingHours.enabled")}</div>
          <div className="desc" id={descriptionId}>{t("settings.recordingHours.description")}</div>
        </div>
        <div className="ctrl">
          <Toggle
            checked={recordingHours.enabled}
            onChange={(enabled) => update({ enabled })}
            ariaLabel={t("settings.recordingHours.enabled")}
            ariaDescribedBy={descriptionId}
          />
        </div>
      </div>
      {recordingHours.enabled ? (
        <div data-setting-id="settings.recordingHours.schedule" className="settings-row fr-schedule-row">
          <div>
            <div className="lbl">{t("settings.recordingHours.schedule")}</div>
            {warning ? <div className="desc fr-warning" role="alert">{warning}</div> : null}
          </div>
          <div className="ctrl fr-schedule">
            <div className="fr-day-chips" role="group" aria-label={t("settings.recordingHours.days")}>
              {ALL_ISO_DAYS.map((day) => {
                const on = recordingHours.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    className={"fr-day-chip" + (on ? " is-on" : "")}
                    aria-pressed={on}
                    aria-label={weekdayLabel(day, locale, "short")}
                    onClick={() => toggleDay(day)}
                  >
                    {weekdayLabel(day, locale, "narrow")}
                  </button>
                );
              })}
            </div>
            <div className="fr-time-range">
              <SettingsSelect
                ariaLabel={t("settings.recordingHours.start")}
                value={quietHoursMinuteToValue(recordingHours.startMinute)}
                options={options}
                onChange={(value) => update({ startMinute: quietHoursValueToMinute(value, recordingHours.startMinute) })}
              />
              <span className="fr-time-range__dash" aria-hidden="true">–</span>
              <SettingsSelect
                ariaLabel={t("settings.recordingHours.end")}
                value={quietHoursMinuteToValue(recordingHours.endMinute)}
                options={options}
                onChange={(value) => update({ endMinute: quietHoursValueToMinute(value, recordingHours.endMinute) })}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * Whether recording is paused for recording hours right now, and when it
 * resumes, for the account menu's tracker line.
 */
export function useRecordingHoursPause(): { readonly paused: boolean; readonly resumes: string | null } {
  const { effectiveLanguage, t } = useLocalization();
  const settings = useCapturePolicy();
  const now = useMinuteClock();
  const schedule = recordingSchedulePayload(settings);
  if (!schedule || recordingAllowedAt(schedule, now)) return { paused: false, resumes: null };
  const locale = localeForDisplayLanguage(effectiveLanguage);
  const change = nextRecordingChange(schedule, now);
  if (!change) return { paused: true, resumes: null };
  const time = formatStartOfDayOptionLabel(change.getHours() * 60 + change.getMinutes(), locale);
  return {
    paused: true,
    resumes: change.toDateString() === now.toDateString()
      ? t("sidebar.recordingHours.resumes", { time })
      : t("sidebar.recordingHours.resumesLater", { day: weekdayLabel(isoWeekday(change), locale, "short"), time }),
  };
}

/* ── Dock (Appearance, macOS) ──────────────────────────────────────────── */

/** On: the Dock tile shows only while the window is open. Off: always. */
export function DockVisibilitySettingsRow() {
  const { t } = useLocalization();
  const { mode, failed, choose } = useDockVisibility();
  const descriptionId = useId();
  if (mode === null) return null;
  return (
    <div data-setting-id="settings.appearance.dock" className="settings-row">
      <div>
        <div className="lbl">{t("settings.appearance.dockToggle")}</div>
        <SettingsRowDescription
          id={descriptionId}
          description={t("settings.appearance.dockToggleDescription")}
          notice={failed ? t("settings.appearance.dockFailed") : null}
        />
      </div>
      <div className="ctrl">
        <Toggle
          checked={mode === "while-open"}
          onChange={(enabled) => choose(enabled ? "while-open" : "always")}
          ariaLabel={t("settings.appearance.dockToggle")}
          ariaDescribedBy={descriptionId}
        />
      </div>
    </div>
  );
}

/* ── Window size (Appearance) ──────────────────────────────────────────── */

const STEP_LABEL_KEYS = ["settings.appearance.zoomDefault", "settings.appearance.zoomLarge", "settings.appearance.zoomLarger", "settings.appearance.zoomLargest"] as const;

export function UiZoomSettingsRow({ hostPlatform }: { readonly hostPlatform: HostPlatform }) {
  const { effectiveLanguage, t } = useLocalization();
  const saved = useUiZoom();
  const limit = useUiZoomLimit();
  const inUse = appliedZoom(saved, limit);
  const description = t(hostPlatform === "windows" ? "settings.appearance.zoomDescriptionWindows" : "settings.appearance.zoomDescription");
  const fitting = ZOOM_LEVELS.filter((level) => levelFits(level, limit));
  const limitNote = fitting.length < ZOOM_LEVELS.length
    ? t("settings.appearance.zoomLimited", { level: t(STEP_LABEL_KEYS[fitting.length - 1]!) })
    : null;
  const glyph = effectiveLanguage === "ko" ? "가" : effectiveLanguage === "ja" ? "あ" : effectiveLanguage === "zh-Hans" ? "字" : "A";
  return (
    <div data-setting-id="settings.appearance.zoom" className="settings-row fr-zoom-row">
      <div>
        <div className="lbl">{t("settings.appearance.zoom")}</div>
        <div className="desc">{description}</div>
        {limitNote ? <div className="desc fr-zoom-limit">{limitNote}</div> : null}
      </div>
      <div className="ctrl">
        <div className="seg fr-zoom-steps" role="radiogroup" aria-label={t("settings.appearance.zoom")}>
          {ZOOM_LEVELS.map((level, index) => {
            const on = Math.abs(level - inUse) < 0.005;
            const fits = levelFits(level, limit);
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!fits}
                className={on ? "on" : undefined}
                onClick={() => setUiZoom(level)}
                title={fits ? `${Math.round(level * 100)}%` : t("settings.appearance.zoomTooLarge")}
              >
                <span className="fr-zoom-steps__glyph" style={{ fontSize: `${0.6875 + index * 0.125}rem` }} aria-hidden="true">{glyph}</span>
                <span className="fr-zoom-steps__label">{t(STEP_LABEL_KEYS[index]!)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
