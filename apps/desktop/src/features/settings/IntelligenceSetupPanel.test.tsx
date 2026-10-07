// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntelligenceSetupPanel, type IntelligenceSetupPanelProps } from "./IntelligenceSetupPanel";
import { DEFAULT_ANALYSIS_AI_SETUP, type AnalysisAiSetupState } from "./analysisModelSetup";

const { testOpenAiCompatibleConnectionMock, testLocalAiConnectionMock } = vi.hoisted(() => ({
  testOpenAiCompatibleConnectionMock: vi.fn(),
  testLocalAiConnectionMock: vi.fn(),
}));

vi.mock("./aiConnectionTest", () => ({
  testOpenAiCompatibleConnection: testOpenAiCompatibleConnectionMock,
  testLocalAiConnection: testLocalAiConnectionMock,
}));

function buildSetup(overrides: Partial<AnalysisAiSetupState> = {}): AnalysisAiSetupState {
  return { ...DEFAULT_ANALYSIS_AI_SETUP, ...overrides };
}

function renderPanel(overrides: Partial<IntelligenceSetupPanelProps> = {}) {
  const props: IntelligenceSetupPanelProps = {
    setup: buildSetup(),
    onChange: vi.fn(),
    openRouterConnected: false,
    // Default to a subscribed (active) plan so the Drifty Cloud model is selectable.
    cloudSelectable: true,
    cloudSubscribeActionLabel: null,
    cloudSubscribeActionDisabled: false,
    canManageBilling: true,
    onStartCloudSetup: vi.fn(),
    onManageCloudBilling: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<IntelligenceSetupPanel {...props} />) };
}

function summaryRegion() {
  return screen.getByRole("region", { name: /Analysis model being used/i });
}

describe("IntelligenceSetupPanel", () => {
  beforeEach(() => {
    testLocalAiConnectionMock.mockReset();
    testLocalAiConnectionMock.mockResolvedValue({ kind: "success", message: "Connected in 18 ms." });
    testOpenAiCompatibleConnectionMock.mockReset();
    testOpenAiCompatibleConnectionMock.mockResolvedValue({ kind: "success", message: "Connected in 18 ms." });
  });

  it("tests OpenRouter with the shared key and Intelligence primary and fallback models", async () => {
    renderPanel({ setup: buildSetup({ provider: "openrouter", openRouterModel: "sample/analysis", openRouterFallbackModels: ["sample/fallback"] }), openRouterApiKey: "sample-shared-key" });
    fireEvent.click(within(summaryRegion()).getByRole("button", { name: "Test AI connection" }));
    await waitFor(() => expect(testLocalAiConnectionMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openrouter_byok", openRouterApiKey: "sample-shared-key",
      openRouterModel: "sample/analysis", openRouterFallbackModels: ["sample/fallback"],
    })));
    expect(await within(summaryRegion()).findByText("Connected in 18 ms.")).toBeTruthy();
  });

  it("summarizes the Drifty Cloud provider as always-available with a managed model", () => {
    renderPanel({ setup: buildSetup({ provider: "cloud" }) });

    const summary = summaryRegion();
    // "Drifty Cloud" appears in both the status row and the provider select.
    expect(within(summary).getAllByText("Drifty Cloud").length).toBeGreaterThan(0);
    expect(within(summary).getAllByText("Drifty Cloud")[0]).toBeTruthy();
    expect(within(summary).getByText("Available")).toBeTruthy();

    // Drifty Cloud needs no configuration, so it has no provider card and
    // nothing is expanded — other providers' fields stay collapsed / unmounted.
    expect(screen.queryByRole("button", { name: /^Drifty Cloud setup row$/i })).toBeNull();
    expect(screen.queryByLabelText("OpenRouter model id")).toBeNull();
    expect(screen.queryByLabelText("Analysis endpoint base URL")).toBeNull();
  });

  it("gates the Drifty Cloud analysis model behind Upgrade when the plan is not subscribed", () => {
    const onStartCloudSetup = vi.fn();
    renderPanel({
      setup: buildSetup({ provider: "cloud" }),
      cloudSelectable: false,
      cloudSubscribeActionLabel: "Upgrade",
      onStartCloudSetup,
    });

    const summary = summaryRegion();
    // Not subscribed → placeholder + needs-setup, not a committed "Drifty Cloud" selection.
    expect(within(summary).getByText("Needs setup")).toBeTruthy();
    const modelCombobox = within(summary).getByRole("combobox", { name: "Analysis model" });
    expect(modelCombobox.textContent).toContain("Select a model");

    // Expanding the model dropdown surfaces a disabled cloud option + an Upgrade action.
    fireEvent.click(modelCombobox);
    const cloudOption = within(summary).getByRole("option", { name: /Drifty Cloud/i });
    if (!(cloudOption instanceof HTMLButtonElement)) throw new Error("Cloud model option should render as a button.");
    expect(cloudOption.disabled).toBe(true);
    fireEvent.click(within(summary).getByRole("button", { name: /^Upgrade$/i }));
    expect(onStartCloudSetup).toHaveBeenCalledTimes(1);
  });

  it("shows the OpenRouter model picker seeded with the recommended default and masks the shared key", () => {
    renderPanel({ setup: buildSetup({ provider: "openrouter" }), openRouterApiKey: "shared-sample-key" });
    const key = screen.getByLabelText("OpenRouter API key") as HTMLInputElement;
    expect(key.type).toBe("password");
    expect(key.value).toBe("shared-sample-key");
    expect(screen.queryByText("shared-sample-key")).toBeNull();
    expect(within(summaryRegion()).getByRole("combobox", { name: "Analysis model" }).textContent).toContain("GPT-5 mini");
    fireEvent.click(screen.getByRole("button", { name: "Choose OpenRouter models" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Select openai/gpt-5-mini" })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: "Use openai/gpt-5-mini as primary" })).toHaveProperty("checked", true);
  });

  it("labels a saved OpenRouter key Configured without claiming verification", () => {
    renderPanel({ setup: buildSetup({ provider: "openrouter" }), openRouterConnected: true });
    expect(within(summaryRegion()).getByText("Configured")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connected" })).toBeNull();
    expect(screen.getByRole("button", { name: "Choose OpenRouter models" })).toBeTruthy();
  });

  it("shows base URL, model, and optional API key inputs for the custom endpoint provider", () => {
    renderPanel({ setup: buildSetup({ provider: "self_hosted" }) });

    expect(screen.getByLabelText("Analysis endpoint base URL")).toBeTruthy();
    expect(screen.getByLabelText("Analysis endpoint model")).toBeTruthy();
    // Unified API-key field: shared "API key" label + per-provider aria-label.
    expect(screen.getByLabelText("Custom endpoint API key")).toBeTruthy();
    // "Custom endpoint" shows in both the provider select and the (unconfigured) model select.
    expect(within(summaryRegion()).getAllByText("Custom endpoint").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Connect OpenRouter/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Fetch models" })).toBeTruthy();
    // On the Intelligence tab the description names Classification as the sharing partner.
    expect(screen.getByText(/Base URL and key are shared with Classification;/)).toBeTruthy();
  });

  it("tests the active custom endpoint with its shared key and Intelligence model", async () => {
    renderPanel({
      setup: buildSetup({
        provider: "self_hosted",
        selfHostedBaseUrl: "https://models.example/v1/",
        selfHostedApiKey: "shared-session-key",
        selfHostedModel: "intelligence-model",
      }),
    });

    fireEvent.click(within(summaryRegion()).getByRole("button", { name: "Test AI connection" }));

    await waitFor(() => expect(testOpenAiCompatibleConnectionMock).toHaveBeenCalledWith({
      baseUrl: "https://models.example/v1",
      apiKey: "shared-session-key",
      model: "intelligence-model",
    }));
    expect(await within(summaryRegion()).findByText("Connected in 18 ms.")).toBeTruthy();
  });

  it("disables the custom endpoint connection test until its URL and model are valid", () => {
    const firstSetup = buildSetup({
      provider: "self_hosted",
      selfHostedBaseUrl: "not-a-url",
      selfHostedModel: "intelligence-model",
    });
    const rendered = renderPanel({ setup: firstSetup });

    const button = within(summaryRegion()).getByRole("button", { name: "Test AI connection" });
    expect(button).toHaveProperty("disabled", true);

    rendered.rerender(<IntelligenceSetupPanel
      {...rendered.props}
      setup={{ ...firstSetup, selfHostedBaseUrl: "https://models.example/v1", selfHostedModel: "   " }}
    />);
    expect(button).toHaveProperty("disabled", true);
  });

  it("recovers from an unexpected rejected connection test without exposing its error", async () => {
    testOpenAiCompatibleConnectionMock.mockRejectedValueOnce(new Error("secret-bearing transport failure"));
    renderPanel({
      setup: buildSetup({
        provider: "self_hosted",
        selfHostedBaseUrl: "https://models.example/v1",
        selfHostedModel: "intelligence-model",
      }),
    });

    fireEvent.click(within(summaryRegion()).getByRole("button", { name: "Test AI connection" }));

    expect(await within(summaryRegion()).findByText("Connection test failed.")).toBeTruthy();
    expect(within(summaryRegion()).getByRole("button", { name: "Test AI connection" })).toHaveProperty("disabled", false);
    expect(screen.queryByText(/secret-bearing/i)).toBeNull();
  });

  it("ignores a late result after the endpoint model changes", async () => {
    let resolveFirstTest: ((result: { kind: "success"; message: string }) => void) | undefined;
    testOpenAiCompatibleConnectionMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirstTest = resolve;
    }));
    const firstSetup = buildSetup({
      provider: "self_hosted",
      selfHostedBaseUrl: "https://models.example/v1",
      selfHostedModel: "first-model",
    });
    const rendered = renderPanel({ setup: firstSetup });

    fireEvent.click(within(summaryRegion()).getByRole("button", { name: "Test AI connection" }));
    rendered.rerender(<IntelligenceSetupPanel {...rendered.props} setup={{ ...firstSetup, selfHostedModel: "second-model" }} />);
    resolveFirstTest?.({ kind: "success", message: "Connected in 999 ms." });

    await waitFor(() => expect(within(summaryRegion()).queryByText("Connected in 999 ms.")).toBeNull());
    expect(within(summaryRegion()).getByRole("button", { name: "Test AI connection" })).toHaveProperty("disabled", false);
  });

  it("does not start duplicate tests for the same configuration", () => {
    testOpenAiCompatibleConnectionMock.mockImplementationOnce(() => new Promise(() => undefined));
    renderPanel({
      setup: buildSetup({
        provider: "self_hosted",
        selfHostedBaseUrl: "https://models.example/v1",
        selfHostedModel: "intelligence-model",
      }),
    });

    const button = within(summaryRegion()).getByRole("button", { name: "Test AI connection" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(testOpenAiCompatibleConnectionMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the active provider when a configured card is opened, like Classification", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "cloud" }), openRouterConnected: true, onChange });

    fireEvent.click(screen.getByRole("button", { name: /^OpenRouter setup row$/i }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("OpenRouter API key")).toBeTruthy();
  });

  it("does not commit to an unconfigured provider when its card is opened", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "cloud" }), onChange });

    fireEvent.click(screen.getByRole("button", { name: /^OpenAI setup row$/i }));

    // No key yet → opening the card only reveals its config, never makes it the active provider.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("OpenAI API key")).toBeTruthy();
  });

  it("expands an unconfigured provider's card from the summary dropdown without committing to it", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "cloud" }), onChange });

    const summary = summaryRegion();
    fireEvent.click(within(summary).getByRole("combobox", { name: "Analysis provider" }));
    fireEvent.click(within(summary).getByRole("option", { name: "OpenRouter" }));

    // OpenRouter isn't connected → don't switch the active provider; just expand its
    // Configure card so the user can set it up first.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("OpenRouter API key")).toBeTruthy();
  });

  it("switches to a configured provider directly from the summary dropdown", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "openrouter" }), openRouterConnected: true, onChange });

    const summary = summaryRegion();
    // Drifty Cloud is always reachable (subscription is gated in the model dropdown).
    fireEvent.click(within(summary).getByRole("combobox", { name: "Analysis provider" }));
    fireEvent.click(within(summary).getByRole("option", { name: "Drifty Cloud" }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "cloud" }));
  });

  it("picks a recommended model from the summary model dropdown", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "openrouter" }), onChange });

    const summary = summaryRegion();
    fireEvent.click(within(summary).getByRole("combobox", { name: "Analysis model" }));
    fireEvent.click(within(summary).getByRole("option", { name: "Claude Sonnet 5" }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "openrouter", openRouterModel: "anthropic/claude-sonnet-5", openRouterFallbackModels: ["openai/gpt-5-mini"] }));
  });

  it("offers a custom fallback in the summary and preserves the previous primary when selected", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "openrouter", openRouterFallbackModels: ["sample/fallback"] }), onChange });
    fireEvent.click(within(summaryRegion()).getByRole("combobox", { name: "Analysis model" }));
    fireEvent.click(within(summaryRegion()).getByRole("option", { name: "sample/fallback" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      openRouterModel: "sample/fallback", openRouterFallbackModels: ["openai/gpt-5-mini"],
    }));
  });

  it("edits the OpenRouter analysis model immutably through onChange", () => {
    const onChange = vi.fn();
    const setup = buildSetup({ provider: "openrouter" });
    const rendered = renderPanel({ setup, onChange });
    fireEvent.click(screen.getByRole("button", { name: "Choose OpenRouter models" }));
    fireEvent.change(screen.getByLabelText("Other OpenRouter model"), { target: { value: "sample/analysis-model" } });
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ openRouterModel: "openai/gpt-5-mini", openRouterFallbackModels: ["sample/analysis-model"] }));
    rendered.rerender(<IntelligenceSetupPanel {...rendered.props} setup={onChange.mock.calls[0][0]} />);
    fireEvent.click(screen.getByRole("radio", { name: "Use sample/analysis-model as primary" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "openrouter", openRouterModel: "sample/analysis-model" }));
    expect(setup.openRouterModel).toBe("openai/gpt-5-mini");
  });

  it("edits the shared OpenRouter key within the existing card", () => {
    const onOpenRouterApiKeyChange = vi.fn();
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "openrouter" }), openRouterApiKey: "shared-key", onOpenRouterApiKeyChange, onChange });
    fireEvent.change(screen.getByLabelText("OpenRouter API key"), { target: { value: "replacement-key" } });
    expect(onOpenRouterApiKeyChange).toHaveBeenCalledWith("replacement-key");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "openrouter", openRouterModel: "openai/gpt-5-mini" }));
  });

  it("no longer renders any Preview mockup chips", () => {
    renderPanel({ setup: buildSetup({ provider: "cloud" }) });

    expect(screen.queryByText("Preview")).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it("exposes a real API key + model input for the OpenAI provider seeded with the default model", () => {
    renderPanel({ setup: buildSetup({ provider: "openai" }) });

    const keyInput = screen.getByLabelText("OpenAI API key") as HTMLInputElement;
    expect(keyInput.type).toBe("password");
    const modelInput = screen.getByLabelText("OpenAI model id") as HTMLInputElement;
    expect(modelInput.value).toBe("gpt-5-mini");
    // Shares the unified "API key" label with the other direct-key providers.
    expect(within(summaryRegion()).getAllByText("OpenAI").length).toBeGreaterThan(0);
  });

  it("exposes a real API key + model input for the Anthropic provider seeded with the default model", () => {
    renderPanel({ setup: buildSetup({ provider: "anthropic" }) });

    const keyInput = screen.getByLabelText("Anthropic API key") as HTMLInputElement;
    expect(keyInput.type).toBe("password");
    const modelInput = screen.getByLabelText("Anthropic model id") as HTMLInputElement;
    expect(modelInput.value).toBe("claude-sonnet-5");
    expect(within(summaryRegion()).getAllByText("Anthropic").length).toBeGreaterThan(0);
  });

  it("edits the OpenAI key and model immutably through onChange", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "openai" }), onChange });

    fireEvent.change(screen.getByLabelText("OpenAI API key"), { target: { value: "sk-openai-123" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "openai", openaiApiKey: "sk-openai-123" }));

    fireEvent.change(screen.getByLabelText("OpenAI model id"), { target: { value: "gpt-5" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "openai", openaiModel: "gpt-5" }));
  });

  it("edits the Anthropic key and model immutably through onChange", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "anthropic" }), onChange });

    fireEvent.change(screen.getByLabelText("Anthropic API key"), { target: { value: "sk-ant-123" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "anthropic", anthropicApiKey: "sk-ant-123" }));

    fireEvent.change(screen.getByLabelText("Anthropic model id"), { target: { value: "claude-opus-5" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "anthropic", anthropicModel: "claude-opus-5" }));
  });

  it("expands the OpenAI and Anthropic cards from the summary dropdown without committing when unconfigured", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "cloud" }), onChange });

    const summary = summaryRegion();
    fireEvent.click(within(summary).getByRole("combobox", { name: "Analysis provider" }));
    fireEvent.click(within(summary).getByRole("option", { name: "OpenAI" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("OpenAI API key")).toBeTruthy();

    fireEvent.click(within(summary).getByRole("combobox", { name: "Analysis provider" }));
    fireEvent.click(within(summary).getByRole("option", { name: "Anthropic" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Anthropic API key")).toBeTruthy();
  });
});


it("keeps incomplete inactive Custom and Anthropic edits as configuration without activating them", () => {
  const onChange = vi.fn();
  renderPanel({ setup: buildSetup({ provider: "cloud" }), onChange });
  fireEvent.click(screen.getByRole("button", { name: /custom.*setup row/i }));
  fireEvent.change(screen.getByLabelText("Analysis endpoint base URL"), { target: { value: "invalid" } });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "cloud", selfHostedBaseUrl: "invalid" }));
  fireEvent.click(screen.getByRole("button", { name: /^Anthropic setup row$/i }));
  fireEvent.change(screen.getByLabelText("Anthropic API key"), { target: { value: "partial" } });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "cloud", anthropicApiKey: "partial" }));
});

it("shows the effective Cloud destination while retaining the saved Anthropic configuration fields", () => {
  const setup = buildSetup({ provider: "anthropic" });
  renderPanel({ setup, effectiveSetup: { ...setup, provider: "cloud" } });
  expect(within(summaryRegion()).getAllByText("Drifty Cloud").length).toBeGreaterThan(0);
  expect(screen.getByLabelText("Anthropic model id")).toHaveProperty("value", "claude-sonnet-5");
});
