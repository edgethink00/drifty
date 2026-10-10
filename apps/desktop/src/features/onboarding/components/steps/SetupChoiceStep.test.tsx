// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupChoiceStep } from "./SetupChoiceStep";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { MANAGED_LOCAL_AI_FALLBACK_CATALOG } from "../../../settings/managedLocalAiCatalog";

afterEach(cleanup);

function renderSetup(options: {
  readonly fit: "good" | "insufficient";
  readonly loading?: boolean;
}) {
  const handleSetupChoice = vi.fn();
  const catalog = MANAGED_LOCAL_AI_FALLBACK_CATALOG.map((model) => ({
    ...model,
    fit: options.fit,
  }));
  const flow = {
    setupChoice: "simple",
    promotionActive: false,
    promotionEndsAt: null,
    handleSetupChoice,
    managedLocalAi: {
      catalog,
      loading: options.loading ?? false,
    },
  } as unknown as OnboardingFlow;
  render(<SetupChoiceStep advancedVisible={false} flow={flow} onToggleAdvanced={() => undefined} />);
  return { handleSetupChoice };
}

describe("onboarding setup local choice", () => {
  it("lets the user pick Local AI when a model can install", () => {
    const { handleSetupChoice } = renderSetup({ fit: "good" });
    const local = screen.getByRole("button", { name: /local ai/i });
    expect(local.hasAttribute("disabled")).toBe(false);
    fireEvent.click(local);
    expect(handleSetupChoice).toHaveBeenCalledWith("local_ai");
  });

  it("disables Local AI on the setup card when every model is insufficient", () => {
    const { handleSetupChoice } = renderSetup({ fit: "insufficient" });
    const local = screen.getByRole("button", { name: /local ai/i });
    expect(local.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/no local model can run on this device/i)).toBeTruthy();
    fireEvent.click(local);
    expect(handleSetupChoice).not.toHaveBeenCalled();
  });

  it("tags Local AI with the least memory the lightest local model needs", () => {
    const GIB = 1024 ** 3;
    const catalog = MANAGED_LOCAL_AI_FALLBACK_CATALOG.map((model) => ({
      ...model, fit: "insufficient" as const, minMemoryBytes: 8 * GIB, machineMemoryBytes: 4 * GIB,
    }));
    const flow = {
      setupChoice: "simple", promotionActive: false, promotionEndsAt: null, handleSetupChoice: vi.fn(),
      managedLocalAi: { catalog, loading: false },
    } as unknown as OnboardingFlow;
    render(<SetupChoiceStep advancedVisible={false} flow={flow} onToggleAdvanced={() => undefined} />);
    expect(screen.getByText("Not enough memory · needs 8 GB+")).toBeTruthy();
    expect(screen.getByText(/no local model can run on this device/i)).toBeTruthy();
  });

  it("keeps Local AI enabled while the catalog is loading", () => {
    renderSetup({ fit: "insufficient", loading: true });
    const local = screen.getByRole("button", { name: /local ai/i });
    expect(local.hasAttribute("disabled")).toBe(false);
  });
});
