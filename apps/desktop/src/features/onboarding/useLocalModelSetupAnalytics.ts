import { useEffect, useRef } from "react";
import type { ManagedLocalAiStatus } from "../settings/managedLocalAiClient";
import type { ManagedLocalAiModel } from "../settings/managedLocalAiCatalog";
import { capturePostHogEvent } from "../../lib/analytics/posthogClient";
import { anyModelInstallable, modelTier, recommendedModelFit } from "./localModelSetupAnalytics";
import { hasManagedLocalInstallStarted, isManagedLocalReady } from "./onboardingManagedLocalStatus";

/**
 * Reports what the local model step actually did. Advancing requires a started
 * download, so a catalog with no installable model leaves the user stuck with
 * every button disabled. Until now the step only reported that it was viewed,
 * which made that outcome indistinguishable from a deliberate exit.
 */
export function useLocalModelSetupAnalytics({
  active,
  catalog,
  status,
}: {
  readonly active: boolean;
  readonly catalog: readonly ManagedLocalAiModel[];
  readonly status: ManagedLocalAiStatus | null;
}): void {
  const sent = useRef<Record<string, boolean>>({});

  useEffect(() => {
    if (!active || catalog.length === 0 || sent.current.viewed) return;
    sent.current.viewed = true;
    capturePostHogEvent("local_model_setup", {
      phase: "viewed",
      any_installable: anyModelInstallable(catalog),
      recommended_fit: recommendedModelFit(catalog),
    });
  }, [active, catalog]);

  useEffect(() => {
    if (!active || catalog.length === 0) return;
    const shared = {
      any_installable: anyModelInstallable(catalog),
      recommended_fit: recommendedModelFit(catalog),
      model_tier: modelTier(catalog, status?.selectedModelId ?? null),
    } as const;

    if (hasManagedLocalInstallStarted(status) && !sent.current.download_started) {
      sent.current.download_started = true;
      capturePostHogEvent("local_model_setup", { phase: "download_started", ...shared });
    }
    if (status?.state === "error" && !sent.current.download_failed) {
      sent.current.download_failed = true;
      capturePostHogEvent("local_model_setup", { phase: "download_failed", ...shared });
    }
    if (isManagedLocalReady(status) && !sent.current.model_ready) {
      sent.current.model_ready = true;
      capturePostHogEvent("local_model_setup", { phase: "model_ready", ...shared });
    }
  }, [active, catalog, status]);
}
