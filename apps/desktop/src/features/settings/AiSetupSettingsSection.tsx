import { AiSetupPanel, type AiSetupPanelProps } from "./AiSetupPanel";

export type AiSetupSettingsSectionProps = AiSetupPanelProps;

export function AiSetupSettingsSection(props: AiSetupSettingsSectionProps) {
  return (
    <div className="settings-section settings-section--ai-setup">
      <AiSetupPanel {...props} />
    </div>
  );
}
