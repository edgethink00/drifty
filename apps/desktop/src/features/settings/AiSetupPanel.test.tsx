// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AiSetupPanel } from "./AiSetupPanel";
import { DEFAULT_LOCAL_AI_SETUP, type LocalAiSetupState } from "./localAiSetup";

function renderPanel({
  currentBillingPlan = "individual",
  billingEntitlementStatus = "active",
  cloudTrialEndsAt = null,
  initialSetup = DEFAULT_LOCAL_AI_SETUP,
}: {
  readonly currentBillingPlan?: "free" | "individual";
  readonly billingEntitlementStatus?: "trialing" | "active" | "locked" | null;
  readonly cloudTrialEndsAt?: string | null;
  readonly initialSetup?: LocalAiSetupState;
} = {}) {
  const onRefreshCloudStatus = vi.fn();
  const onStartCloudSetup = vi.fn();

  function Harness() {
    const [localAiSetup, setLocalAiSetup] = useState<LocalAiSetupState>(initialSetup);

    return (
      <AiSetupPanel
        aiServerStatusLabel="Available"
        billingCheckoutLoadingInterval={null}
        billingEntitlementError={null}
        billingEntitlementStatus={billingEntitlementStatus}
        billingPlansDisabled={false}
        cloudStatusRefreshing={false}
        cloudStatusLabel="Cloud AI available"
        cloudTrialEndsAt={cloudTrialEndsAt}
        currentBillingPlan={currentBillingPlan}
        isSupabaseConfigured={true}
        localAiSetup={localAiSetup}
        shouldShowCloudCheckoutPlans={false}
        onDialogOpenChange={vi.fn()}
        onLocalAiSetupChange={setLocalAiSetup}
        onRefreshCloudStatus={onRefreshCloudStatus}
        onStartCloudSetup={onStartCloudSetup}
      />
    );
  }

  render(<Harness />);
  return { onRefreshCloudStatus, onStartCloudSetup };
}

describe("AiSetupPanel", () => {
  it("switches between Cloud, OpenRouter, and Ollama setup rows", () => {
    renderPanel();

    const sectionChoices = screen.getByRole("group", { name: /AI setup choices/i });
    expect(within(sectionChoices).getByRole("button", { name: /^Drifty Cloud setup row$/i }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: /Drifty Cloud settings/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /OpenRouter BYOK settings/i })).toBeNull();
    expect(screen.queryByRole("group", { name: /Self-hosted AI settings/i })).toBeNull();

    fireEvent.click(within(sectionChoices).getByRole("button", { name: /^OpenRouter BYOK setup row$/i }));
    expect(screen.getByRole("group", { name: /OpenRouter BYOK settings/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /Drifty Cloud settings/i })).toBeNull();
    expect(screen.queryByRole("group", { name: /Self-hosted AI settings/i })).toBeNull();

    fireEvent.click(within(sectionChoices).getByRole("button", { name: /^Local Ollama setup row$/i }));
    const ollamaSettings = screen.getByRole("group", { name: /Self-hosted AI settings/i });
    expect(within(ollamaSettings).getByLabelText(/Self-hosted base URL/i)).toBeTruthy();
    expect(screen.queryByRole("group", { name: /OpenRouter BYOK settings/i })).toBeNull();
  });

  it("starts Cloud setup from the Polar CTA without plan cards", () => {
    const { onStartCloudSetup } = renderPanel({ currentBillingPlan: "free" });

    expect(screen.queryByRole("button", { name: /continue on drifty\.so/i })).toBeNull();
    expect(screen.queryByRole("article", { name: /individual plan/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /continue in polar/i }));

    expect(onStartCloudSetup).toHaveBeenCalledWith();
  });

  it("refreshes Cloud status from the active Cloud row", () => {
    const { onRefreshCloudStatus } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /refresh drifty cloud/i }));

    expect(onRefreshCloudStatus).toHaveBeenCalledTimes(1);
  });

  it("shows active trial copy in the Cloud row", () => {
    renderPanel({
      billingEntitlementStatus: "trialing",
      cloudTrialEndsAt: "2026-06-20T00:00:00.000Z",
    });

    const cloudSettings = screen.getByRole("group", { name: /Drifty Cloud settings/i });

    expect(within(cloudSettings).getByText(/1-week free trial is active/i)).toBeTruthy();
    expect(within(cloudSettings).getByText(/available until jun 20/i)).toBeTruthy();
  });
});
