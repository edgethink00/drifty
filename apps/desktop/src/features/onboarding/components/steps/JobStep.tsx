import type { CSSProperties, ChangeEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import { MAX_MAIN_ACTIVITY_SELECTIONS } from "../../constants";

export function JobStep({
  activityOpen,
  activityOptions,
  activityQuery,
  domainOpen,
  domainOptions,
  domainQuery,
  selectedActivities,
  showActivityCustom,
  showDomainCustom,
  onActivityFocus,
  onActivityInput,
  onActivityKeyDown,
  onAddActivity,
  onDomainFocus,
  onDomainInput,
  onDomainKeyDown,
  onRemoveActivity,
  onSelectDomain,
  activityDropdownStyle,
  activityInputRef,
  domainDropdownStyle,
  domainInputRef,
}: {
  readonly activityDropdownStyle?: CSSProperties;
  readonly activityInputRef: RefObject<HTMLInputElement>;
  readonly activityOpen: boolean;
  readonly activityOptions: readonly string[];
  readonly activityQuery: string;
  readonly domainDropdownStyle?: CSSProperties;
  readonly domainInputRef: RefObject<HTMLInputElement>;
  readonly domainOpen: boolean;
  readonly domainOptions: readonly string[];
  readonly domainQuery: string;
  readonly selectedActivities: readonly string[];
  readonly showActivityCustom: boolean;
  readonly showDomainCustom: boolean;
  readonly onActivityFocus: () => void;
  readonly onActivityInput: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onActivityKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly onAddActivity: (option: string) => void;
  readonly onDomainFocus: () => void;
  readonly onDomainInput: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onDomainKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly onRemoveActivity: (option: string) => void;
  readonly onSelectDomain: (option: string) => void;
}) {
  const activityQueryTrimmed = activityQuery.trim();
  const domainQueryTrimmed = domainQuery.trim();
  const activityPlaceholder = selectedActivities.length >= MAX_MAIN_ACTIVITY_SELECTIONS
    ? "Maximum 5 selected"
    : selectedActivities.length > 0
      ? "Add another…"
      : "Type to search or add your own…";

  return (
    <div className="dc-onb-job">
      <div className="dc-onb-field-group">
        <div className="dc-onb-field-head">
          <h2 className="dc-onb-field-label">What do you usually work on?</h2>
          <span className="dc-onb-count">{selectedActivities.length} / {MAX_MAIN_ACTIVITY_SELECTIONS}</span>
        </div>
        <div className="dc-onb-combobox" data-onb-combobox>
          {selectedActivities.length > 0 ? (
            <div className="dc-onb-tags" role="group" aria-label="Selected activities">
              {selectedActivities.map((activity) => (
                <button
                  type="button"
                  className="dc-onb-tag"
                  key={activity}
                  onClick={() => onRemoveActivity(activity)}
                  aria-label={`Remove ${activity}`}
                >
                  <span>{activity}</span>
                  <span aria-hidden="true">x</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="dc-onb-combobox__anchor">
            <input
              className="dc-onb-input"
              value={activityQuery}
              onChange={onActivityInput}
              onFocus={onActivityFocus}
              onKeyDown={onActivityKeyDown}
              placeholder={activityPlaceholder}
              disabled={selectedActivities.length >= MAX_MAIN_ACTIVITY_SELECTIONS}
              aria-label="Search activities"
              ref={activityInputRef}
            />
            {activityOpen ? (
              <DropdownList style={activityDropdownStyle}>
                {activityOptions.map((option) => (
                  <DropdownOption key={option} onClick={() => onAddActivity(option)}>
                    {option}
                  </DropdownOption>
                ))}
                {showActivityCustom ? (
                  <DropdownOption onClick={() => onAddActivity(activityQueryTrimmed)}>
                    <span className="dc-onb-add-icon" aria-hidden="true">+</span>
                    Add "{activityQueryTrimmed}"
                  </DropdownOption>
                ) : null}
                {activityOptions.length === 0 && !showActivityCustom ? (
                  <div className="dc-onb-dropdown-empty">No matches — keep typing to add your own.</div>
                ) : null}
              </DropdownList>
            ) : null}
          </div>
        </div>
      </div>

      <div className="dc-onb-field-group">
        <h2 className="dc-onb-field-label">What field are you in?</h2>
        <div className="dc-onb-combobox__anchor" data-onb-combobox>
          <input
            className="dc-onb-input"
            value={domainQuery}
            onChange={onDomainInput}
            onFocus={onDomainFocus}
            onKeyDown={onDomainKeyDown}
            placeholder="Type to search or add your own…"
            aria-label="Your field"
            ref={domainInputRef}
          />
          {domainOpen ? (
            <DropdownList style={domainDropdownStyle}>
              {domainOptions.map((option) => (
                <DropdownOption key={option} onClick={() => onSelectDomain(option)}>
                  {option}
                </DropdownOption>
              ))}
              {showDomainCustom ? (
                <DropdownOption onClick={() => onSelectDomain(domainQueryTrimmed)}>
                  <span className="dc-onb-add-icon" aria-hidden="true">+</span>
                  Add "{domainQueryTrimmed}"
                </DropdownOption>
              ) : null}
            </DropdownList>
          ) : null}
        </div>
      </div>

      <div className="dc-onb-job-hint">
        <InfoIcon />
        <p>
          Drifty's AI uses these as hints to <strong>auto-sort your time</strong> into the right categories — so your
          timeline reads like your real work, not a list of raw app names. You can edit or add more later.
        </p>
      </div>
    </div>
  );
}

function DropdownList({
  children,
  style,
}: {
  readonly children: ReactNode;
  readonly style?: CSSProperties;
}) {
  return <div className="dc-onb-dropdown" style={style}>{children}</div>;
}

function DropdownOption({
  children,
  onClick,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className="dc-onb-dropdown-option" onClick={onClick}>
      {children}
    </button>
  );
}

function InfoIcon() {
  return (
    <span className="dc-onb-job-hint__icon" aria-hidden="true">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 11v5M12 8.2v.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    </span>
  );
}
