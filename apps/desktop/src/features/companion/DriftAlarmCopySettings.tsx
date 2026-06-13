import { useMemo, useState } from "react";
import {
  DriftAlarm,
  buildBreakReturnAlarmEvent,
  buildDriftAlarmEvent,
  type DriftAlarmEvent,
  type DriftAlarmFocusTarget,
} from "./DriftAlarm";
import { ExtremeNudgeToast, type ExtremeNudgeToastEvent } from "./ExtremeNudgeToast";
import { buildDefaultDriftAlarmCopy, buildDriftNotificationCopy, buildExtremeNudgeToastCopy, type DriftAlarmCopySettingsValue } from "./driftAlarmCopy";
import { DRIFT_ALARM_COPY_SECTIONS, selectCopySection, type DriftAlarmCopySectionKey } from "./driftAlarmCopySettingsSections";

type AlarmPreviewSectionKey = Extract<DriftAlarmCopySectionKey, "drift" | "breakReturn">;

const NOTIFICATION_PREVIEW = {
  place: "youtube.com",
  driftDurationLabel: "5 minutes",
} as const;

const EXTREME_NUDGE_PREVIEW = {
  closedLabel: "youtube.com",
  focusLabel: "Xcode",
} as const;

const PREVIEW_FOCUS_TARGET: DriftAlarmFocusTarget = {
  targetId: "preview-xcode",
  label: "Xcode",
  detail: "Coding session",
  appName: "Xcode",
  bundleId: "com.apple.dt.Xcode",
  browserName: null, siteDomain: null, siteTitle: null, siteUrl: null, iconSrc: null,
};

const PREVIEW_GENERATED_AT = "2026-06-11T08:00:00.000Z";
const ignorePreviewAction = () => undefined;

export function DriftAlarmCopySettings({
  value,
  onChange,
}: {
  readonly value: DriftAlarmCopySettingsValue;
  readonly onChange: (value: DriftAlarmCopySettingsValue) => void;
}) {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [activeSectionKey, setActiveSectionKey] = useState<DriftAlarmCopySectionKey>("drift");
  const activeSection = selectCopySection(activeSectionKey);
  const previewEvent = useMemo(
    () => activeSectionKey === "drift" || activeSectionKey === "breakReturn" ? buildPreviewEvent(activeSectionKey, value) : null,
    [activeSectionKey, value],
  );
  const notificationPreview = useMemo(() => buildDriftNotificationCopy(value, NOTIFICATION_PREVIEW), [value]);
  const extremeNudgePreview = useMemo(() => buildExtremeNudgePreviewEvent(value), [value]);

  const updateField = (key: keyof DriftAlarmCopySettingsValue, nextValue: string) => {
    onChange({ ...value, [key]: nextValue });
  };

  return (
    <div className="settings-row settings-row--drift-copy" role="group" aria-label="Alarm copy">
      <div>
        <div className="lbl">Alarm copy</div>
        <div className="desc">Customize only the representative titles used by production drift alarms.</div>
      </div>
      <div className="ctrl settings-row__actions">
        <button type="button" className="settings-btn" onClick={() => setIsEditorOpen(true)}>
          Edit alarm copy
        </button>
      </div>
      {isEditorOpen ? (
        <div className="auth-modal__overlay drift-copy-modal__overlay" onClick={() => setIsEditorOpen(false)}>
          <section
            className="auth-modal drift-copy-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drift-copy-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="auth-modal__header drift-copy-modal__header">
              <div>
                <h2 id="drift-copy-modal-title">Edit alarm copy</h2>
                <p>{activeSection.description}</p>
              </div>
              <button
                type="button"
                className="settings-btn auth-modal__close"
                onClick={() => setIsEditorOpen(false)}
                aria-label="Close"
                title="Close"
              >
                x
              </button>
            </div>
            <div className="drift-copy-modal__body">
              <div className="drift-copy-editor">
                <div className="drift-copy-modal__tabs" role="tablist" aria-label="Alarm copy sections">
                  {DRIFT_ALARM_COPY_SECTIONS.map((section) => (
                    <button
                      key={section.key}
                      type="button"
                      role="tab"
                      aria-selected={activeSectionKey === section.key}
                      className={`drift-copy-modal__tab${activeSectionKey === section.key ? " is-active" : ""}`}
                      onClick={() => setActiveSectionKey(section.key)}
                    >
                      {section.title}
                    </button>
                  ))}
                </div>
                <section className="drift-copy-editor__group" aria-label={activeSection.title}>
                  <h4>{activeSection.title}</h4>
                  <div className="drift-copy-editor__fields">
                    {activeSection.fields.map((field) => (
                      <label className="drift-copy-field" key={field.key}>
                        <span>
                          <strong>{field.label}</strong>
                          <small>{field.hint}</small>
                        </span>
                        <input
                          className="settings-input drift-copy-field__input"
                          value={value[field.key]}
                          onChange={(event) => updateField(field.key, event.target.value)}
                          aria-label={field.label}
                        />
                      </label>
                    ))}
                  </div>
                </section>
                <div className="drift-copy-editor__actions">
                  <button type="button" className="settings-btn" onClick={() => onChange(buildDefaultDriftAlarmCopy())}>
                    Reset alarm copy
                  </button>
                </div>
              </div>
              <aside className="drift-copy-preview" role="complementary" aria-label="Alarm copy preview">
                {previewEvent ? (
                  <div className="drift-copy-preview__alarm">
                    <DriftAlarm event={previewEvent} onAction={ignorePreviewAction} isPreview />
                  </div>
                ) : null}
                {activeSectionKey === "notification" ? (
                  <div className="drift-copy-preview__notification">
                    <span>macOS notification</span>
                    <strong>{notificationPreview.title}</strong>
                    <p>{notificationPreview.body}</p>
                  </div>
                ) : null}
                {activeSectionKey === "extremeNudge" ? (
                  <div className="drift-copy-preview__extreme">
                    <ExtremeNudgeToast event={extremeNudgePreview} isPreview />
                  </div>
                ) : null}
              </aside>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function buildExtremeNudgePreviewEvent(copySettings: DriftAlarmCopySettingsValue): ExtremeNudgeToastEvent {
  const copy = buildExtremeNudgeToastCopy(copySettings, { closedLabel: EXTREME_NUDGE_PREVIEW.closedLabel });
  return {
    kind: "extremeNudgeToast",
    placement: "top-right",
    id: "drift-copy-preview-extreme-nudge",
    generatedAt: PREVIEW_GENERATED_AT,
    title: copy.title,
    closedLabel: EXTREME_NUDGE_PREVIEW.closedLabel,
    focusLabel: EXTREME_NUDGE_PREVIEW.focusLabel,
  };
}

function buildPreviewEvent(sectionKey: AlarmPreviewSectionKey, copySettings: DriftAlarmCopySettingsValue): DriftAlarmEvent {
  switch (sectionKey) {
    case "drift":
      return buildDriftAlarmEvent({
        id: "drift-copy-preview-drift",
        contextLabel: "youtube.com",
        driftDurationSeconds: 5 * 60,
        preservedFocusStrikeSeconds: 30 * 60,
        generatedAt: PREVIEW_GENERATED_AT,
        focusTargets: [PREVIEW_FOCUS_TARGET],
        copySettings,
      });
    case "breakReturn":
      return buildBreakReturnAlarmEvent({
        id: "drift-copy-preview-break-return",
        contextLabel: "youtube.com",
        driftDurationSeconds: 5 * 60,
        preservedFocusStrikeSeconds: 30 * 60,
        generatedAt: PREVIEW_GENERATED_AT,
        focusTargets: [PREVIEW_FOCUS_TARGET],
        copySettings,
        breakDurationMinutes: 15,
        pausedFromLabel: "youtube.com",
        nextFocusLabel: "Xcode",
      });
    default: {
      const exhaustive: never = sectionKey;
      return exhaustive;
    }
  }
}
