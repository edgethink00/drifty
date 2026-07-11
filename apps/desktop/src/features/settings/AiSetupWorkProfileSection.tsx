import {
  MAIN_ACTIVITY_OPTIONS,
  MAX_MAIN_ACTIVITY_SELECTIONS,
  WORK_DOMAIN_OPTIONS,
} from "../onboarding/constants";
import { Dropdown } from "../onboarding/components/Dropdown";
import type { WorkProfileSettings } from "../onboarding/onboardingState";
import { onboardingActivityLabel, onboardingDomainLabel } from "../onboarding/onboardingOptionLabels";
import { useLocalization } from "../localization/LocalizationContext";

type AiSetupWorkProfileSectionProps = {
  readonly workProfileDraft: WorkProfileSettings;
  readonly workProfileMessage: string | null;
  readonly onSaveWorkProfile: () => void;
  readonly onWorkProfileDraftChange: (value: WorkProfileSettings) => void;
};

export function AiSetupWorkProfileSection({
  workProfileDraft,
  workProfileMessage,
  onSaveWorkProfile,
  onWorkProfileDraftChange,
}: AiSetupWorkProfileSectionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const setWorkDomain = (workDomain: string | null) => {
    onWorkProfileDraftChange({
      ...workProfileDraft,
      workDomain,
      workDomainOther: workDomain === "Other" ? workProfileDraft.workDomainOther : "",
    });
  };
  const addWorkActivity = (activity: string) => {
    if (!activity || workProfileDraft.workActivities.includes(activity)) return;
    if (workProfileDraft.workActivities.length >= MAX_MAIN_ACTIVITY_SELECTIONS) return;
    onWorkProfileDraftChange({
      ...workProfileDraft,
      workActivities: [...workProfileDraft.workActivities, activity],
    });
  };
  const removeWorkActivity = (activity: string) => {
    onWorkProfileDraftChange({
      ...workProfileDraft,
      workActivities: workProfileDraft.workActivities.filter((current) => current !== activity),
      workActivityOther: activity === "Other" ? "" : workProfileDraft.workActivityOther,
    });
  };
  const hasMaximumWorkActivities = workProfileDraft.workActivities.length >= MAX_MAIN_ACTIVITY_SELECTIONS;
  const availableWorkActivities = MAIN_ACTIVITY_OPTIONS.filter((activity) => !workProfileDraft.workActivities.includes(activity));

  return (
    <section className="ai-setup-personalization" aria-label={t("settings.ai.personalizationAria")}>
      <div className="ai-setup-work-profile-panel">
        <div className="ai-setup-work-profile-panel__editor">
          <div className="ai-setup-work-profile-selectors" aria-label={t("settings.ai.workProfileSelectorsAria")}>
            <div className="ai-setup-work-profile-selector">
              <span>{t("settings.ai.workActivities")}</span>
              {workProfileDraft.workActivities.length > 0 ? (
                <div className="ai-setup-activity-tags" role="group" aria-label={t("settings.ai.selectedWorkActivities")}>
                  {workProfileDraft.workActivities.map((activity) => (
                    <button
                      key={activity}
                      type="button"
                      className="ai-setup-activity-tag"
                      aria-label={t("settings.ai.removeWorkActivity", { activity: onboardingActivityLabel(activity, effectiveLanguage) })}
                      onClick={() => removeWorkActivity(activity)}
                    >
                      <span>{onboardingActivityLabel(activity, effectiveLanguage)}</span>
                      <span aria-hidden="true">x</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="ai-setup-activity-add">
                <Dropdown
                  ariaLabel={t("settings.ai.addWorkActivity")}
                  disabled={hasMaximumWorkActivities}
                  keepOpenForOther={false}
                  onChange={(activity) => {
                    if (activity) addWorkActivity(activity);
                  }}
                  options={availableWorkActivities}
                  getOptionLabel={(activity) => onboardingActivityLabel(activity, effectiveLanguage)}
                  placeholder={hasMaximumWorkActivities ? t("settings.ai.maximumActivities") : t("settings.ai.addActivity")}
                  searchable
                  value={null}
                />
              </div>
              {workProfileDraft.workActivities.includes("Other") ? (
                <input
                  className="settings-input ai-setup-activity-other"
                  aria-label={t("settings.ai.otherWorkActivity")}
                  value={workProfileDraft.workActivityOther}
                  placeholder={t("settings.ai.otherWorkActivityPlaceholder")}
                  onChange={(event) => onWorkProfileDraftChange({
                    ...workProfileDraft,
                    workActivityOther: event.target.value,
                  })}
                />
              ) : null}
            </div>
            <div className="ai-setup-work-profile-selector">
              <span>{t("onboarding.job.yourField")}</span>
              <Dropdown
                ariaLabel={t("onboarding.job.yourField")}
                onChange={setWorkDomain}
                onOtherTextChange={(workDomainOther) => onWorkProfileDraftChange({ ...workProfileDraft, workDomainOther })}
                options={WORK_DOMAIN_OPTIONS}
                getOptionLabel={(domain) => onboardingDomainLabel(domain, effectiveLanguage)}
                otherText={workProfileDraft.workDomainOther}
                placeholder={t("settings.ai.workFieldPlaceholder")}
                searchable
                value={workProfileDraft.workDomain}
              />
            </div>
          </div>
          <div className="ai-setup-personalization__footer">
            {workProfileMessage ? <p role="status">{workProfileMessage}</p> : null}
            <button type="button" className="settings-btn" onClick={onSaveWorkProfile}>{t("settings.ai.saveWorkProfile")}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
