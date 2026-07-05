import { ToggleButton } from "./shared";

export function NudgesStep({
  driftAlarmEnabled,
  extremeNudgeEnabled,
  onDriftToggle,
  onExtremeToggle,
}: {
  readonly driftAlarmEnabled: boolean;
  readonly extremeNudgeEnabled: boolean;
  readonly onDriftToggle: () => void;
  readonly onExtremeToggle: () => void;
}) {
  return (
    <>
      <p className="dc-onb-copy">
        Choose how firmly Drifty pulls you back when you drift. You can change this any time.
      </p>
      <ul className="dc-onb-row-list">
        <li className="dc-onb-row">
          <div className="dc-onb-row__copy">
            <span className="dc-onb-row__title">Drift alarm</span>
            <span className="dc-onb-row__desc">A gentle alert after you've drifted for a while.</span>
          </div>
          <ToggleButton label="Drift alarm" on={driftAlarmEnabled} onClick={onDriftToggle} />
        </li>
        <li className={`dc-onb-row${extremeNudgeEnabled ? " dc-onb-row--extreme-on" : ""}`}>
          <div className="dc-onb-row__copy">
            <span className="dc-onb-row__title dc-onb-row__title--with-badge">
              Extreme nudge <span className="dc-onb-beta">Beta</span>
            </span>
            <span className="dc-onb-row__desc">Closes the distracting tab or app when repeated drift is detected.</span>
          </div>
          <ToggleButton label="Extreme nudge" on={extremeNudgeEnabled} tone="extreme" onClick={onExtremeToggle} />
        </li>
      </ul>
    </>
  );
}
