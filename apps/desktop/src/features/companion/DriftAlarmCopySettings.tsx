import { useMemo, useState } from "react";
import {
  buildBreakReturnAlarmEvent,
  buildDriftAlarmEvent,
  type DriftAlarmEvent,
  type DriftAlarmFocusTarget,
} from "./driftAlarmEvent";
import { CompanionAutomaticCloseCard, CompanionDriftAlarmCard } from "./CompanionDriftAlarmCard";
import type { ExtremeNudgeToastEvent } from "./ExtremeNudgeToast";
import { buildDefaultDriftAlarmCopy, buildDriftNotificationCopy, buildExtremeNudgeToastCopy, type DriftAlarmCopySettingsValue } from "./driftAlarmCopy";
import { DRIFT_ALARM_COPY_SECTIONS, selectCopySection, type DriftAlarmCopySectionKey } from "./driftAlarmCopySettingsSections";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { ModalPresence } from "../../components/ModalPresence";
import driftyIcon from "../../assets/drifty-icon.png";

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
    <div data-setting-id="settings.alarmCopy.label" className="settings-row settings-row--drift-copy" role="group" aria-label={t("settings.alarmCopy.label")}>
      <div>
        <div className="lbl">{t("settings.alarmCopy.label")}</div>
        <div className="desc">{t("settings.alarmCopy.description")}</div>
      </div>
      <div className="ctrl settings-row__actions">
        <button type="button" className="settings-btn" onClick={openEditor}>
          {t("settings.alarmCopy.edit")}
        </button>
      </div>
      <ModalPresence onDismiss={cancelEditor}>
        {isEditorOpen ? (
        <div className="auth-modal__overlay drift-copy-modal__overlay" onClick={cancelEditor}>
          <section
            className="auth-modal modal-shell drift-copy-modal"
            data-modal-variant="workspace"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drift-copy-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <ModalCloseButton label={t("settings.alarmCopy.close")} onClick={cancelEditor} />
            <div className="modal-head drift-copy-modal__header">
              <div className="modal-head__copy">
                <h2 id="drift-copy-modal-title">{t("settings.alarmCopy.edit")}</h2>
                <p>{localizedCopySectionDescription(activeSectionKey, t)}</p>
              </div>
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
                  <button type="button" className="modal-btn modal-btn--secondary" onClick={() => setDraftCopy(buildDefaultDriftAlarmCopy())}>
                    {t("settings.alarmCopy.reset")}
                  </button>
                  <div className="drift-copy-editor__commit-actions">
                    <button type="button" className="modal-btn modal-btn--ghost" onClick={cancelEditor}>
                      {t("settings.alarmCopy.cancel")}
                    </button>
                    <button type="button" className="modal-btn modal-btn--primary" onClick={saveEditor}>
                      {t("settings.alarmCopy.save")}
                    </button>
                  </div>
                </div>
              </div>
              <aside className="drift-copy-preview" role="complementary" aria-label={t("settings.alarmCopy.previewAria")}>
                {previewEvent ? (
                  <div className="drift-copy-preview__alarm">
                    <CompanionDriftAlarmCard
                      event={previewEvent}
                      isPreview
                      onAction={ignorePreviewAction}
                      onDismiss={ignorePreviewAction}
                      onOpenDashboard={ignorePreviewAction}
                    />
                  </div>
                ) : null}
                {activeSectionKey === "notification" ? (
                  <div className="drift-copy-preview__notification">
                    <div className="drift-copy-preview__notification-app">
                      <img src={driftyIcon} alt="" aria-hidden="true" />
                      <span>{t("settings.alarmCopy.notificationAppName")}</span>
                      <time>{t("settings.alarmCopy.notificationTime")}</time>
                    </div>
                    <strong className="drift-copy-preview__notification-title">{notificationPreview.title}</strong>
                    <p className="drift-copy-preview__notification-body">{notificationPreview.body}</p>
                  </div>
                ) : null}
                {activeSectionKey === "extremeNudge" ? (
                  <div className="drift-copy-preview__alarm">
                    <CompanionAutomaticCloseCard
                      event={extremeNudgePreview}
                      isPreview
                      onAction={ignorePreviewAction}
                      onDismiss={ignorePreviewAction}
                      onOpenDashboard={ignorePreviewAction}
                    />
                  </div>
                ) : null}
              </aside>
            </div>
          </section>
        </div>
        ) : null}
      </ModalPresence>
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
