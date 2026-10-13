import { useEffect, useRef } from "react";

import {
  MAIN_ACTIVITY_OPTIONS,
  MAX_MAIN_ACTIVITY_SELECTIONS,
  MAX_WORK_DESCRIPTION_LENGTH,
} from "../onboarding/constants";
import type { WorkProfileSettings } from "../onboarding/onboardingState";
import { onboardingActivityLabel } from "../onboarding/onboardingOptionLabels";
import { useLocalization } from "../localization/LocalizationContext";
import { ActionLabel } from "../../components/ActionLabel";
import { AiFieldMark } from "../../components/AiIcons";

const SUGGESTED_ACTIVITIES = MAIN_ACTIVITY_OPTIONS.filter((activity) => activity !== "Other");
const SUGGESTED_ACTIVITY_SET = new Set<string>(SUGGESTED_ACTIVITIES);
const WORK_DESCRIPTION_COUNT_REVEAL_THRESHOLD = 200;

type AiSetupWorkProfileSectionProps = {
  readonly workProfileDraft: WorkProfileSettings;
  readonly workProfileMessage: string | null;
  readonly workProfileSaving: boolean;
  /** False while the draft still matches the saved profile. */
  readonly canSave: boolean;
  /** Increments each time the editor opens; moves focus to the first choice. */
  readonly focusRequest: number;
  readonly onSaveWorkProfile: () => void | Promise<void>;
  readonly onCancel: () => void;
  readonly onWorkProfileDraftChange: (value: WorkProfileSettings) => void;
};

export function AiSetupWorkProfileSection({
  workProfileDraft,
  workProfileMessage,
  workProfileSaving,
  canSave,
  focusRequest,
  onSaveWorkProfile,
  onCancel,
  onWorkProfileDraftChange,
}: AiSetupWorkProfileSectionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const choicesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusRequest === 0) return;
    // The panel is still growing open here; scrolling to the clipped choice
    // would jump the page, and the user just clicked right above it.
    choicesRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [focusRequest]);
  const selectedActivities = workProfileDraft.workActivities;
  const hasMaximumWorkActivities = selectedActivities.length >= MAX_MAIN_ACTIVITY_SELECTIONS;
  const visibleActivities = [
    ...SUGGESTED_ACTIVITIES,
    ...selectedActivities.filter((activity) => !SUGGESTED_ACTIVITY_SET.has(activity)),
  ];

  const toggleWorkActivity = (activity: string) => {
    const selected = selectedActivities.includes(activity);
    if (!selected && hasMaximumWorkActivities) return;
    onWorkProfileDraftChange({
      ...workProfileDraft,
      workActivities: selected
        ? selectedActivities.filter((current) => current !== activity)
        : [...selectedActivities, activity],
      workActivityOther: activity === "Other" && selected ? "" : workProfileDraft.workActivityOther,
      workDomain: null,
      workDomainOther: "",
    });
  };

  return (
    <section
      className="ai-setup-personalization"
      aria-label={t("settings.ai.personalizationAria")}
      onKeyDown={(event) => {
        // Escape also ends an IME composition (Korean, Japanese); only a plain
        // Escape cancels the edit.
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.stopPropagation();
        onCancel();
      }}
    >
      <div className="ai-setup-work-profile-panel">
        <div className="ai-setup-work-profile-panel__editor">
          <div className="ai-setup-work-intro-row">
            <p className="ai-setup-work-intro" id="ai-setup-work-choices-help">
              {t("onboarding.job.intro")}
            </p>
            {selectedActivities.length > 0 ? (
              <span className="ai-setup-work-count">
                {t("onboarding.job.selectedCount", { count: selectedActivities.length })}
              </span>
            ) : null}
          </div>
          <div
            ref={choicesRef}
            className="ai-setup-work-choices"
            role="group"
            aria-label={t("settings.ai.workActivities")}
            aria-describedby="ai-setup-work-choices-help"
          >
            {visibleActivities.map((activity) => {
              const selected = selectedActivities.includes(activity);
              return (
                <button
                  type="button"
                  className={`ai-setup-work-choice${selected ? " ai-setup-work-choice--selected" : ""}`}
                  key={activity}
                  aria-pressed={selected}
                  disabled={!selected && hasMaximumWorkActivities}
                  onClick={() => toggleWorkActivity(activity)}
                >
                  <span>{onboardingActivityLabel(activity, effectiveLanguage)}</span>
                </button>
              );
            })}
          </div>
          <div className="ai-setup-work-description">
            <div className="ai-setup-work-description__label-row">
              <label className="ai-setup-work-description__label" htmlFor="ai-setup-work-description">
                <AiFieldMark />
                {t("onboarding.job.descriptionLabel")}
              </label>
              <span className="ai-setup-work-description__privacy" id="ai-setup-work-description-privacy">
                {t("onboarding.job.descriptionPrivacy")}
              </span>
            </div>
            <textarea
              id="ai-setup-work-description"
              className="settings-input"
              value={workProfileDraft.workDescription}
              placeholder={t("onboarding.job.descriptionPlaceholder")}
              maxLength={MAX_WORK_DESCRIPTION_LENGTH}
              rows={3}
              aria-describedby="ai-setup-work-description-privacy"
              onChange={(event) => onWorkProfileDraftChange({
                ...workProfileDraft,
                workDescription: event.target.value,
                workDomain: null,
                workDomainOther: "",
              })}
            />
            {workProfileDraft.workDescription.length > WORK_DESCRIPTION_COUNT_REVEAL_THRESHOLD ? (
              <div className="ai-setup-work-description__meta">
                <span>{workProfileDraft.workDescription.length} / {MAX_WORK_DESCRIPTION_LENGTH}</span>
              </div>
            ) : null}
          </div>
          <div className="ai-setup-personalization__footer">
            {workProfileMessage ? <p role="status">{workProfileMessage}</p> : null}
            <button
              type="button"
              className="settings-btn"
              disabled={workProfileSaving}
              onClick={onCancel}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              disabled={workProfileSaving || !canSave}
              aria-busy={workProfileSaving}
              onClick={() => void onSaveWorkProfile()}
            >
              <ActionLabel busy={workProfileSaving} busyLabel={t("settings.ai.savingWorkProfile")}>{t("common.save")}</ActionLabel>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
