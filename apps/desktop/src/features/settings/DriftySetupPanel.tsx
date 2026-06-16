import { CloudSetupPanel, type CloudSetupPanelProps } from "./CloudSetupPanel";
import { ManagedLocalAiPanel, type ManagedLocalAiPanelProps } from "./ManagedLocalAiPanel";

export type DriftyRoute = "cloud" | "local";

type DriftySetupPanelProps = CloudSetupPanelProps & ManagedLocalAiPanelProps & {
  readonly selectedRoute: DriftyRoute;
};

export function DriftySetupPanel({
  catalog,
  localAiSetup,
  selectedRoute,
  onLocalAiSetupChange,
  ...panelProps
}: DriftySetupPanelProps) {
  return (
    <div className="ai-setup-detail ai-setup-detail--drifty" role="group" aria-label="Drifty settings">
      <section className={`ai-setup-route-option${selectedRoute === "cloud" ? " is-selected" : ""}`} aria-label="Drifty Cloud option">
        <CloudSetupPanel {...panelProps} />
      </section>

      <div className="ai-setup-local-divider"><span>or use local model</span></div>

      <section className={`ai-setup-route-option ai-setup-route-option--local${selectedRoute === "local" ? " is-selected" : ""}`} aria-label="Managed local model option">
        <ManagedLocalAiPanel {...panelProps} catalog={catalog} localAiSetup={localAiSetup} onLocalAiSetupChange={onLocalAiSetupChange} />
      </section>
    </div>
  );
}
