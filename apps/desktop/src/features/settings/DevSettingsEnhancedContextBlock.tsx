import { Toggle } from "../../components/Toggle";
import {
  ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS,
  type EnhancedContextSettings,
  type EnhancedContextSourceFamily,
} from "./settingsStorage";

type DevSettingsEnhancedContextBlockProps = {
  readonly settings: EnhancedContextSettings;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onCaptureLocalChange: (enabled: boolean) => void;
  readonly onRetryLowConfidenceChange: (enabled: boolean) => void;
  readonly onDebugLoggingChange: (enabled: boolean) => void;
  readonly onSourceFamilyChange: (family: EnhancedContextSourceFamily, enabled: boolean) => void;
};

export function DevSettingsEnhancedContextBlock({
  settings,
  onEnabledChange,
  onCaptureLocalChange,
  onRetryLowConfidenceChange,
  onDebugLoggingChange,
  onSourceFamilyChange,
}: DevSettingsEnhancedContextBlockProps) {
  return (
    <div className="settings-block settings-block--dev-preview">
      <h3>Enhanced context (Dev)</h3>
      <div className="settings-row">
        <div>
          <div className="lbl">Enable enhanced context</div>
          <div className="desc">Master gate for Dev-only derived document and work context. Separate from current Content context title and YouTube metadata. Off by default.</div>
        </div>
        <div className="ctrl">
          <Toggle checked={settings.enabled} onChange={onEnabledChange} ariaLabel="Enable enhanced context" />
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="lbl">Capture enhanced context locally</div>
          <div className="desc">Allow enabled source families to store bounded metadata, headings, tags, and short safe hints on-device. No raw bodies or screenshots.</div>
        </div>
        <div className="ctrl">
          <Toggle checked={settings.captureLocal} onChange={onCaptureLocalChange} ariaLabel="Capture enhanced context locally" />
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="lbl">Use enhanced context for low-confidence AI retry</div>
          <div className="desc">Keep the first AI request unchanged, then permit one low-confidence retry only after deterministic policy filtering approves safe context.</div>
        </div>
        <div className="ctrl">
          <Toggle
            checked={settings.retryLowConfidence}
            onChange={onRetryLowConfidenceChange}
            ariaLabel="Use enhanced context for low-confidence AI retry"
          />
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="lbl">Enhanced context debug logging</div>
          <div className="desc">Record local counts, reasons, and statuses for capture, egress, retry, and blocked surfaces.</div>
        </div>
        <div className="ctrl">
          <Toggle checked={settings.debugLogging} onChange={onDebugLoggingChange} ariaLabel="Enhanced context debug logging" />
        </div>
      </div>
      {ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS.map((option) => (
        <div className="settings-row" key={option.family}>
          <div>
            <div className="lbl">{option.label}</div>
            <div className="desc">{option.description}</div>
          </div>
          <div className="ctrl">
            <Toggle
              checked={settings.sourceFamilies[option.family]}
              onChange={(enabled) => onSourceFamilyChange(option.family, enabled)}
              ariaLabel={`Enhanced context source: ${option.label}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
