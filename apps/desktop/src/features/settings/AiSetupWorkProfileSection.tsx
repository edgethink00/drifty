import {
  MAIN_ACTIVITY_OPTIONS,
  MAX_MAIN_ACTIVITY_SELECTIONS,
  WORK_DOMAIN_OPTIONS,
} from "../onboarding/constants";
import { Dropdown } from "../onboarding/components/Dropdown";
import type { WorkProfileSettings } from "../onboarding/onboardingState";

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
    <section className="ai-setup-personalization" aria-label="AI classification personalization">
      <div className="ai-setup-work-profile-panel">
        <div className="ai-setup-work-profile-panel__editor">
          <div className="ai-setup-work-profile-selectors" aria-label="Work profile selectors">
            <div className="ai-setup-work-profile-selector">
              <span>Work activities</span>
              {workProfileDraft.workActivities.length > 0 ? (
                <div className="ai-setup-activity-tags" role="group" aria-label="Selected work activities">
                  {workProfileDraft.workActivities.map((activity) => (
                    <button
                      key={activity}
                      type="button"
                      className="ai-setup-activity-tag"
                      aria-label={`Remove ${activity}`}
                      onClick={() => removeWorkActivity(activity)}
                    >
                      <span>{activity}</span>
                      <span aria-hidden="true">x</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="ai-setup-activity-add">
                <Dropdown
                  ariaLabel="Add work activity"
                  disabled={hasMaximumWorkActivities}
                  keepOpenForOther={false}
                  onChange={(activity) => {
                    if (activity) addWorkActivity(activity);
                  }}
                  options={availableWorkActivities}
                  placeholder={hasMaximumWorkActivities ? "Maximum 5 selected" : "Add activity..."}
                  searchable
                  value={null}
                />
              </div>
              {workProfileDraft.workActivities.includes("Other") ? (
                <input
                  className="settings-input ai-setup-activity-other"
                  aria-label="Other work activity"
                  value={workProfileDraft.workActivityOther}
                  placeholder="e.g. Recruiting, coaching, compliance"
                  onChange={(event) => onWorkProfileDraftChange({
                    ...workProfileDraft,
                    workActivityOther: event.target.value,
                  })}
                />
              ) : null}
            </div>
            <div className="ai-setup-work-profile-selector">
              <span>Your field</span>
              <Dropdown
                ariaLabel="Your field"
                onChange={setWorkDomain}
                onOtherTextChange={(workDomainOther) => onWorkProfileDraftChange({ ...workProfileDraft, workDomainOther })}
                options={WORK_DOMAIN_OPTIONS}
                otherText={workProfileDraft.workDomainOther}
                placeholder="What field do you work in?"
                searchable
                value={workProfileDraft.workDomain}
              />
            </div>
          </div>
          <div className="ai-setup-personalization__footer">
            {workProfileMessage ? <p role="status">{workProfileMessage}</p> : null}
            <button type="button" className="settings-btn" onClick={onSaveWorkProfile}>Save work profile</button>
          </div>
        </div>
      </div>
    </section>
  );
}
