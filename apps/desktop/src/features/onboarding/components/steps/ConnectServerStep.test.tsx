// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectServerStep } from "./ConnectServerStep";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { MANAGED_LOCAL_AI_FALLBACK_CATALOG } from "../../../settings/managedLocalAiCatalog";

afterEach(cleanup);

function renderModels(selectedModelId: string | null = null) {
  const installModel = vi.fn();
  const catalog = MANAGED_LOCAL_AI_FALLBACK_CATALOG.map((model, index) => ({
    ...model,
    recommended: index === 0,
    fit: index > 1 ? "insufficient" : "good",
  }));
  const flow = {
    setupChoice: "local_ai",
    managedLocalAi: {
      catalog, loading: false, actionModelId: null, installModel,
      status: selectedModelId ? { selectedModelId, state: "error", message: "Download failed", progress: null } : null,
    },
  } as unknown as OnboardingFlow;
  render(<ConnectServerStep flow={flow} />);
  return { installModel };
}

describe("onboarding local model choice", () => {
  it("shows all models in catalog order and keeps unsupported downloads disabled", () => {
    const { installModel } = renderModels();
    expect(screen.getAllByRole("article").map((article) => article.getAttribute("aria-label"))).toEqual(
      MANAGED_LOCAL_AI_FALLBACK_CATALOG.map((model) => `${model.label} local AI model`),
    );
    expect(screen.queryByRole("button", { name: "Compare other models" })).toBeNull();
    const unsupported = screen.getByRole("article", { name: "Qwen 3.6 27B local AI model" });
    const download = within(unsupported).getByRole("button", { name: "Download" });
    expect(download).toHaveProperty("disabled", true);
    fireEvent.click(download);
    expect(installModel).not.toHaveBeenCalled();
    const supported = screen.getByRole("article", { name: "Qwen 3.5 2B local AI model" });
    fireEvent.click(within(supported).getByRole("button", { name: "Download" }));
    expect(installModel).toHaveBeenCalledWith("drifty-qwen3-5-2b-economy");
  });

  it("keeps the failed chosen model visible for retry even when another model is recommended", () => {
    const { installModel } = renderModels("drifty-qwen3-5-4b-default");
    const selected = screen.getByRole("article", { name: "Qwen 3.5 4B local AI model" });
    fireEvent.click(within(selected).getByRole("button", { name: "Retry" }));
    expect(installModel).toHaveBeenCalledWith("drifty-qwen3-5-4b-default");
  });
});
