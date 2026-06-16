// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiSetupPanel } from "./AiSetupPanel";
import { getUserOnboardingStorageKey } from "../onboarding/onboardingState";
import { DEFAULT_LOCAL_AI_SETUP, type LocalAiSetupState } from "./localAiSetup";

const { invokeMock } = vi.hoisted(() => {
  const managedCatalog = [
    { id: "drifty-qwen3-5-2b-economy", tier: "economy", label: "Qwen 3.5 2B", detail: "Small local model.", downloadSize: "~1.4 GB", diskRequired: "3 GB free", minimumMemory: "8 GB RAM", recommended: false },
    { id: "drifty-qwen3-5-4b-default", tier: "default", label: "Qwen 3.5 4B", detail: "Recommended local model.", downloadSize: "~2.8 GB", diskRequired: "6 GB free", minimumMemory: "16 GB RAM", recommended: true },
    { id: "drifty-gemma-4-12b-local", tier: "gemma", label: "Gemma 4 12B", detail: "Mid-sized Gemma 4 local model.", downloadSize: "~8.0 GB", diskRequired: "16 GB free", minimumMemory: "24 GB RAM", recommended: false },
    { id: "drifty-qwen3-6-27b-smart", tier: "smart", label: "Qwen 3.6 27B", detail: "Stronger local model.", downloadSize: "~15 GB", diskRequired: "30 GB free", minimumMemory: "36 GB RAM", recommended: false },
  ];
  const managedStatus = {
    state: "not_installed",
    selectedModelId: null,
    baseUrl: null,
    model: null,
    message: "Choose a local model and Drifty will download it inside the app.",
    artifactDir: null,
  };

  function modelIdFromArgs(args: unknown): string {
    if (!args || typeof args !== "object" || !("modelId" in args) || typeof args.modelId !== "string") return "";
    return args.modelId;
  }

  return {
    invokeMock: vi.fn((command: string, args?: unknown) => {
      switch (command) {
        case "managed_ai_catalog":
          return Promise.resolve(managedCatalog);
        case "managed_ai_status":
          return Promise.resolve(managedStatus);
        case "managed_ai_install": {
          const modelId = modelIdFromArgs(args);
          return Promise.resolve({
            ...managedStatus,
            state: "installed",
            selectedModelId: modelId,
            baseUrl: "http://127.0.0.1:39217/v1",
            model: "drifty-qwen3.5-4b-local",
            message: "Model metadata is staged.",
          });
        }
        case "managed_ai_start":
          return Promise.resolve({ ...managedStatus, state: "error", message: "Runtime assets are not installed yet." });
        case "managed_ai_delete":
          return Promise.resolve({ ...managedStatus, state: "not_installed", message: "Choose a local model and Drifty will download it inside the app." });
        case "ai_classification_openai_chat":
          return Promise.resolve({ status: 200, body: "{\"choices\":[{\"message\":{\"content\":\"{\\\"ok\\\":true}\"}}]}", latencyMs: 42 });
        default:
          return Promise.resolve({});
      }
    }),
  };
});

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
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it("switches between Drifty and OpenRouter setup rows", async () => {
    renderPanel();

    const sectionChoices = screen.getByRole("group", { name: /AI setup choices/i });
    expect(within(sectionChoices).getByRole("button", { name: /^Drifty setup row$/i }).getAttribute("aria-expanded")).toBe("true");
    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    const providerSelect = within(modelBeingUsed).getByLabelText(/^AI provider$/i);
    const modelSelect = within(modelBeingUsed).getByLabelText(/^AI model$/i);
    if (!(providerSelect instanceof HTMLSelectElement) || !(modelSelect instanceof HTMLSelectElement)) {
      throw new Error("Global model controls should be native selects.");
    }
    expect(providerSelect.value).toBe("drifty");
    expect(modelSelect.value).toBe("drifty-qwen3-5-4b-default");

    const driftySettings = await screen.findByRole("group", { name: /^Drifty settings$/i });
    fireEvent.change(modelSelect, { target: { value: "drifty_cloud" } });
    expect(providerSelect.value).toBe("drifty");
    expect(modelSelect.value).toBe("drifty_cloud");

    fireEvent.change(modelSelect, { target: { value: "drifty-gemma-4-12b-local" } });
    expect(providerSelect.value).toBe("drifty");
    expect(modelSelect.value).toBe("drifty-gemma-4-12b-local");

    const localSettings = within(driftySettings).getByRole("group", { name: /Local AI settings/i });
    expect(within(driftySettings).getByRole("group", { name: /Drifty Cloud settings/i })).toBeTruthy();
    expect(within(localSettings).getByRole("article", { name: /Qwen 3\.5 4B managed local model/i })).toBeTruthy();
    expect(within(localSettings).getByRole("article", { name: /Gemma 4 12B managed local model/i })).toBeTruthy();
    expect(within(localSettings).getByRole("article", { name: /Qwen 3\.6 27B managed local model/i })).toBeTruthy();
    expect(within(driftySettings).queryByLabelText(/Drifty Cloud selected/i)).toBeNull();
    expect(within(driftySettings).queryByLabelText(/Managed local model selected/i)).toBeNull();
    const gemmaSelector = within(localSettings).getByLabelText(/Select Gemma 4 12B managed local model/i);
    if (!(gemmaSelector instanceof HTMLInputElement)) throw new Error("Managed local model selector should be a radio input.");
    expect(gemmaSelector.checked).toBe(true);
    expect(screen.queryByRole("group", { name: /OpenRouter BYOK settings/i })).toBeNull();
    expect(screen.queryByRole("group", { name: /Custom local endpoint settings/i })).toBeNull();
    expect(screen.queryByText(/Custom local endpoint/i)).toBeNull();

    fireEvent.change(providerSelect, { target: { value: "openrouter" } });
    expect(providerSelect.value).toBe("openrouter");
    expect(modelSelect.value).toBe("deepseek/deepseek-v4-flash");
    expect(screen.getByRole("group", { name: /OpenRouter BYOK settings/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /^Drifty settings$/i })).toBeNull();

    fireEvent.change(modelSelect, { target: { value: "qwen/qwen3.6-plus" } });
    expect(modelSelect.value).toBe("qwen/qwen3.6-plus");

    fireEvent.click(within(sectionChoices).getByRole("button", { name: /^Drifty setup row$/i }));
    expect(providerSelect.value).toBe("drifty");
    expect(screen.getByRole("group", { name: /^Drifty settings$/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /OpenRouter BYOK settings/i })).toBeNull();
  });

  it("installs and deletes the selected managed local model from the Drifty row", async () => {
    renderPanel();

    const localSettings = await screen.findByRole("group", { name: /Local AI settings/i });
    const qwenDefault = within(localSettings).getByRole("article", { name: /Qwen 3\.5 4B managed local model/i });
    fireEvent.click(within(qwenDefault).getByRole("button", { name: /^Download$/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-qwen3-5-4b-default" }));
    const deleteButton = within(qwenDefault).getByRole("button", { name: /^Delete$/i });
    if (!(deleteButton instanceof HTMLButtonElement)) throw new Error("Delete control should be a button.");
    await waitFor(() => expect(deleteButton.disabled).toBe(false));
    fireEvent.click(deleteButton);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_delete", { modelId: "drifty-qwen3-5-4b-default" }));
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

  it("lets users edit the work profile used by AI classification", () => {
    const storageKey = getUserOnboardingStorageKey("local");
    window.localStorage.setItem(storageKey, JSON.stringify({
      version: 2,
      completed: true,
      displayName: "",
      workType: "Software engineering",
      workTypeOther: "",
      workDomain: "Product development",
      workDomainOther: "",
      jobType: null,
      jobTypeOther: "",
      driftAlarmEnabled: false,
      extremeNudgeEnabled: false,
      focusGoalHours: null,
      driftThresholdMinutes: null,
      purpose: null,
      completedAt: "2026-06-15T00:00:00.000Z",
    }));

    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /Work profile/i }));
    const workProfile = screen.getByRole("textbox", { name: /work profile/i });
    if (!(workProfile instanceof HTMLTextAreaElement)) throw new Error("Work profile control should be a textarea.");
    expect(workProfile.value).toBe("Software engineering in Product development");

    fireEvent.change(workProfile, { target: { value: "iOS app development and launch operations" } });
    fireEvent.click(screen.getByRole("button", { name: /save work profile/i }));

    const savedState = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Record<string, unknown>;
    expect(savedState).toMatchObject({
      workType: "iOS app development and launch operations",
      workTypeOther: "",
      workDomain: null,
      workDomainOther: "",
    });
    expect(screen.getByRole("status").textContent).toContain("Work profile saved");
  });

  it("tests the selected local provider connection without saving secret material", async () => {
    renderPanel();
    const sectionChoices = screen.getByRole("group", { name: /AI setup choices/i });

    fireEvent.click(within(sectionChoices).getByRole("button", { name: /^OpenRouter setup row$/i }));
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
