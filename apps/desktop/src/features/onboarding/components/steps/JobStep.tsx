import { MAIN_ACTIVITY_OPTIONS, MAX_MAIN_ACTIVITY_SELECTIONS, WORK_DOMAIN_OPTIONS } from "../../constants";
import { Dropdown } from "../Dropdown";

type JobStepProps = {
  readonly mainActivities: readonly string[];
  readonly mainActivityOther: string;
  readonly workDomain: string | null;
  readonly workDomainOther: string;
  readonly onAddMainActivity: (option: string) => void;
  readonly onMainActivityOtherChange: (value: string) => void;
  readonly onToggleMainActivity: (option: string) => void;
  readonly onWorkDomainChange: (value: string | null) => void;
  readonly onWorkDomainOtherChange: (value: string) => void;
};

export function JobStep({
  mainActivities,
  mainActivityOther,
  workDomain,
  workDomainOther,
  onAddMainActivity,
  onMainActivityOtherChange,
  onToggleMainActivity,
  onWorkDomainChange,
  onWorkDomainOtherChange,
}: JobStepProps) {
  return (
    <>
      <div className="onb-job__compact">
        <div className="onb-job__question">
          <div className="onb-job__field-head">
            <h2 className="onb-job__field-label">What do you usually work on?</h2>
            <span className="onb-job__count" aria-label={`${mainActivities.length} of ${MAX_MAIN_ACTIVITY_SELECTIONS} selected`}>
              {mainActivities.length} / {MAX_MAIN_ACTIVITY_SELECTIONS}
            </span>
          </div>
          <div className="onb-activity-picker">
            {mainActivities.length > 0 ? (
            <div className="onb-activity-tags" role="group" aria-label="Selected activities">
              {mainActivities.map((option) => (
                <button
                  type="button"
                  className="onb-activity-tag"
                  key={option}
                  onClick={() => onToggleMainActivity(option)}
                  aria-label={`Remove ${option}`}
                >
                  <span>{option}</span>
                  <span className="onb-activity-tag__remove" aria-hidden="true">x</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="onb-dropdown">
            <div className="onb-dropdown__trigger" role="combobox" aria-expanded="false" aria-label="Search activities">
              <select
                className="onb-dropdown__input"
                value=""
                disabled={mainActivities.length >= MAX_MAIN_ACTIVITY_SELECTIONS}
                onChange={(event) => onAddMainActivity(event.target.value)}
                aria-label="Search activities"
              >
                <option value="">
                  {mainActivities.length >= MAX_MAIN_ACTIVITY_SELECTIONS ? "Maximum 5 selected" : "Search activities..."}
                </option>
                {MAIN_ACTIVITY_OPTIONS.filter((option) => !mainActivities.includes(option)).map((option) => (
                  <option value={option} key={option}>
                    {option}
                  </option>
                ))}
              </select>
              <div className="onb-dropdown__icons">
                <svg className="onb-dropdown__chevron" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </div>
          {mainActivities.includes("Other") ? (
            <input
              className="onb-dropdown__other-input"
              type="text"
              placeholder="e.g. Coaching, recruiting, compliance"
              value={mainActivityOther}
              onChange={(event) => onMainActivityOtherChange(event.target.value)}
              aria-label="Enter your activity"
            />
          ) : null}
          </div>
        </div>
        <div className="onb-job__question">
          <h2 className="onb-job__field-label">What field are you in?</h2>
          <Dropdown
            options={WORK_DOMAIN_OPTIONS}
            value={workDomain}
            onChange={onWorkDomainChange}
            placeholder="Search field..."
            otherText={workDomainOther}
            onOtherTextChange={onWorkDomainOtherChange}
            searchable
            ariaLabel="Your field"
          />
        </div>
        <div className="onb-job__hint">
          <span className="onb-job__hint-icon" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12 11v5M12 8.2v.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </span>
          <p className="onb-job__hint-text">
            Drifty's AI uses these as hints to <strong>auto-sort your time</strong> into the right categories — so your
            timeline reads like your real work, not a list of raw app names. You can edit or add more later.
          </p>
        </div>
      </div>
    </>
  );
}
