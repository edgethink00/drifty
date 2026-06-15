// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AiSetupPanel } from "./AiSetupPanel";
import { getUserOnboardingStorageKey } from "../onboarding/onboardingState";
import { DEFAULT_LOCAL_AI_SETUP, type LocalAiSetupState } from "./localAiSetup";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn().mockResolvedValue({ status: 200, body: "{\"choices\":[{\"message\":{\"content\":\"{\\\"ok\\\":true}\"}}]}", latencyMs: 42 }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

function renderPanel({
  currentBillingPlan = "individual",
  billingEntitlementStatus = "active",
  cloudTrialEndsAt = null,
  initialSetup = DEFAULT_LOCAL_AI_SETUP,
  userEmail = null,
  workProfileUserId = "local",
}: {
  readonly currentBillingPlan?: "free" | "individual";
  readonly billingEntitlementStatus?: "trialing" | "active" | "locked" | null;
  readonly cloudTrialEndsAt?: string | null;
  readonly initialSetup?: LocalAiSetupState;
  readonly userEmail?: string | null;
  readonly workProfileUserId?: string;
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
        userEmail={userEmail}
        workProfileUserId={workProfileUserId}
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
    const cloudRow = within(sectionChoices).getByRole("button", { name: /^Drifty Cloud setup row$/i });
    const openRouterRow = within(sectionChoices).getByRole("button", { name: /^OpenRouter BYOK setup row$/i });
    const ollamaRow = within(sectionChoices).getByRole("button", { name: /^Local Ollama setup row$/i });

    expect(cloudRow.getAttribute("aria-expanded")).toBe("true");
    expect(within(cloudRow).queryByText("Polar checkout")).toBeNull();
    expect(within(openRouterRow).queryByText("Selected")).toBeNull();
    expect(within(openRouterRow).queryByText("Key needed")).toBeNull();
    expect(within(openRouterRow).queryByText("deepseek/deepseek-v4-flash")).toBeNull();
    expect(within(ollamaRow).queryByText("Choose model")).toBeNull();
    expect(screen.getByRole("group", { name: /Drifty Cloud settings/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /OpenRouter BYOK settings/i })).toBeNull();
    expect(screen.queryByRole("group", { name: /Self-hosted AI settings/i })).toBeNull();

    fireEvent.click(openRouterRow);
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

    fireEvent.click(screen.getByRole("button", { name: /set up drifty cloud/i }));

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

  it("shows the signed-in Cloud account with a masked email", () => {
    renderPanel({ userEmail: "alex@example.com" });

    const cloudSettings = screen.getByRole("group", { name: /Drifty Cloud settings/i });

    expect(within(cloudSettings).getByText("al***@example.com")).toBeTruthy();
    expect(within(cloudSettings).queryByText("alex@example.com")).toBeNull();
  });

  it("lets users edit the work profile selections used by AI classification", async () => {
    const storageKey = getUserOnboardingStorageKey("local");
    window.localStorage.setItem(storageKey, JSON.stringify({
      version: 2,
      completed: true,
      displayName: "",
      workType: "Coding",
      workTypeOther: "",
      workDomain: "Product development",
      workDomainOther: "",
      jobType: "Coding, Writing",
      jobTypeOther: "",
      driftAlarmEnabled: false,
      extremeNudgeEnabled: false,
      focusGoalHours: null,
      driftThresholdMinutes: null,
      purpose: null,
      completedAt: "2026-06-15T00:00:00.000Z",
    }));

    renderPanel();

    expect(screen.getByRole("button", { name: /^Work profile$/i }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByText("Coding, Writing in Product development")).toBeNull();
    expect(screen.queryByText(/User work profile:/i)).toBeNull();
    expect(screen.queryByText(/AI prompt line/i)).toBeNull();
    expect(screen.queryByText(/^Source$/i)).toBeNull();

    expect(screen.getByRole("button", { name: /remove coding/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /remove writing/i })).toBeTruthy();
    const addActivity = screen.getByRole("combobox", { name: /add work activity/i });
    const fieldCombo = screen.getByRole("combobox", { name: /your field/i });
    expect(screen.getByPlaceholderText("Product development")).toBeTruthy();

    fireEvent.change(addActivity, { target: { value: "Data Analysis" } });
    expect(screen.getByRole("button", { name: /remove data analysis/i })).toBeTruthy();
    fireEvent.click(fieldCombo);
    fireEvent.click(await screen.findByRole("option", { name: "AI" }));

    expect(screen.queryByText("Coding, Writing, Data Analysis in AI")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /save work profile/i }));

    const savedState = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Record<string, unknown>;
    expect(savedState).toMatchObject({
      workType: "Coding",
      workTypeOther: "",
      jobType: "Coding, Writing, Data Analysis",
      jobTypeOther: "",
      workDomain: "AI",
      workDomainOther: "",
    });
    expect(screen.getByRole("status").textContent).toContain("Work profile saved");
    expect(screen.queryByText("Coding, Writing, Data Analysis in AI")).toBeNull();
    expect(screen.queryByText(/User work profile:/i)).toBeNull();
  });

  it("tests the selected local provider connection without saving secret material", async () => {
    renderPanel();
    const sectionChoices = screen.getByRole("group", { name: /AI setup choices/i });

    fireEvent.click(within(sectionChoices).getByRole("button", { name: /^OpenRouter BYOK setup row$/i }));
    fireEvent.change(screen.getByLabelText(/OpenRouter API key/i), { target: { value: "sk-or-v1-test-secret" } });
    fireEvent.click(screen.getByRole("button", { name: /test openrouter connection/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("ai_classification_openai_chat", expect.objectContaining({
      request: expect.objectContaining({
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "sk-or-v1-test-secret",
      }),
    })));
    expect(await screen.findByText(/connected in 42 ms/i)).toBeTruthy();
    expect(window.localStorage.getItem("drifty.aiSetup.v1") ?? "").not.toContain("sk-or-v1-test-secret");
  });

  it("shows the same privacy review inside AI setup", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: /Privacy review/i }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /Privacy review/i }));
    expect(screen.getByRole("region", { name: /AI privacy review/i })).toBeTruthy();
    const appContextCheck = screen.getByRole("checkbox", { name: /App name and basic app context is sent/i });
    const domainCheck = screen.getByRole("checkbox", { name: /Browser or site domain is sent/i });
    if (!(appContextCheck instanceof HTMLInputElement) || !(domainCheck instanceof HTMLInputElement)) {
      throw new Error("Privacy review fields should render as checkboxes.");
    }
    expect(appContextCheck.checked).toBe(true);
    expect(domainCheck.checked).toBe(true);
    expect(screen.getByText(/Raw timeline rows/i)).toBeTruthy();
  });
});
