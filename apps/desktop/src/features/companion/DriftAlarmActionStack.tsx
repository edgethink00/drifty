import { FlagIcon, SettingsIcon } from "./DriftAlarmIcons";
import type { DriftAlarmAction } from "./driftAlarmEvent";

const UPDATE_SETTINGS_LABEL = "Update settings";

export function DriftAlarmActionStack({
  manualCorrectionLabel,
  selectedActionId,
  onSelectAction,
}: {
  manualCorrectionLabel: string;
  selectedActionId: string | null;
  onSelectAction: (actionId: string, action: DriftAlarmAction) => void;
}) {
  return (
    <div className="da__action-stack" aria-label="Drift alarm actions">
      <button className={`da__correct${selectedActionId === "manual_correction" ? " is-selected" : ""}`} type="button" onClick={() => onSelectAction("manual_correction", { type: "manual_correction" })}>
        <FlagIcon />
        {manualCorrectionLabel}
      </button>
      <button className={`da__settings-action${selectedActionId === "settings" ? " is-selected" : ""}`} type="button" onClick={() => onSelectAction("settings", { type: "settings" })}>
        <SettingsIcon />
        {UPDATE_SETTINGS_LABEL}
      </button>
    </div>
  );
}
