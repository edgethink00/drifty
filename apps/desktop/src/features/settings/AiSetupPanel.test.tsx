// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserOnboardingStorageKey } from "../onboarding/onboardingState";
import { invokeMock, renderPanel, resetManagedStatusMock, revealItemInDirMock } from "./AiSetupPanel.testHarness";
import { PrivacySettingsSection } from "./PrivacySettingsSection";

const AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY = "drifty.aiPrivacyRequestSettings.v1";
const REMOVED_PRIVACY_HELPER_COPY = [
  `Helps distinguish work from ${"drift."}`,
  `Needed for a useful category ${"result."}`,
  `Useful for personalized work ${"categories."}`,
] as const;

const { testCloudAiConnectionMock } = vi.hoisted(() => ({
  testCloudAiConnectionMock: vi.fn(),
}));

vi.mock("./cloudAiConnectionTest", () => ({
  testCloudAiConnection: testCloudAiConnectionMock,
}));

describe("AiSetupPanel", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    resetManagedStatusMock();
    revealItemInDirMock.mockClear();
    testCloudAiConnectionMock.mockClear();
    window.localStorage.clear();
    testCloudAiConnectionMock.mockResolvedValue({ kind: "success", message: "Cloud AI connected via Google in 42 ms." });
  });

  it("switches between Drifty, OpenRouter, and custom endpoint setup rows", async () => {
    renderPanel();

    const setupTabs = screen.getByRole("tablist", { name: /AI setup sections/i });
    expect(within(setupTabs).getByRole("tab", { name: /^Providers$/i }).getAttribute("aria-selected")).toBe("true");
    expect(within(setupTabs).getByRole("tab", { name: /^Profile & info$/i }).getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByRole("button", { name: /^Work profile$/i })).toBeNull();
    const sectionChoices = screen.getByRole("group", { name: /AI setup choices/i });
    expect(within(sectionChoices).getByRole("button", { name: /^Drifty setup row$/i }).getAttribute("aria-expanded")).toBe("true");
    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    const providerSelect = within(modelBeingUsed).getByRole("combobox", { name: /^AI provider$/i });
    const modelSelect = within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i });
    expect(providerSelect.textContent).toContain("Drifty");
    expect(modelSelect.textContent).toContain("Drifty Individual (Cloud)");

    const driftySettings = await screen.findByRole("group", { name: /^Drifty settings$/i });
    chooseOption(modelBeingUsed, /^AI model$/i, /^Drifty Individual \(Cloud\)$/i);
    expect(providerSelect.textContent).toContain("Drifty");
    expect(modelSelect.textContent).toContain("Drifty Individual (Cloud)");

    fireEvent.click(modelSelect);
    const gemmaOption = within(modelBeingUsed).getByRole("option", { name: /^Gemma 4 12B$/i });
    if (!(gemmaOption instanceof HTMLButtonElement)) throw new Error("Disabled managed model option should be a button.");
    expect(gemmaOption.disabled).toBe(true);
    expect(modelBeingUsed.textContent).not.toMatch(/download required/i);
    fireEvent.click(gemmaOption);
    expect(providerSelect.textContent).toContain("Drifty");
    expect(modelSelect.textContent).toContain("Drifty Individual (Cloud)");
    fireEvent.click(modelSelect);

    const localSettings = within(driftySettings).getByRole("group", { name: /Local AI settings/i });
    const cloudSettings = within(driftySettings).getByRole("group", { name: /Drifty Cloud settings/i });
    const cloudDescription = within(driftySettings).getByText("Access powerful AI models managed by Drifty, no local setup required.");
    expect(cloudSettings).toBeTruthy();
    expect(cloudDescription.compareDocumentPosition(cloudSettings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(localSettings).getByRole("article", { name: /Qwen 3\.5 4B managed local model/i })).toBeTruthy();
    expect(within(localSettings).getByRole("article", { name: /Gemma 4 12B managed local model/i })).toBeTruthy();
    expect(within(localSettings).getByRole("article", { name: /Qwen 3\.6 27B managed local model/i })).toBeTruthy();
    expect(within(driftySettings).queryByLabelText(/Drifty Cloud selected/i)).toBeNull();
    expect(within(driftySettings).queryByLabelText(/Managed local model selected/i)).toBeNull();
    // Per-model radio selectors were removed; the active model is chosen from the
    // "Model being used" dropdown, so the cards carry no select input.
    expect(within(localSettings).queryByLabelText(/Select Gemma 4 12B managed local model/i)).toBeNull();
    expect(within(localSettings).queryByLabelText(/Select Qwen 3\.5 4B managed local model/i)).toBeNull();
    expect(screen.queryByRole("group", { name: /OpenRouter BYOK settings/i })).toBeNull();
    expect(screen.queryByRole("group", { name: /Custom endpoint settings/i })).toBeNull();

    fireEvent.click(within(sectionChoices).getByRole("button", { name: /^OpenRouter setup row$/i }));
    expect(providerSelect.textContent).toContain("Drifty");
    expect(modelSelect.textContent).toContain("Drifty Individual (Cloud)");
    expect(screen.getByRole("group", { name: /OpenRouter BYOK settings/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /^Drifty settings$/i })).toBeNull();

    chooseOption(modelBeingUsed, /^AI provider$/i, /^OpenRouter$/i);
    expect(providerSelect.textContent).toContain("OpenRouter");
    expect(modelSelect.textContent).toContain("DeepSeek V4 Flash");
    expect(screen.getByRole("group", { name: /OpenRouter BYOK settings/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /Custom endpoint settings/i })).toBeNull();
    expect(screen.queryByRole("group", { name: /^Drifty settings$/i })).toBeNull();

    chooseOption(modelBeingUsed, /^AI model$/i, /^Qwen 3\.6 Plus$/i);
    expect(modelSelect.textContent).toContain("Qwen 3.6 Plus");

    fireEvent.click(within(sectionChoices).getByRole("button", { name: /^Custom endpoint setup row$/i }));
    expect(providerSelect.textContent).toContain("OpenRouter");
    expect(modelSelect.textContent).toContain("Qwen 3.6 Plus");
    expect(screen.getByRole("group", { name: /Custom endpoint settings/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /OpenRouter BYOK settings/i })).toBeNull();

    chooseOption(modelBeingUsed, /^AI provider$/i, /^Custom endpoint$/i);
    expect(providerSelect.textContent).toContain("Custom endpoint");
    expect(modelSelect.textContent).toContain("Custom endpoint");
    expect(screen.getByRole("group", { name: /Custom endpoint settings/i })).toBeTruthy();

    fireEvent.click(within(sectionChoices).getByRole("button", { name: /^Drifty setup row$/i }));
    expect(providerSelect.textContent).toContain("Custom endpoint");
    expect(modelSelect.textContent).toContain("Custom endpoint");
    expect(screen.getByRole("group", { name: /^Drifty settings$/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /OpenRouter BYOK settings/i })).toBeNull();
    expect(screen.queryByRole("group", { name: /Custom endpoint settings/i })).toBeNull();
  });

  it("collapses the expanded provider when its bar is clicked again", () => {
    renderPanel();

    const sectionChoices = screen.getByRole("group", { name: /AI setup choices/i });
    const driftyRow = within(sectionChoices).getByRole("button", { name: /^Drifty setup row$/i });
    // Drifty is expanded by default on a fresh (managed local) setup.
    expect(driftyRow.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: /^Drifty settings$/i })).toBeTruthy();

    fireEvent.click(driftyRow);
    expect(driftyRow.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: /^Drifty settings$/i })).toBeNull();

    fireEvent.click(driftyRow);
    expect(driftyRow.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: /^Drifty settings$/i })).toBeTruthy();
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

    fireEvent.click(screen.getByRole("tab", { name: /^Profile & info$/i }));
    expect(screen.getByRole("button", { name: /^Work profile$/i }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /^Work profile$/i }));
    expect(screen.getByRole("button", { name: /^Work profile$/i }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("region", { name: /^Model being used$/i })).toBeNull();
    expect(screen.queryByText("Coding, Writing in Product development")).toBeNull();
    expect(screen.queryByText(/User work profile:/i)).toBeNull();
    expect(screen.queryByText(/AI prompt line/i)).toBeNull();
    expect(screen.queryByText(/^Source$/i)).toBeNull();

    expect(screen.getByRole("button", { name: /remove coding/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /remove writing/i })).toBeTruthy();
    const addActivity = screen.getByRole("combobox", { name: /add work activity/i });
    const fieldCombo = screen.getByRole("combobox", { name: /your field/i });
    expect(screen.getByPlaceholderText("Product development")).toBeTruthy();
    expect(addActivity).not.toBeInstanceOf(HTMLSelectElement);

    fireEvent.click(addActivity);
    fireEvent.click(await screen.findByRole("option", { name: "Data Analysis" }));
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
    const { onLocalAiConnectionTestResult } = renderPanel();
    const sectionChoices = screen.getByRole("group", { name: /AI setup choices/i });

    fireEvent.click(within(sectionChoices).getByRole("button", { name: /^OpenRouter setup row$/i }));
    fireEvent.change(screen.getByLabelText(/OpenRouter API key/i), { target: { value: "sk-or-v1-test-secret" } });
    fireEvent.click(screen.getByRole("button", { name: /test ai connection/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("ai_classification_openai_chat", expect.objectContaining({
      request: expect.objectContaining({
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "sk-or-v1-test-secret",
      }),
    })));
    expect(await screen.findByText(/connected in 42 ms/i)).toBeTruthy();
    expect(onLocalAiConnectionTestResult).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openrouter_byok",
      openRouterApiKey: "sk-or-v1-test-secret",
    }), {
      kind: "success",
      message: "Connected in 42 ms.",
    });
    expect(window.localStorage.getItem("drifty.aiSetup.v1") ?? "").not.toContain("sk-or-v1-test-secret");
  });

  it("tests Drifty Cloud instead of stale managed local settings when Cloud is selected", async () => {
    const { onLocalAiConnectionTestResult } = renderPanel({
      initialSetup: {
        provider: "managed_local",
        driftyRoute: "cloud",
        managedLocalModelId: "drifty-qwen3-5-4b-default",
        managedLocalBaseUrl: "http://127.0.0.1:39217/v1",
        managedLocalModel: "drifty-qwen3.5-4b-local",
        openRouterApiKey: "",
        openRouterModel: "deepseek/deepseek-v4-flash",
        openRouterFallbackModels: [],
        selfHostedBaseUrl: "http://localhost:11434/v1",
        selfHostedModel: "",
      },
    });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    expect(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }).textContent).toContain("Drifty Individual (Cloud)");
    fireEvent.click(screen.getByRole("button", { name: /test ai connection/i }));

    expect(await screen.findByText(/Cloud AI connected via Google in 42 ms/i)).toBeTruthy();
    expect(testCloudAiConnectionMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalledWith("ai_classification_openai_chat", expect.anything());
    expect(onLocalAiConnectionTestResult).not.toHaveBeenCalled();
  });

  it("persists shared AI privacy request controls across AI setup and privacy settings", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("tab", { name: /^Profile & info$/i }));
    expect(screen.getByRole("button", { name: /Privacy review/i }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /Privacy review/i }));
    expect(screen.getByRole("region", { name: /AI privacy review/i })).toBeTruthy();
    const requiredFields = screen.getByRole("list", { name: /Required AI classification fields/i });
    const optionalFields = screen.getByRole("list", { name: /Optional AI classification fields/i });
    expect(within(requiredFields).getByText(/App name and basic app context/i)).toBeTruthy();
    expect(within(requiredFields).getByText(/Activity duration/i)).toBeTruthy();
    expect(within(requiredFields).getByText(/Browser or site domain/i)).toBeTruthy();
    expect(within(requiredFields).queryByRole("switch", { name: /Browser or site domain/i })).toBeNull();
    expect(within(requiredFields).getAllByText(/Required/i)).toHaveLength(3);
    expect(within(optionalFields).getByRole("switch", { name: /Site URL/i })).toBeTruthy();
    expect(within(optionalFields).getByRole("switch", { name: /Window title/i })).toBeTruthy();
    expect(within(optionalFields).getByRole("switch", { name: /^Content context$/i })).toBeTruthy();
    const contentContextHelp = within(optionalFields).getByRole("button", { name: /Content context details/i });
    const contentContextTooltipId = contentContextHelp.getAttribute("aria-describedby");
    expect(contentContextTooltipId).toBeTruthy();
    const contentContextTooltip = document.getElementById(contentContextTooltipId ?? "");
    expect(contentContextTooltip?.getAttribute("role")).toBe("tooltip");
    expect(contentContextTooltip?.textContent).toContain("YouTube channel name");
    expect(within(optionalFields).getByRole("switch", { name: /Your saved work profile/i })).toBeTruthy();
    const optionalSwitches = within(optionalFields).getAllByRole("switch");
    expect(optionalSwitches).toHaveLength(4);
    for (const optionalSwitch of optionalSwitches) {
      if (!(optionalSwitch instanceof HTMLInputElement)) throw new Error("Optional privacy controls should render as switches.");
      expect(optionalSwitch.checked).toBe(true);
    }
    for (const helperCopy of REMOVED_PRIVACY_HELPER_COPY) {
      expect(screen.queryByText(helperCopy)).toBeNull();
    }

    const siteUrlSwitch = within(optionalFields).getByRole("switch", { name: /Site URL/i });
    fireEvent.click(siteUrlSwitch);
    expect(JSON.parse(window.localStorage.getItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
      version: 1,
      optional: {
        siteUrl: false,
        windowTitle: true,
        contentContext: true,
        workProfile: true,
      },
    });

    render(<PrivacySettingsSection />);
    fireEvent.click(screen.getByRole("button", { name: /AI data sending/i }));
    const optionalFieldLists = screen.getAllByRole("list", { name: /Optional AI classification fields/i });
    const privacyOptionalFields = optionalFieldLists[optionalFieldLists.length - 1];
    if (!privacyOptionalFields) throw new Error("Privacy settings should render optional AI classification fields.");
    const sharedSiteUrlSwitch = within(privacyOptionalFields).getByRole("switch", { name: /Site URL/i });
    const sharedWindowTitleSwitch = within(privacyOptionalFields).getByRole("switch", { name: /Window title/i });
    const sharedContentContextSwitch = within(privacyOptionalFields).getByRole("switch", { name: /^Content context$/i });
    if (!(sharedSiteUrlSwitch instanceof HTMLInputElement) || !(sharedWindowTitleSwitch instanceof HTMLInputElement) || !(sharedContentContextSwitch instanceof HTMLInputElement)) {
      throw new Error("Shared privacy controls should render as checkbox switches.");
    }
    expect(sharedSiteUrlSwitch.checked).toBe(false);
    expect(sharedWindowTitleSwitch.checked).toBe(true);
    expect(sharedContentContextSwitch.checked).toBe(true);

    expect(screen.queryByRole("button", { name: /Save selection/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reset optional/i })).toBeNull();
    expect(screen.getAllByText(/Raw timeline rows/i)).toHaveLength(2);
    expect(screen.getAllByText(/YouTube descriptions/i)).toHaveLength(2);
  });

  it("falls back to enabled optional AI privacy controls when persisted settings are malformed", () => {
    window.localStorage.setItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, "{broken json");

    renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: /^Profile & info$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Privacy review/i }));

    const optionalFields = screen.getByRole("list", { name: /Optional AI classification fields/i });
    for (const optionalSwitch of within(optionalFields).getAllByRole("switch")) {
      if (!(optionalSwitch instanceof HTMLInputElement)) throw new Error("Optional privacy controls should render as switches.");
      expect(optionalSwitch.checked).toBe(true);
    }
  });

  it("maps legacy disabled title privacy to disabled window title and content context controls", () => {
    window.localStorage.setItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, JSON.stringify({
      version: 1,
      optional: {
        siteUrl: true,
        title: false,
        workProfile: true,
      },
    }));

    renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: /^Profile & info$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Privacy review/i }));

    const optionalFields = screen.getByRole("list", { name: /Optional AI classification fields/i });
    const windowTitleSwitch = within(optionalFields).getByRole("switch", { name: /Window title/i });
    const contentContextSwitch = within(optionalFields).getByRole("switch", { name: /^Content context$/i });
    if (!(windowTitleSwitch instanceof HTMLInputElement) || !(contentContextSwitch instanceof HTMLInputElement)) {
      throw new Error("Legacy privacy controls should render as switches.");
    }
    expect(windowTitleSwitch.checked).toBe(false);
    expect(contentContextSwitch.checked).toBe(false);
  });
});

function chooseOption(container: HTMLElement, comboName: RegExp, optionName: RegExp): void {
  fireEvent.click(within(container).getByRole("combobox", { name: comboName }));
  fireEvent.click(within(container).getByRole("option", { name: optionName }));
}
