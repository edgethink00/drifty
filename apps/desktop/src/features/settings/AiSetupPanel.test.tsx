// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AiSetupPanel } from "./AiSetupPanel";
import { DEFAULT_LOCAL_AI_SETUP, type LocalAiSetupState } from "./localAiSetup";

function renderPanel({
  currentBillingPlan = "individual",
  initialSetup = DEFAULT_LOCAL_AI_SETUP,
}: {
  readonly currentBillingPlan?: "free" | "individual";
  readonly initialSetup?: LocalAiSetupState;
} = {}) {
  const onStartCloudSetup = vi.fn();

  function Harness() {
    const [localAiSetup, setLocalAiSetup] = useState<LocalAiSetupState>(initialSetup);

    return (
      <AiSetupPanel
        aiServerStatusLabel="Available"
        billingCheckoutLoadingInterval={null}
        billingEntitlementError={null}
        billingPlansDisabled={false}
        cloudStatusLabel="Cloud AI available"
        currentBillingPlan={currentBillingPlan}
        localAiSetup={localAiSetup}
        shouldShowCloudCheckoutPlans={false}
        onDialogOpenChange={vi.fn()}
        onLocalAiSetupChange={setLocalAiSetup}
        onStartCloudSetup={onStartCloudSetup}
      />
    );
  }

  render(<Harness />);
  return { onStartCloudSetup };
}

describe("AiSetupPanel", () => {
  it("switches between Cloud, Local, and Local Ollama setup menus", () => {
    renderPanel();

    const sectionTabs = screen.getByRole("tablist", { name: /AI setup sections/i });
    expect(within(sectionTabs).getByRole("tab", { name: /^Cloud$/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("group", { name: /Drifty Cloud pricing/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /OpenRouter BYOK settings/i })).toBeNull();
    expect(screen.queryByRole("group", { name: /Self-hosted AI settings/i })).toBeNull();

    fireEvent.click(within(sectionTabs).getByRole("tab", { name: /^BYOK\(OpenRouter\)$/i }));
    expect(screen.getByRole("group", { name: /OpenRouter BYOK settings/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /Drifty Cloud pricing/i })).toBeNull();
    expect(screen.queryByRole("group", { name: /Self-hosted AI settings/i })).toBeNull();

    fireEvent.click(within(sectionTabs).getByRole("tab", { name: /^Local \(Ollama\)$/i }));
    const ollamaSettings = screen.getByRole("group", { name: /Self-hosted AI settings/i });
    expect(within(ollamaSettings).getByRole("button", { name: /^Selected$/ })).toBeTruthy();
    expect(within(ollamaSettings).getByLabelText(/Self-hosted base URL/i)).toBeTruthy();
    expect(screen.queryByRole("group", { name: /OpenRouter BYOK settings/i })).toBeNull();
  });

  it("starts Cloud setup from the Individual plan card without a separate website button", () => {
    const { onStartCloudSetup } = renderPanel({ currentBillingPlan: "free" });

    expect(screen.queryByRole("button", { name: /continue on drifty\.so/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /choose individual plan/i }));

    expect(onStartCloudSetup).toHaveBeenCalledWith("monthly");
  });
});
