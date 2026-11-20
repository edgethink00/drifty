import { Toggle } from "../../components/Toggle";
import { useLocalization } from "../localization/LocalizationContext";
import { FeatureNewBadge } from "../discovery/FeatureNewBadge";
import { type PetModeCoat, type PetModeSize } from "../pet-mode/petModeData";
import { usePetOutingPreference } from "../pet-mode/petOutingPreference";
import { usePetPresenceMode } from "../pet-mode/petPresenceMode";
import { useProLooks } from "../pro-looks/useProLooksController";
import { PetSettings } from "./PetCoatPicker";
import "./PetSettingsSection.css";
import { PetSettingsPreview } from "./PetSettingsPreview";
import { AutomaticCloseSettingsRow } from "./AutomaticCloseSettingsRow";
import type { HostPlatform } from "../../lib/api/accessibilityClient";

type PetSettingsSectionProps = {
  readonly enabled: boolean;
  readonly coat: PetModeCoat;
  readonly size: PetModeSize;
  readonly automaticCloseEnabled: boolean;
  readonly driftAlertsEnabled: boolean;
  readonly onAutomaticCloseChange: (enabled: boolean) => void;
  readonly showNewBadge?: boolean;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onCoatChange: (coat: PetModeCoat) => void;
  readonly onSizeChange: (size: PetModeSize) => void;
  readonly onOpenAlerts: () => void;
  readonly hostPlatform?: HostPlatform;
};

export function PetSettingsSection({
  enabled, coat, size, automaticCloseEnabled, driftAlertsEnabled, onAutomaticCloseChange, showNewBadge = false,
  onEnabledChange, onCoatChange, onSizeChange, onOpenAlerts, hostPlatform,
}: PetSettingsSectionProps) {
  const { t } = useLocalization();
  const [allowOutings, setAllowOutings] = usePetOutingPreference();
  const [presenceMode] = usePetPresenceMode();
  const outingsUnused = enabled && presenceMode === "drift_only";
  // A locked coat being tried on dresses the preview too, not only the desktop pet.
  const looks = useProLooks();
  const shownCoat = looks?.preview?.kind === "coat" ? looks.preview.id : coat;

  return (
    <div className="settings-section settings-section--pet">
      <div className="settings-block">
        <h3 className="settings-block__title-with-badge">{t("settings.pet.title")}{showNewBadge ? <FeatureNewBadge /> : null}</h3>
        <PetSettingsPreview enabled={enabled} coat={shownCoat} size={size} />
        <PetSettings enabled={enabled} coat={coat} size={size}
          onEnabledChange={onEnabledChange} onCoatChange={onCoatChange} onSizeChange={onSizeChange} />
      </div>
      <div className="settings-block">
        <h3>{t("settings.pet.behavior")}</h3>
        <div data-setting-id="settings.pet.allowOutings" className={`settings-row${outingsUnused ? " settings-row--disabled" : ""}`}>
          <div>
            <div className="lbl">{t("settings.pet.allowOutings")}</div>
            <div className="desc" id="pet-outings-description">
              {t(outingsUnused ? "settings.pet.allowOutingsDriftOnlyDescription" : "settings.pet.allowOutingsDescription")}
            </div>
          </div>
          <div className="ctrl"><Toggle checked={allowOutings} onChange={setAllowOutings} disabled={outingsUnused}
            ariaLabel={t("settings.pet.allowOutings")} ariaDescribedBy="pet-outings-description" /></div>
        </div>
      </div>
      <div className="settings-block">
        <h3>{t("settings.pet.focusIntervention")}</h3>
        <AutomaticCloseSettingsRow
          checked={automaticCloseEnabled}
          prerequisiteMissing={!driftAlertsEnabled}
          onChange={onAutomaticCloseChange}
          petEnabled={enabled}
          hostPlatform={hostPlatform}
          toggleAriaLabel={t("settings.pet.toggleAutomaticClose")}
          availableDescription={t("settings.pet.closeSettingsDescription")}
          prerequisiteDescription={t("settings.pet.closePrerequisiteDescription")}
        >
          <button type="button" className="pet-settings-details-link" onClick={onOpenAlerts}>
            {t("settings.pet.openAlerts")} <span aria-hidden="true">→</span>
          </button>
        </AutomaticCloseSettingsRow>
      </div>
    </div>
  );
}
