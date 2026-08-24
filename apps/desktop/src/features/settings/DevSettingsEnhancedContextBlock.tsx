import { Toggle } from "../../components/Toggle";
import {
  ENHANCED_CONTEXT_DOGFOOD_SOURCE_FAMILIES,
  ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS,
  type EnhancedContextSettings,
  type EnhancedContextSourceFamily,
} from "./settingsStorage";

type DevSettingsEnhancedContextBlockProps = {
  readonly settings: EnhancedContextSettings;
  readonly onDebugLoggingChange: (enabled: boolean) => void;
  readonly onSourceFamilyChange: (family: EnhancedContextSourceFamily, enabled: boolean) => void;
};

export function DevSettingsEnhancedContextBlock({
  settings,
  onDebugLoggingChange,
  onSourceFamilyChange,
}: DevSettingsEnhancedContextBlockProps) {
  return (
    <>
      <div className="settings-row">
        <div>
          <div className="lbl">Production classification context</div>
          <div className="desc">Approved metadata is on by default, including normalized AI conversation titles, developer workspaces, and document names. It can add one bounded retry when the first AI classification lacks enough context; prompts, commands, message bodies, and raw page text remain blocked.</div>
        </div>
        <div className="ctrl ctrl--value">On</div>
      </div>
      <div className="settings-row">
        <div>
          <div className="lbl">Enhanced context debug logging</div>
          <div className="desc">Dogfood only. Record local counts, reasons, and statuses for capture, egress, retry, and blocked surfaces. Context values are not written to the debug export.</div>
        </div>
        <div className="ctrl">
          <Toggle checked={settings.debugLogging} onChange={onDebugLoggingChange} ariaLabel="Enhanced context debug logging" />
        </div>
      </div>
      {ENHANCED_CONTEXT_DOGFOOD_SOURCE_FAMILIES.map((family) => {
        const option = ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS.find((candidate) => candidate.family === family);
        if (!option) return null;
        return (
          <div className="settings-row" key={family}>
            <div>
              <div className="lbl">{option.label}</div>
              <div className="desc">Dogfood only. {option.description}</div>
            </div>
            <div className="ctrl">
              <Toggle
                checked={settings.sourceFamilies[family]}
                onChange={(enabled) => onSourceFamilyChange(family, enabled)}
                ariaLabel={option.label}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}
