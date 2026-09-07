import { MAX_MAIN_ACTIVITY_SELECTIONS, MAX_WORK_DESCRIPTION_LENGTH, type MainActivity } from "../../constants";
import { useLocalization } from "../../../localization/LocalizationContext";
import { onboardingActivityLabel } from "../../onboardingOptionLabels";
import { AiSparkIcon } from "../../../../components/AiSparkIcon";

const SUGGESTED_ACTIVITIES: readonly MainActivity[] = [
  "Coding",
  "Product & Planning",
  "Designing",
  "Writing & Content",
  "Research & Learning",
  "Data Analysis",
  "Marketing & Sales",
  "Customer Support",
  "Meetings & Communication",
  "Operations",
];
const SUGGESTED_ACTIVITY_SET = new Set<string>(SUGGESTED_ACTIVITIES);
const WORK_DESCRIPTION_COUNT_REVEAL_THRESHOLD = 200;

export function JobStep({
  selectedActivities,
  workDescription,
  onToggleActivity,
  onWorkDescriptionChange,
}: {
  readonly selectedActivities: readonly string[];
  readonly workDescription: string;
  readonly onToggleActivity: (option: string) => void;
  readonly onWorkDescriptionChange: (value: string) => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const hasMaximumActivities = selectedActivities.length >= MAX_MAIN_ACTIVITY_SELECTIONS;
  const visibleActivities = [
    ...SUGGESTED_ACTIVITIES,
    ...selectedActivities.filter((activity) => !SUGGESTED_ACTIVITY_SET.has(activity)),
  ];

  return (
    <div className="dc-onb-job">
      <div className="dc-onb-job-intro-row">
        <p className="dc-onb-job-intro" id="onboarding-work-choices-help">
          {t("onboarding.job.intro")}
        </p>
        {selectedActivities.length > 0 ? (
          <span className="dc-onb-count">
            {t("onboarding.job.selectedCount", { count: selectedActivities.length })}
          </span>
        ) : null}
      </div>

      <div
        className="dc-onb-choices"
        role="group"
        aria-label={t("onboarding.job.activityLabel")}
        aria-describedby="onboarding-work-choices-help"
      >
        {visibleActivities.map((activity) => {
          const selected = selectedActivities.includes(activity);
          return (
            <button
              type="button"
              className={`dc-onb-choice${selected ? " dc-onb-choice--selected" : ""}`}
              key={activity}
              aria-pressed={selected}
              disabled={!selected && hasMaximumActivities}
              onClick={() => onToggleActivity(activity)}
            >
              <span>{onboardingActivityLabel(activity, effectiveLanguage)}</span>
            </button>
          );
        })}
      </div>

      <div className="dc-onb-natural-language">
        <div className="dc-onb-natural-language__label-row">
          <label className="dc-onb-field-label" id="onboarding-work-description-label" htmlFor="onboarding-work-description">
            <span className="dc-onb-natural-language__icon" aria-hidden="true">
              <AiSparkIcon />
            </span>
            {t("onboarding.job.descriptionLabel")}
          </label>
          <span className="dc-onb-natural-language__privacy" id="onboarding-work-description-privacy">
            {t("onboarding.job.descriptionPrivacy")}
          </span>
        </div>

        <textarea
          id="onboarding-work-description"
          className="dc-onb-input dc-onb-textarea"
          value={workDescription}
          onChange={(event) => onWorkDescriptionChange(event.target.value)}
          placeholder={t("onboarding.job.descriptionPlaceholder")}
          maxLength={MAX_WORK_DESCRIPTION_LENGTH}
          rows={3}
          aria-describedby="onboarding-work-description-privacy"
        />
        {workDescription.length > WORK_DESCRIPTION_COUNT_REVEAL_THRESHOLD ? (
          <div className="dc-onb-natural-language__meta">
            <span className="dc-onb-count" id="onboarding-work-description-count">
              {workDescription.length} / {MAX_WORK_DESCRIPTION_LENGTH}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
