// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IntelligenceSetupPanel, type IntelligenceSetupPanelProps } from "./IntelligenceSetupPanel";
import { DEFAULT_ANALYSIS_AI_SETUP, type AnalysisAiSetupState } from "./analysisModelSetup";

function buildSetup(overrides: Partial<AnalysisAiSetupState> = {}): AnalysisAiSetupState {
  return { ...DEFAULT_ANALYSIS_AI_SETUP, ...overrides };
}

function renderPanel(overrides: Partial<IntelligenceSetupPanelProps> = {}) {
  const props: IntelligenceSetupPanelProps = {
    setup: buildSetup(),
    onChange: vi.fn(),
    openRouterConnected: false,
    onConnectOpenRouter: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<IntelligenceSetupPanel {...props} />) };
}

function summaryRegion() {
  return screen.getByRole("region", { name: /Analysis model being used/i });
}

describe("IntelligenceSetupPanel", () => {
  it("explains the heavy project pass and recommends a strong model", () => {
    renderPanel({ setup: buildSetup({ provider: "cloud" }) });

    expect(screen.getByText(/project pass/i)).toBeTruthy();
    expect(screen.getByText(/GPT-5 mini/)).toBeTruthy();
  });

  it("summarizes the Drifty Cloud provider as always-available with a managed model", () => {
    renderPanel({ setup: buildSetup({ provider: "cloud" }) });

    const summary = summaryRegion();
    // "Drifty Cloud" appears in both the status row and the provider select.
    expect(within(summary).getAllByText("Drifty Cloud").length).toBeGreaterThan(0);
    expect(within(summary).getByText("Managed by Drifty")).toBeTruthy();
    expect(within(summary).getByText("Available")).toBeTruthy();

    // The expanded Drifty Cloud card explains no configuration is needed.
    expect(screen.getByText(/Drifty Cloud provides the analysis model/i)).toBeTruthy();

    // Other providers' fields stay collapsed / unmounted.
    expect(screen.queryByLabelText("OpenRouter model id")).toBeNull();
    expect(screen.queryByLabelText("Analysis endpoint base URL")).toBeNull();
  });

  it("shows the OpenRouter model picker seeded with the recommended default and never exposes a raw key", () => {
    const { container } = renderPanel({ setup: buildSetup({ provider: "openrouter" }) });

    const modelInput = screen.getByLabelText("OpenRouter model id") as HTMLInputElement;
    expect(modelInput.value).toBe("openai/gpt-5-mini");
    expect(container.querySelector('datalist option[value="openai/gpt-5-mini"]')).toBeTruthy();

    // The selectable summary reflects OpenRouter + the friendly model label + a needs-setup pill when not connected.
    const summary = summaryRegion();
    expect(within(summary).getAllByText("OpenRouter").length).toBeGreaterThan(0);
    expect(within(summary).getByText("GPT-5 mini")).toBeTruthy();
    expect(within(summary).getByText("Needs setup")).toBeTruthy();

    // The provisioned key is never rendered.
    expect(screen.queryByLabelText(/OpenRouter API key/i)).toBeNull();
  });

  it("labels the connect action Connected and shows a Connected pill once OpenRouter is connected", () => {
    renderPanel({ setup: buildSetup({ provider: "openrouter" }), openRouterConnected: true });

    expect(screen.getByRole("button", { name: "Connected" })).toBeTruthy();
    expect(within(summaryRegion()).getByText("Connected")).toBeTruthy();
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
  });

  it("selects a real provider by opening its card, calling onChange with the new provider", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "cloud" }), onChange });

    fireEvent.click(screen.getByRole("button", { name: /^OpenRouter setup row$/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "openrouter" }));
  });

  it("switches provider directly from the selectable Model-being-used summary", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "cloud" }), onChange });

    const summary = summaryRegion();
    fireEvent.click(within(summary).getByRole("combobox", { name: "Analysis provider" }));
    fireEvent.click(within(summary).getByRole("option", { name: "OpenRouter" }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "openrouter" }));
  });

  it("picks a recommended model from the summary model dropdown", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "openrouter" }), onChange });

    const summary = summaryRegion();
    fireEvent.click(within(summary).getByRole("combobox", { name: "Analysis model" }));
    fireEvent.click(within(summary).getByRole("option", { name: "Claude Sonnet 5" }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "openrouter", openRouterModel: "anthropic/claude-sonnet-5" }));
  });

  it("edits the OpenRouter analysis model immutably through onChange", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "openrouter" }), onChange });

    fireEvent.change(screen.getByLabelText("OpenRouter model id"), { target: { value: "anthropic/claude-sonnet-5" } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "openrouter", openRouterModel: "anthropic/claude-sonnet-5" }));
  });

  it("triggers the connect flow when Connect is clicked", () => {
    const onConnectOpenRouter = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "openrouter" }), onConnectOpenRouter });

    fireEvent.click(screen.getByRole("button", { name: /^Connect OpenRouter$/i }));

    expect(onConnectOpenRouter).toHaveBeenCalledTimes(1);
  });

  it("no longer renders any Preview mockup chips", () => {
    renderPanel({ setup: buildSetup({ provider: "cloud" }) });

    expect(screen.queryByText("Preview")).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it("selects OpenAI as a real provider when its card is opened", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "cloud" }), onChange });

    fireEvent.click(screen.getByRole("button", { name: /^OpenAI setup row$/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "openai" }));
  });

  it("selects Anthropic as a real provider when its card is opened", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "cloud" }), onChange });

    fireEvent.click(screen.getByRole("button", { name: /^Anthropic setup row$/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "anthropic" }));
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

  it("switches to OpenAI and Anthropic directly from the selectable summary provider dropdown", () => {
    const onChange = vi.fn();
    renderPanel({ setup: buildSetup({ provider: "cloud" }), onChange });

    const summary = summaryRegion();
    fireEvent.click(within(summary).getByRole("combobox", { name: "Analysis provider" }));
    fireEvent.click(within(summary).getByRole("option", { name: "OpenAI" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "openai" }));

    fireEvent.click(within(summary).getByRole("combobox", { name: "Analysis provider" }));
    fireEvent.click(within(summary).getByRole("option", { name: "Anthropic" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "anthropic" }));
  });
});
