// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserOnboardingStorageKey } from "../onboarding/onboardingState";
import { invokeMock, renderPanel, resetManagedStatusMock, revealItemInDirMock } from "./AiSetupPanel.testHarness";
import { DEFAULT_LOCAL_AI_SETUP } from "./localAiSetup";

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

  it("switches between the OpenRouter and custom endpoint setup rows", () => {
    // Pre-configure OpenRouter + Custom so both are ready to become the active provider
    // (an unready provider only expands its card — covered by the test below).
    renderPanel({
      initialSetup: {
        ...DEFAULT_LOCAL_AI_SETUP,
        openRouterApiKey: "sk-or-test-key",
        selfHostedBaseUrl: "https://api.openai.com/v1",
        selfHostedModel: "gpt-5-mini",
      },
    });

    const setupTabs = screen.getByRole("tablist", { name: /AI setup sections/i });
    expect(within(setupTabs).getByRole("tab", { name: /^Classification$/i }).getAttribute("aria-selected")).toBe("true");
    expect(within(setupTabs).getByRole("tab", { name: /^Intelligence$/i }).getAttribute("aria-selected")).toBe("false");
    expect(within(setupTabs).getByRole("tab", { name: /^Memory$/i }).getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByRole("button", { name: /^Work profile$/i })).toBeNull();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    const providerSelect = within(modelBeingUsed).getByRole("combobox", { name: /^AI provider$/i });
    const modelSelect = within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i });
    expect(providerSelect.textContent).toContain("Drifty");
    expect(modelSelect.textContent).toContain("Drifty Cloud");

    // The Drifty provider is managed entirely from the dropdown; only OpenRouter and
    // Custom endpoint have provider cards, and neither is expanded on a fresh setup.
    const sectionChoices = screen.getByRole("group", { name: /AI setup choices/i });
    expect(within(sectionChoices).queryByRole("button", { name: /^Drifty setup row$/i })).toBeNull();
    const openRouterRow = within(sectionChoices).getByRole("button", { name: /^OpenRouter setup row$/i });
    const customRow = within(sectionChoices).getByRole("button", { name: /^Custom endpoint setup row$/i });
    expect(openRouterRow.getAttribute("aria-expanded")).toBe("false");
    expect(customRow.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: /OpenRouter BYOK settings/i })).toBeNull();
    expect(screen.queryByRole("group", { name: /Custom endpoint settings/i })).toBeNull();

    fireEvent.click(openRouterRow);
    expect(openRouterRow.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: /OpenRouter BYOK settings/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /Custom endpoint settings/i })).toBeNull();

    chooseOption(modelBeingUsed, /^AI provider$/i, /^OpenRouter$/i);
    expect(providerSelect.textContent).toContain("OpenRouter");
    expect(modelSelect.textContent).toContain("DeepSeek V4 Flash");
    expect(screen.getByRole("group", { name: /OpenRouter BYOK settings/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /Custom endpoint settings/i })).toBeNull();

    chooseOption(modelBeingUsed, /^AI model$/i, /^MiMo V2\.5$/i);
    expect(modelSelect.textContent).toContain("MiMo V2.5");

    fireEvent.click(customRow);
    expect(customRow.getAttribute("aria-expanded")).toBe("true");
    expect(providerSelect.textContent).toContain("OpenRouter");
    expect(modelSelect.textContent).toContain("MiMo V2.5");
    expect(screen.getByRole("group", { name: /Custom endpoint settings/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /OpenRouter BYOK settings/i })).toBeNull();

    chooseOption(modelBeingUsed, /^AI provider$/i, /^Custom endpoint$/i);
    expect(providerSelect.textContent).toContain("Custom endpoint");
    expect(modelSelect.textContent).toContain("Custom endpoint");
    expect(screen.getByRole("group", { name: /Custom endpoint settings/i })).toBeTruthy();
  });

  it("expands an unconfigured provider's card from the dropdown without committing to it", () => {
    renderPanel();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    const providerSelect = within(modelBeingUsed).getByRole("combobox", { name: /^AI provider$/i });
    expect(providerSelect.textContent).toContain("Drifty");

    chooseOption(modelBeingUsed, /^AI provider$/i, /^OpenRouter$/i);

    // OpenRouter has no key yet → stay on Drifty, just expand its Configure card.
    expect(providerSelect.textContent).toContain("Drifty");
    expect(providerSelect.textContent).not.toContain("OpenRouter");
    expect(screen.getByRole("group", { name: /OpenRouter BYOK settings/i })).toBeTruthy();
  });

  it("collapses the expanded provider when its bar is clicked again", () => {
    renderPanel();

    const sectionChoices = screen.getByRole("group", { name: /AI setup choices/i });
    const openRouterRow = within(sectionChoices).getByRole("button", { name: /^OpenRouter setup row$/i });
    // No provider card is expanded by default on a fresh (managed local) setup, so
    // expand OpenRouter first, then toggle it closed again.
    expect(openRouterRow.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: /OpenRouter BYOK settings/i })).toBeNull();

    fireEvent.click(openRouterRow);
    expect(openRouterRow.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: /OpenRouter BYOK settings/i })).toBeTruthy();

    fireEvent.click(openRouterRow);
    expect(openRouterRow.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: /OpenRouter BYOK settings/i })).toBeNull();
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
      workDescription: "I build and write about product features.",
      driftAlarmEnabled: false,
      extremeNudgeEnabled: false,
      focusGoalHours: null,
      driftThresholdMinutes: null,
      purpose: null,
      completedAt: "2026-06-15T00:00:00.000Z",
    }));

    renderPanel();

    fireEvent.click(screen.getByRole("tab", { name: /^Memory$/i }));
    const memoryInputs = screen.getByLabelText(/Memory sources/i);
    expect(within(memoryInputs).getByText("Work profile")).toBeTruthy();
    expect(within(memoryInputs).getByText("Main activities and one description you can edit here.")).toBeTruthy();
    expect(within(memoryInputs).getByText("Learned patterns")).toBeTruthy();
    expect(within(memoryInputs).getByText("Short patterns from corrections and repeated context, not a copy of your timeline.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Work profile$/i }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /^Work profile$/i }));
    expect(screen.getByRole("button", { name: /^Work profile$/i }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("region", { name: /^Model being used$/i })).toBeNull();
    expect(screen.queryByText("Coding, Writing in Product development")).toBeNull();
    expect(screen.queryByText(/User work profile:/i)).toBeNull();
    expect(screen.queryByText(/AI prompt line/i)).toBeNull();
    expect(screen.queryByText(/^Source$/i)).toBeNull();

    expect(screen.getByRole("button", { name: "Coding" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Writing" }).getAttribute("aria-pressed")).toBe("true");
    const workDescription = screen.getByLabelText(/tell us more about your work/i);
    expect(screen.queryByRole("combobox", { name: /add work activity/i })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /your field/i })).toBeNull();
    if (!(workDescription instanceof HTMLTextAreaElement)) throw new Error("Work description should render as a textarea.");
    expect(workDescription.value).toBe("I build and write about product features.");
    fireEvent.click(screen.getByRole("button", { name: "Data Analysis" }));
    expect(screen.getByRole("button", { name: "Data Analysis" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Designing" }));
    expect(screen.getByRole("button", { name: "Designing" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "Operations" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(workDescription, { target: { value: "I build product features and help customers." } });

    expect(screen.queryByText("Coding, Writing, Data Analysis in AI")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /save work profile/i }));

    const savedState = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Record<string, unknown>;
    expect(savedState).toMatchObject({
      workType: "Coding",
      workTypeOther: "",
      jobType: "Coding, Writing, Data Analysis, Designing",
      jobTypeOther: "",
      workDomain: null,
      workDomainOther: "",
      workDescription: "I build product features and help customers.",
    });
    expect(screen.getByRole("status").textContent).toContain("Memory updated");
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

  it("keeps stale OpenRouter selections visible but demotes them from strict privacy", () => {
    renderPanel({
      initialSetup: {
        provider: "openrouter_byok",
        driftyRoute: "cloud",
        managedLocalModelId: "drifty-qwen3-5-4b-default",
        managedLocalBaseUrl: "",
        managedLocalModel: "",
        openRouterApiKey: "",
        openRouterModel: "qwen/qwen3.6-flash",
        openRouterFallbackModels: ["deepseek/deepseek-v4-flash:free", "custom/provider-model"],
        selfHostedBaseUrl: "http://localhost:11434/v1",
        selfHostedModel: "",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Choose OpenRouter models/i }));
    const dialog = screen.getByRole("dialog", { name: /OpenRouter models/i });

    const qwenChoice = within(dialog).getByLabelText("Select qwen/qwen3.6-flash").closest(".model-picker-choice");
    const freeChoice = within(dialog).getByLabelText("Select deepseek/deepseek-v4-flash:free").closest(".model-picker-choice");
    const customChoice = within(dialog).getByLabelText("Select custom/provider-model").closest(".model-picker-choice");
    if (!(qwenChoice instanceof HTMLElement) || !(freeChoice instanceof HTMLElement) || !(customChoice instanceof HTMLElement)) {
      throw new Error("Expected selected OpenRouter model choices.");
    }

    expect(qwenChoice.textContent).toContain("Unavailable with strict privacy");
    expect(qwenChoice.textContent).toContain("No ZDR");
    const qwenSelect = within(qwenChoice).getByLabelText("Select qwen/qwen3.6-flash").closest(".model-picker-choice__select");
    const qwenBadges = qwenChoice.querySelector(".model-picker-choice__badges");
    const qwenPrimary = qwenChoice.querySelector(".model-picker-choice__primary");
    if (!qwenSelect || !qwenBadges || !qwenPrimary) throw new Error("Expected model choice controls to be grouped.");
    expect(qwenSelect.contains(qwenBadges)).toBe(true);
    expect(qwenPrimary.textContent).toBe("Primary");
    expect(freeChoice.textContent).toContain("Unavailable with strict privacy");
    expect(freeChoice.textContent).toContain("No ZDR");
    expect(customChoice.textContent).toContain("Other model");
    expect(customChoice.textContent).not.toContain("ZDR");
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
    expect(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }).textContent).toContain("Drifty Cloud");
    fireEvent.click(screen.getByRole("button", { name: /test ai connection/i }));

    expect(await screen.findByText(/Cloud AI connected via Google in 42 ms/i)).toBeTruthy();
    expect(testCloudAiConnectionMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalledWith("ai_classification_openai_chat", expect.anything());
    expect(onLocalAiConnectionTestResult).not.toHaveBeenCalled();
  });

  it("keeps the AI privacy review out of Memory", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("tab", { name: /^Memory$/i }));
    expect(screen.queryByRole("button", { name: /Privacy review/i })).toBeNull();
    expect(screen.queryByRole("region", { name: /AI privacy review/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^Work profile$/i })).toBeTruthy();
  });
});

function chooseOption(container: HTMLElement, comboName: RegExp, optionName: RegExp): void {
  fireEvent.click(within(container).getByRole("combobox", { name: comboName }));
  fireEvent.click(within(container).getByRole("option", { name: optionName }));
}
