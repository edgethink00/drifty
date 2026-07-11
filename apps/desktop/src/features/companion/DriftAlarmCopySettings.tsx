import { useMemo, useState } from "react";
import {
  DriftAlarm,
  buildBreakReturnAlarmEvent,
  buildDriftAlarmEvent,
  type DriftAlarmEvent,
  type DriftAlarmFocusTarget,
} from "./DriftAlarm";
import { DriftAlarmSourceIcon } from "./DriftAlarmSourceIcon";
import { ExtremeNudgeToast, type ExtremeNudgeToastEvent } from "./ExtremeNudgeToast";
import { buildDefaultDriftAlarmCopy, buildDriftNotificationCopy, buildExtremeNudgeToastCopy, type DriftAlarmCopySettingsValue } from "./driftAlarmCopy";
import { DRIFT_ALARM_COPY_SECTIONS, selectCopySection, type DriftAlarmCopySectionKey } from "./driftAlarmCopySettingsSections";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";

type AlarmPreviewSectionKey = Extract<DriftAlarmCopySectionKey, "drift" | "breakReturn">;

const NOTIFICATION_PREVIEW = {
  place: "youtube.com",
  driftDurationLabel: "5 minutes",
  sourceAppName: "Google Chrome",
  sourceIconSrc: null,
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
  const { t } = useLocalization();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [activeSectionKey, setActiveSectionKey] = useState<DriftAlarmCopySectionKey>("drift");
  const [draftCopy, setDraftCopy] = useState(value);
  const activeSection = selectCopySection(activeSectionKey);
  const previewEvent = useMemo(
    () => activeSectionKey === "drift" || activeSectionKey === "breakReturn" ? buildPreviewEvent(activeSectionKey, draftCopy) : null,
    [activeSectionKey, draftCopy],
  );
  const notificationPreview = useMemo(() => buildDriftNotificationCopy(draftCopy, NOTIFICATION_PREVIEW), [draftCopy]);
  const extremeNudgePreview = useMemo(() => buildExtremeNudgePreviewEvent(draftCopy), [draftCopy]);

  const openEditor = () => {
    setDraftCopy(value);
    setIsEditorOpen(true);
  };

  const cancelEditor = () => {
    setDraftCopy(value);
    setIsEditorOpen(false);
  };

  const saveEditor = () => {
    onChange(draftCopy);
    setIsEditorOpen(false);
  };

  const updateField = (key: keyof DriftAlarmCopySettingsValue, nextValue: string) => {
    setDraftCopy((currentValue) => ({ ...currentValue, [key]: nextValue }));
  };

  return (
    <div className="settings-row settings-row--drift-copy" role="group" aria-label={t("settings.alarmCopy.label")}>
      <div>
        <div className="lbl">{t("settings.alarmCopy.label")}</div>
        <div className="desc">{t("settings.alarmCopy.description")}</div>
      </div>
      <div className="ctrl settings-row__actions">
        <button type="button" className="settings-btn" onClick={openEditor}>
          {t("settings.alarmCopy.edit")}
        </button>
      </div>
      {isEditorOpen ? (
        <div className="auth-modal__overlay drift-copy-modal__overlay" onClick={cancelEditor}>
          <section
            className="auth-modal drift-copy-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drift-copy-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="auth-modal__header drift-copy-modal__header">
              <div>
                <h2 id="drift-copy-modal-title">{t("settings.alarmCopy.edit")}</h2>
                <p>{localizedCopySectionDescription(activeSectionKey, t)}</p>
              </div>
              <button
                type="button"
                className="settings-btn auth-modal__close"
                onClick={cancelEditor}
                aria-label={t("settings.alarmCopy.close")}
                title={t("settings.alarmCopy.close")}
              >
                x
              </button>
            </div>
            <div className="drift-copy-modal__body">
              <div className="drift-copy-editor">
                <div className="drift-copy-modal__tabs" role="tablist" aria-label={t("settings.alarmCopy.sectionsAria")}>
                  {DRIFT_ALARM_COPY_SECTIONS.map((section) => (
                    <button
                      key={section.key}
                      type="button"
                      role="tab"
                      aria-selected={activeSectionKey === section.key}
                      className={`drift-copy-modal__tab${activeSectionKey === section.key ? " is-active" : ""}`}
                      onClick={() => setActiveSectionKey(section.key)}
                    >
                      {localizedCopySectionTitle(section.key, t)}
                    </button>
                  ))}
                </div>
                <section className="drift-copy-editor__group" aria-label={localizedCopySectionTitle(activeSectionKey, t)}>
                  <h4>{localizedCopySectionTitle(activeSectionKey, t)}</h4>
                  <div className="drift-copy-editor__fields">
                    {activeSection.fields.map((field) => (
                      <label className="drift-copy-field" key={field.key}>
                        <span>
                          <strong>{t("settings.alarmCopy.titleField")}</strong>
                          <small>{field.hint === "Plain text" ? t("settings.alarmCopy.plainText") : field.hint}</small>
                        </span>
                        <input
                          className="settings-input drift-copy-field__input"
                          value={draftCopy[field.key]}
                          onChange={(event) => updateField(field.key, event.target.value)}
                          aria-label={t("settings.alarmCopy.titleField")}
                        />
                      </label>
                    ))}
                  </div>
                </section>
                <div className="drift-copy-editor__actions">
                  <button type="button" className="settings-btn" onClick={() => setDraftCopy(buildDefaultDriftAlarmCopy())}>
                    {t("settings.alarmCopy.reset")}
                  </button>
                  <div className="drift-copy-editor__commit-actions">
                    <button type="button" className="settings-btn" onClick={cancelEditor}>
                      {t("settings.alarmCopy.cancel")}
                    </button>
                    <button type="button" className="settings-btn settings-btn--primary" onClick={saveEditor}>
                      {t("settings.alarmCopy.save")}
                    </button>
                  </div>
                </div>
              </div>
              <aside className="drift-copy-preview" role="complementary" aria-label={t("settings.alarmCopy.previewAria")}>
                {previewEvent ? (
                  <div className="drift-copy-preview__alarm">
                    <DriftAlarm event={previewEvent} onAction={ignorePreviewAction} isPreview />
                  </div>
                ) : null}
                {activeSectionKey === "notification" ? (
                  <div className="drift-copy-preview__notification">
                    <span className="drift-copy-preview__notification-kicker">{t("settings.alarmCopy.macosNotification")}</span>
                    <strong className="drift-copy-preview__notification-title">{notificationPreview.title}</strong>
                    <div className="drift-copy-preview__notification-source" aria-label={t("settings.alarmCopy.notificationSourceAria", { source: NOTIFICATION_PREVIEW.place })}>
                      <span className="src-tile src-tile--drift" aria-hidden="true">
                        <DriftAlarmSourceIcon
                          appName={NOTIFICATION_PREVIEW.sourceAppName}
                          iconSrc={NOTIFICATION_PREVIEW.sourceIconSrc}
                          siteDomain={NOTIFICATION_PREVIEW.place}
                        />
                      </span>
                      <span className="drift-copy-preview__notification-place">{NOTIFICATION_PREVIEW.place}</span>
                      <p>{notificationPreview.body}</p>
                    </div>
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

function localizedCopySectionTitle(key: DriftAlarmCopySectionKey, t: LocalizationController["t"]): string {
  switch (key) {
    case "drift": return t("settings.alarmCopy.drift");
    case "breakReturn": return t("settings.alarmCopy.breakReturn");
    case "notification": return t("settings.alarmCopy.notification");
    case "extremeNudge": return t("settings.alarmCopy.extremeNudge");
  }
}

function localizedCopySectionDescription(key: DriftAlarmCopySectionKey, t: LocalizationController["t"]): string {
  switch (key) {
    case "drift": return t("settings.alarmCopy.driftDescription");
    case "breakReturn": return t("settings.alarmCopy.breakReturnDescription");
    case "notification": return t("settings.alarmCopy.notificationDescription");
    case "extremeNudge": return t("settings.alarmCopy.extremeNudgeDescription");
  }
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
        sourceSiteDomain: "youtube.com",
        sourceAppName: "Google Chrome",
        sourceIconSrc: null,
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
