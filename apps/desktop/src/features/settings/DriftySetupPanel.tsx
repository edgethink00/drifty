import { CloudSetupPanel, type CloudSetupPanelProps } from "./CloudSetupPanel";
import { ManagedLocalAiPanel, type ManagedLocalAiPanelProps } from "./ManagedLocalAiPanel";
import { useLocalization } from "../localization/LocalizationContext";

export type DriftyRoute = "cloud" | "local";

type DriftySetupPanelProps = CloudSetupPanelProps & ManagedLocalAiPanelProps & {
  readonly selectedRoute: DriftyRoute;
};

export function DriftySetupPanel({
  catalog,
  localAiSetup,
  selectedRoute,
  ...panelProps
}: DriftySetupPanelProps) {
  const { t } = useLocalization();
  return (
    <div className="ai-setup-detail ai-setup-detail--drifty" role="group" aria-label={t("settings.ai.driftySettingsAria")}>
      <section className={`ai-setup-route-option ai-setup-route-option--cloud${selectedRoute === "cloud" ? " is-selected" : ""}`} aria-label={t("settings.ai.driftyCloudOptionAria")}>
        <p className="ai-setup-route-description">{t("settings.ai.driftyCloudDescription")}</p>
        <CloudSetupPanel {...panelProps} />
      </section>

      <div className="ai-setup-local-divider"><span>{t("settings.ai.orUseLocalModel")}</span></div>

      <section className={`ai-setup-route-option ai-setup-route-option--local${selectedRoute === "local" ? " is-selected" : ""}`} aria-label={t("settings.ai.managedLocalOptionAria")}>
        <ManagedLocalAiPanel {...panelProps} catalog={catalog} localAiSetup={localAiSetup} />
      </section>
    </div>
  );
}
