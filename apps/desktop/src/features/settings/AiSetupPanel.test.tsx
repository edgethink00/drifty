// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { synchronizeLivingSoulDeclaredContextForUser, updateLivingSoulLearnedState, readLivingSoulForUser } from "../classification/livingSoul";
import { getUserOnboardingStorageKey } from "../onboarding/onboardingState";
import { invokeMock, renderPanel, resetManagedStatusMock, revealItemInDirMock, showPanelSection } from "./AiSetupPanel.testHarness";
import { DEFAULT_LOCAL_AI_SETUP } from "./localAiSetup";
import { DEFAULT_ANALYSIS_AI_SETUP } from "./analysisModelSetup";

const { testCloudAiConnectionMock } = vi.hoisted(() => ({
  testCloudAiConnectionMock: vi.fn(),
}));

vi.mock("./cloudAiConnectionTest", () => ({
  testCloudAiConnection: testCloudAiConnectionMock,
}));

describe("AiSetupPanel", () => {
  // Derived the same way the app derives it, so a change to the scope rule
  // relocates these fixtures instead of silently making them dead files.
  async function soulStorageKeyForUser(ownerId: string): Promise<string> {
    const bytes = new TextEncoder().encode(`drifty-living-soul:${ownerId}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const scope = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `drifty:living-soul:v1:${scope}`;
  }

  beforeEach(() => {
    invokeMock.mockClear();
    resetManagedStatusMock();
    revealItemInDirMock.mockClear();
    testCloudAiConnectionMock.mockClear();
    window.localStorage.clear();
    testCloudAiConnectionMock.mockResolvedValue({ kind: "success", message: "Cloud AI connected in 42 ms." });
  });

  it("editing the shared key in a saved project and title model preserves the main provider and model", () => {
    renderPanel({ initialAnalysisSetup: { ...DEFAULT_ANALYSIS_AI_SETUP, selectionSource: "manual", provider: "cloud" } });
    const advanced = screen.getByText("Project and title model settings").closest("details")!;
    fireEvent.click(within(advanced).getByRole("button", { name: "OpenRouter setup row" }));
    fireEvent.change(within(advanced).getByLabelText("OpenRouter API key"), { target: { value: "shared-test-key" } });
    const summary = screen.getByRole("region", { name: "Model being used" });
    expect(within(summary).getByRole("combobox", { name: "AI provider" }).textContent).toContain("Drifty");
    expect(within(summary).getByRole("combobox", { name: "AI model" }).textContent).toContain("Drifty Cloud");
    const choices = screen.getByRole("group", { name: /AI setup choices/i });
    fireEvent.click(within(choices).getByRole("button", { name: "OpenRouter setup row" }));
    expect(within(choices).getByLabelText("OpenRouter API key")).toHaveProperty("value", "shared-test-key");
    fireEvent.click(within(summary).getByRole("combobox", { name: "AI provider" }));
    fireEvent.click(within(summary).getByRole("option", { name: "OpenRouter" }));
    expect(within(summary).getByRole("combobox", { name: "AI model" }).textContent).toContain("DeepSeek V4 Flash");
  });

  it("offers no separate project and title model by default", () => {
    renderPanel();
    expect(screen.queryByText("Project and title model settings")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Use the default AI connection" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Analysis model being used" })).toBeNull();
    // Settings search for project analysis still lands on the one connection selector.
    expect(document.querySelectorAll('[data-setting-id="settings.ai.intelligence"]')).toHaveLength(1);
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

    // The sidebar picks the AI section, so the panel shows its title and no internal tabs.
    expect(screen.getByRole("heading", { name: /^AI connection$/ })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
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
    // The automatic shared route adds no copy or repeated model rows.
    expect(screen.queryByRole("region", { name: "AI processing locations" })).toBeNull();
    expect(screen.queryByText("Projects and Day/Week titles", { exact: true })).toBeNull();
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

  it("shows an explicit project and title model beside its toggle without repeating task rows", () => {
    const onAnalysisChange = vi.fn();
    renderPanel({
      initialAnalysisSetup: { ...DEFAULT_ANALYSIS_AI_SETUP, selectionSource: "manual", provider: "anthropic", anthropicModel: "claude-test" },
      onAnalysisChange,
    });
    const toggle = screen.getByText("Project and title model settings").closest("summary")!;
    expect(within(toggle).getByText("Anthropic · claude-test")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "AI processing locations" })).toBeNull();
    expect(onAnalysisChange).not.toHaveBeenCalled();
  });

  it("removes a saved project and title model once the default connection is restored", () => {
    const onAnalysisChange = vi.fn();
    renderPanel({
      initialAnalysisSetup: { ...DEFAULT_ANALYSIS_AI_SETUP, selectionSource: "manual", provider: "cloud" },
      onAnalysisChange,
    });
    expect(screen.getByRole("region", { name: "Analysis model being used" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use the default AI connection" }));
    expect(onAnalysisChange).toHaveBeenCalledWith(expect.objectContaining({ selectionSource: "automatic" }));
    expect(screen.queryByText("Project and title model settings")).toBeNull();
    expect(screen.queryByRole("region", { name: "Analysis model being used" })).toBeNull();
  });

  it("discloses Cloud recovery by task even when the saved analysis choice is automatic", () => {
    renderPanel({
      initialSetup: { ...DEFAULT_LOCAL_AI_SETUP, provider: "openrouter_byok", openRouterApiKey: "test-key" },
      initialAnalysisSetup: { ...DEFAULT_ANALYSIS_AI_SETUP, selectionSource: "automatic", provider: "openrouter" },
      effectiveAnalysisSetup: { ...DEFAULT_ANALYSIS_AI_SETUP, selectionSource: "automatic", provider: "cloud" },
    });
    const routes = screen.getByRole("region", { name: "AI processing locations" });
    expect(within(routes).getByText(/^OpenRouter ·/)).toBeTruthy();
    expect(within(routes).getByText("Drifty Cloud")).toBeTruthy();
  });

  it("keeps a custom endpoint visually unready when its Base URL is invalid", () => {
    renderPanel({
      initialSetup: {
        ...DEFAULT_LOCAL_AI_SETUP,
        selfHostedBaseUrl: "not-a-url",
        selfHostedModel: "gpt-5-mini",
      },
    });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI provider$/i }));

    expect(within(modelBeingUsed).getByRole("option", { name: /^Custom endpoint$/i }).classList.contains("is-muted")).toBe(true);
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

    showPanelSection("memory");
    const memoryOverview = screen.getByLabelText(/Drifty Memory overview/i);
    expect(within(memoryOverview).getByRole("heading", { name: "Work profile" })).toBeTruthy();
    expect(await within(memoryOverview).findByText("Coding")).toBeTruthy();
    expect(within(memoryOverview).getByText("Coding")).toBeTruthy();
    expect(within(memoryOverview).getByText("Writing")).toBeTruthy();
    expect(within(memoryOverview).getByRole("heading", { name: "Learned patterns" })).toBeTruthy();
    const editButton = within(memoryOverview).getByRole("button", { name: /^Edit$/i });
    fireEvent.click(editButton);
    // The editor replaces the summary and takes focus on its first choice.
    expect(within(memoryOverview).queryByRole("button", { name: /^Edit$/i })).toBeNull();
    expect(document.activeElement?.textContent).toBe("Coding");
    expect((within(memoryOverview).getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(true);
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
    fireEvent.click(within(memoryOverview).getByRole("button", { name: /^Save$/ }));

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
    // A successful save closes the editor back to the saved-value summary.
    const savedActivities = await within(memoryOverview).findByLabelText("Selected work activities");
    expect(within(memoryOverview).getByText("Saved. Used from the next classification.")).toBeTruthy();
    expect(document.activeElement).toBe(within(memoryOverview).getByRole("button", { name: /^Edit$/i }));
    expect(within(savedActivities).getByText("Data Analysis")).toBeTruthy();
    expect(within(savedActivities).getByText("Designing")).toBeTruthy();
    expect(screen.queryByText("Coding, Writing, Data Analysis in AI")).toBeNull();
    expect(screen.queryByText(/User work profile:/i)).toBeNull();
  });

  it("discards an unsaved work profile draft on cancel and when the editor reopens", async () => {
    window.localStorage.setItem(getUserOnboardingStorageKey("local"), JSON.stringify({
      version: 2,
      completed: true,
      displayName: "",
      workType: "Coding",
      workTypeOther: "",
      workDomain: null,
      workDomainOther: "",
      jobType: "Coding",
      jobTypeOther: "",
      workDescription: "",
      driftAlarmEnabled: false,
      extremeNudgeEnabled: false,
      focusGoalHours: null,
      driftThresholdMinutes: null,
      purpose: null,
      completedAt: "2026-06-15T00:00:00.000Z",
    }));

    renderPanel();
    showPanelSection("memory");
    const memoryOverview = screen.getByLabelText(/Drifty Memory overview/i);
    fireEvent.click(await within(memoryOverview).findByRole("button", { name: /^Edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Designing" }));
    expect((within(memoryOverview).getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(within(memoryOverview).getByRole("button", { name: /^Cancel$/ }));
    const savedActivities = within(memoryOverview).getByLabelText("Selected work activities");
    expect(within(savedActivities).queryByText("Designing")).toBeNull();
    expect(document.activeElement).toBe(within(memoryOverview).getByRole("button", { name: /^Edit$/i }));

    fireEvent.click(within(memoryOverview).getByRole("button", { name: /^Edit$/i }));
    expect(screen.getByRole("button", { name: "Designing" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Designing" }));
    // Escape that ends a Korean IME composition must not discard the editor.
    fireEvent.keyDown(screen.getByLabelText(/tell us more about your work/i), { key: "Escape", isComposing: true });
    expect(within(memoryOverview).queryByRole("button", { name: /^Edit$/i })).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Designing" }), { key: "Escape" });
    expect(within(memoryOverview).getByRole("button", { name: /^Edit$/i })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(getUserOnboardingStorageKey("local")) ?? "{}")).toMatchObject({ jobType: "Coding" });
  });

  it("names the missing initial setup instead of asking for activities the user already chose", () => {
    renderPanel();
    showPanelSection("memory");
    const memoryOverview = screen.getByLabelText(/Drifty Memory overview/i);
    fireEvent.click(within(memoryOverview).getByRole("button", { name: /^Add work$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Designing" }));
    fireEvent.click(within(memoryOverview).getByRole("button", { name: /^Save$/ }));

    // Without a completed onboarding record the save is refused on purpose.
    expect(within(memoryOverview).getByText("Finish the initial setup to save your work profile.")).toBeTruthy();
    expect(within(memoryOverview).queryByText(/Choose a work activity/i)).toBeNull();
    expect(window.localStorage.getItem(getUserOnboardingStorageKey("local"))).toBeNull();
  });

  it("shows the current Living Soul revision and learned pattern summaries", async () => {
    window.localStorage.setItem(await soulStorageKeyForUser("local"), [
      "---",
      "schema: drifty.soul/v1",
      "revision: 7",
      "created_at: 2026-09-01T00:00:00.000Z",
      "updated_at: 2026-09-05T00:00:00.000Z",
      "last_feedback_at: 2026-09-05T00:00:00.000Z",
      "---",
      "# Living Soul",
      "",
      "## Declared work context",
      "- Work activities: Coding, Writing",
      "- Work domain: Not provided",
      "- Work description: I build product features.",
      "- Drifty purpose: Protect focus",
      "",
      "## Learned work-support patterns",
      "- [confidence=medium; evidence=4; last=2026-09-05T00:00:00.000Z] Product research before implementation is usually work support.",
      "",
      "## Learned drift patterns",
      "- [confidence=low; evidence=2; last=2026-09-04T00:00:00.000Z] Long entertainment browsing is usually drift.",
      "",
      "## Ambiguities",
      "- None yet.",
      "",
      "## Passive contextual priors",
      "- None yet.",
      "",
    ].join("\n"));

    renderPanel();
    showPanelSection("memory");

    expect(await screen.findByText("Product research before implementation is usually work support.")).toBeTruthy();
    expect(screen.getByText("Product research before implementation is usually work support.")).toBeTruthy();
    expect(screen.getByText("Long entertainment browsing is usually drift.")).toBeTruthy();
    expect(screen.getByText("2 learned patterns")).toBeTruthy();
    const research = screen.getByRole("article", { name: "Product research before implementation is usually work support." });
    fireEvent.click(within(research).getByRole("button", { name: "Details" }));
    expect(within(research).getByText("What this is based on")).toBeTruthy();
    expect(within(research).getByText(/older pattern has no linked correction record/)).toBeTruthy();
    fireEvent.click(within(research).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(research).getByRole("textbox"), { target: { value: "Specific product research supports my work." } });
    fireEvent.click(within(research).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Specific product research supports my work.")).toBeTruthy();
    expect(await screen.findByText("Edited by you")).toBeTruthy();
    const edited = screen.getByRole("article", { name: "Specific product research supports my work." });
    fireEvent.click(within(edited).getByRole("button", { name: "Details" }));
    fireEvent.click(within(edited).getByRole("button", { name: "Forget" }));
    // The outcome takes the count's place beside the heading, then gives it back
    // after six seconds, like a rule result in My classifications.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
    try {
      fireEvent.click(within(edited).getByRole("button", { name: "Forget" }));
      await waitFor(() => expect(screen.queryByText("Specific product research supports my work.")).toBeNull());
      const status = within(screen.getByRole("heading", { name: "Learned patterns" }).parentElement as HTMLElement).getByRole("status");
      expect(status.textContent).toMatch(/^Pattern forgotten\./);
      act(() => { vi.advanceTimersByTime(6000); });
      expect(status.textContent).toBe("1 learned patterns");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps feedback and restoration reachable after rejecting the last active memory and reopening Settings", async () => {
    const initial = await synchronizeLivingSoulDeclaredContextForUser("local");
    const summary = "Product research supports this work task.";
    await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: initial.document.revision,
      learned: { workSupport: [{ summary, confidence: "low", evidenceCount: 1, lastObservedAt: "2026-10-04T00:00:00.000Z" }], drift: [], ambiguities: [] },
      feedbackAt: "2026-10-04T00:00:00.000Z" });
    const panel = renderPanel();
    showPanelSection("memory");
    const card = await screen.findByRole("article", { name: summary });
    await waitFor(() => expect(within(card).getByRole("button", { name: "Right" })).not.toHaveProperty("disabled", true));
    fireEvent.click(within(card).getByRole("button", { name: "Right" }));
    expect(await within(card).findByText("Confirmed by you")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Confirmed" }).getAttribute("aria-pressed")).toBe("true");
    // The outcome takes the count's place beside the heading instead of a banner
    // inserted above the list, so the pattern under the pointer stays put. The
    // card opens with the patterns themselves, with no note line above them.
    const learnedHead = () => screen.getByRole("heading", { name: "Learned patterns" }).parentElement as HTMLElement;
    expect(within(learnedHead()).getByRole("status").textContent).toMatch(/^Confirmed\. Automatic learning/);
    expect(document.querySelector(".memory-patterns > :not(.memory-card)")).toBeNull();
    expect(document.querySelector(".memory-patterns > .memory-card > :first-child")?.className).toBe("memory-list");
    fireEvent.click(within(card).getByRole("button", { name: "Not right" }));
    expect(await screen.findByText(/No active learned patterns/)).toBeTruthy();
    expect(within(learnedHead()).getByRole("button", { name: "Undo" })).toBeTruthy();
    panel.unmount();
    renderPanel();
    showPanelSection("memory");
    const excluded = await screen.findByText("Excluded patterns · 1");
    fireEvent.click(excluded);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    const restored = await screen.findByRole("button", { name: "Confirmed" });
    expect(restored.getAttribute("aria-pressed")).toBe("true");
    const saved = await readLivingSoulForUser("local");
    expect(saved.state === "ready" && saved.context.document.learned.workSupport[0].evidenceCount).toBe(1);
  });

  it("loads the latest Memory in place when another writer changed it first", async () => {
    const initial = await synchronizeLivingSoulDeclaredContextForUser("local");
    const first = "Product research supports this work task.";
    const second = "Release notes writing counts as work.";
    const pattern = (summary: string) => ({ summary, confidence: "low" as const, evidenceCount: 1, lastObservedAt: "2026-10-04T00:00:00.000Z" });
    await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: initial.document.revision,
      learned: { workSupport: [pattern(first)], drift: [], ambiguities: [] }, feedbackAt: "2026-10-04T00:00:00.000Z" });
    renderPanel();
    showPanelSection("memory");
    const card = await screen.findByRole("article", { name: first });
    await waitFor(() => expect(within(card).getByRole("button", { name: "Right" })).not.toHaveProperty("disabled", true));

    // Another writer adds a pattern after this view loaded, so its revision is stale.
    const latest = await readLivingSoulForUser("local");
    if (latest.state !== "ready") throw new Error("Expected readable Memory");
    await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: latest.context.document.revision,
      learned: { workSupport: [pattern(first), pattern(second)], drift: [], ambiguities: [] }, feedbackAt: "2026-10-04T00:00:01.000Z" });

    fireEvent.click(within(card).getByRole("button", { name: "Right" }));
    expect(await screen.findByText(/Memory changed elsewhere/)).toBeTruthy();
    expect(await screen.findByRole("article", { name: second })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Refresh$/ })).toBeNull();
  });

  it("exposes Memory regions to assistive technology", async () => {
    window.localStorage.setItem(getUserOnboardingStorageKey("local"), JSON.stringify({
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
      petModeEnabled: false,
      browserHistoryBootstrapEnabled: false,
      focusGoalHours: null,
      driftThresholdMinutes: null,
      purpose: "protect_focus",
      completedAt: "2026-06-15T00:00:00.000Z",
    }));
    window.localStorage.setItem(await soulStorageKeyForUser("local"), [
      "---",
      "schema: drifty.soul/v1",
      "revision: 2",
      "created_at: 2026-09-01T00:00:00.000Z",
      "updated_at: 2026-09-05T00:00:00.000Z",
      "last_feedback_at: null",
      "---",
      "# Living Soul",
      "",
      "## Declared work context",
      "- Work activities: Coding",
      "- Work domain: Not provided",
      "- Work description: Not provided",
      "- Drifty purpose: Protect focus",
      "",
      "## Learned work-support patterns",
      "- [confidence=low; evidence=1; last=2026-09-05T00:00:00.000Z] Research before building is usually work.",
      "",
      "## Learned drift patterns",
      "- None yet.",
      "",
      "## Ambiguities",
      "- None yet.",
      "",
      "## Passive contextual priors",
      "- None yet.",
      "",
    ].join("\n"));

    renderPanel();
    showPanelSection("memory");

    // An aria-label on a plain div is dropped by screen readers, so these
    // groupings must keep real roles rather than labels alone.
    const overview = await screen.findByRole("region", { name: /Drifty Memory overview/i });
    // Wait for the Soul read to resolve before asserting the loaded regions.
    await within(overview).findByText("Research before building is usually work.");
    expect(within(overview).getByRole("list", { name: /Selected work activities/i })).toBeTruthy();
  });

  it("does not present an unreadable Soul document as a healthy empty Memory", async () => {
    // A Soul file exists but its frontmatter is corrupt, so the parser rejects it.
    window.localStorage.setItem(await soulStorageKeyForUser("local"), [
      "---",
      "schema: drifty.soul/v1",
      "revision: not-a-number",
      "---",
      "# Living Soul",
      "",
    ].join("\n"));

    renderPanel();
    showPanelSection("memory");

    // Claiming "Ready to learn" here would tell the user nothing is stored yet,
    // while saved learning actually exists on disk and cannot be read.
    expect(await screen.findByText("Saved learning cannot be read")).toBeTruthy();
    expect(screen.queryByText("Ready to learn")).toBeNull();
    // The learned row must explain the failure rather than claim emptiness,
    // and must not advertise a pattern count it cannot back up.
    expect(screen.getByText("Saved learning cannot be read")).toBeTruthy();
    expect(screen.queryByText("No learned patterns yet")).toBeNull();
    expect(screen.queryByText(/learned patterns$/)).toBeNull();
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
        openaiApiKey: "",
        openaiModel: "gpt-6-luna",
        anthropicApiKey: "",
        anthropicModel: "claude-haiku-5-5",
        selfHostedBaseUrl: "http://localhost:11434/v1",
        selfHostedApiKey: "",
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
        openaiApiKey: "",
        openaiModel: "gpt-6-luna",
        anthropicApiKey: "",
        anthropicModel: "claude-haiku-5-5",
        selfHostedBaseUrl: "http://localhost:11434/v1",
        selfHostedApiKey: "",
        selfHostedModel: "",
      },
    });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    expect(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }).textContent).toContain("Drifty Cloud");
    fireEvent.click(screen.getByRole("button", { name: /test ai connection/i }));

    expect(await screen.findByText(/Cloud AI connected in 42 ms/i)).toBeTruthy();
    expect(testCloudAiConnectionMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalledWith("ai_classification_openai_chat", expect.anything());
    expect(onLocalAiConnectionTestResult).not.toHaveBeenCalled();
  });

  it("keeps the AI privacy review out of Memory", () => {
    renderPanel();

    showPanelSection("memory");
    expect(screen.queryByRole("button", { name: /Privacy review/i })).toBeNull();
    expect(screen.queryByRole("region", { name: /AI privacy review/i })).toBeNull();
    expect(screen.getByRole("heading", { name: "Work profile" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Add work$/i })).toBeTruthy();
  });
});

describe("AiSetupPanel direct providers", () => {
  beforeEach(() => window.localStorage.clear());

  it("lists OpenRouter, OpenAI, Anthropic and the custom endpoint as setup rows", () => {
    renderPanel();
    const choices = screen.getByRole("group", { name: /AI setup choices/i });
    expect(within(choices).getAllByRole("button", { name: /setup row$/ }).map((row) => row.getAttribute("aria-label")))
      .toEqual(["OpenRouter setup row", "OpenAI setup row", "Anthropic setup row", "Custom endpoint setup row"]);
  });

  it("activates a provider when its key is typed and keeps the default model", () => {
    const { getLocalAiSetup } = renderPanel();
    const choices = screen.getByRole("group", { name: /AI setup choices/i });
    fireEvent.click(within(choices).getByRole("button", { name: "Anthropic setup row" }));
    fireEvent.change(within(choices).getByLabelText("Anthropic API key"), { target: { value: "sk-ant-test" } });
    expect(getLocalAiSetup()).toMatchObject({ provider: "anthropic", anthropicApiKey: "sk-ant-test", anthropicModel: "claude-haiku-5-5" });
    const summary = screen.getByRole("region", { name: "Model being used" });
    expect(within(summary).getByRole("combobox", { name: "AI provider" }).textContent).toContain("Anthropic");
  });

  it("opens an unkeyed provider's card from the dropdown without switching to it", () => {
    const { getLocalAiSetup } = renderPanel();
    const summary = screen.getByRole("region", { name: "Model being used" });
    chooseOption(summary, /^AI provider$/i, /^OpenAI$/i);
    expect(screen.getByRole("group", { name: "OpenAI settings" })).toBeTruthy();
    expect(getLocalAiSetup().provider).toBe("managed_local");
  });

  it("switches to a provider that already has a key and shows its model", () => {
    renderPanel({ initialSetup: { ...DEFAULT_LOCAL_AI_SETUP, openaiApiKey: "sk-openai-test", openaiModel: "gpt-5-mini" } });
    const summary = screen.getByRole("region", { name: "Model being used" });
    chooseOption(summary, /^AI provider$/i, /^OpenAI$/i);
    expect(within(summary).getByRole("combobox", { name: "AI provider" }).textContent).toContain("OpenAI");
    expect(within(summary).getByRole("combobox", { name: "AI model" }).textContent).toContain("GPT-5 mini");
  });

  it("edits the model of the connection without changing the key", () => {
    const { getLocalAiSetup } = renderPanel({ initialSetup: { ...DEFAULT_LOCAL_AI_SETUP, provider: "openai", openaiApiKey: "sk-openai-test" } });
    const choices = screen.getByRole("group", { name: /AI setup choices/i });
    fireEvent.click(within(choices).getByRole("button", { name: "OpenAI setup row" }));
    fireEvent.change(within(choices).getByLabelText("OpenAI model id"), { target: { value: "gpt-5-mini" } });
    expect(getLocalAiSetup()).toMatchObject({ provider: "openai", openaiApiKey: "sk-openai-test", openaiModel: "gpt-5-mini" });
  });
});

function chooseOption(container: HTMLElement, comboName: RegExp, optionName: RegExp): void {
  fireEvent.click(within(container).getByRole("combobox", { name: comboName }));
  fireEvent.click(within(container).getByRole("option", { name: optionName }));
}

describe("unused Cloud trial activation", () => {
  it("requires an explicit start and switches the classification provider only after success", async () => {
    let finish!: (success: boolean) => void;
    const onStartCloudTrial = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    renderPanel({ cloudTrialAvailable: true, onStartCloudTrial, currentBillingPlan: "free", billingEntitlementStatus: "locked",
      initialSetup: { ...DEFAULT_LOCAL_AI_SETUP, provider: "openrouter_byok", openRouterApiKey: "sk-or-test" } });
    expect(onStartCloudTrial).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start 7-day free trial" }));
    const summary = screen.getByRole("region", { name: "Model being used" });
    expect(within(summary).getByRole("combobox", { name: "AI provider" }).textContent).toContain("OpenRouter");
    finish(true);
    await waitFor(() => expect(within(summary).getByRole("combobox", { name: "AI provider" }).textContent).toContain("Drifty"));
    expect(onStartCloudTrial).toHaveBeenCalledOnce();
  });

  it("starts the trial on the connection from the Intelligence settings page too, leaving no separate project model", async () => {
    const onAnalysisChange = vi.fn();
    const onStartCloudTrial = vi.fn().mockResolvedValue(true);
    renderPanel({ section: "intelligence", cloudTrialAvailable: true, onStartCloudTrial, currentBillingPlan: "free", billingEntitlementStatus: "locked", onAnalysisChange,
      initialSetup: { ...DEFAULT_LOCAL_AI_SETUP, provider: "openrouter_byok", openRouterApiKey: "sk-or-test" } });
    fireEvent.click(screen.getByRole("button", { name: "Start 7-day free trial" }));
    const summary = screen.getByRole("region", { name: "Model being used" });
    await waitFor(() => expect(within(summary).getByRole("combobox", { name: "AI provider" }).textContent).toContain("Drifty"));
    expect(onAnalysisChange).not.toHaveBeenCalled();
  });

  it("keeps the current local/BYOK provider after activation failure", async () => {
    const onStartCloudTrial = vi.fn().mockResolvedValue(false);
    renderPanel({ cloudTrialAvailable: true, onStartCloudTrial, currentBillingPlan: "free", billingEntitlementStatus: "locked",
      initialSetup: { ...DEFAULT_LOCAL_AI_SETUP, provider: "openrouter_byok", openRouterApiKey: "sk-or-test" } });
    fireEvent.click(screen.getByRole("button", { name: "Start 7-day free trial" }));
    await waitFor(() => expect(onStartCloudTrial).toHaveBeenCalledOnce());
    const summary = screen.getByRole("region", { name: "Model being used" });
    expect(within(summary).getByRole("combobox", { name: "AI provider" }).textContent).toContain("OpenRouter");
  });
});
