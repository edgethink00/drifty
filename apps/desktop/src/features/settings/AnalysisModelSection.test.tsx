// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnalysisModelSection, type AnalysisModelSectionProps } from "./AnalysisModelSection";
import { DEFAULT_ANALYSIS_AI_SETUP, type AnalysisAiSetupState } from "./analysisModelSetup";

function buildSetup(overrides: Partial<AnalysisAiSetupState> = {}): AnalysisAiSetupState {
  return { ...DEFAULT_ANALYSIS_AI_SETUP, ...overrides };
}

function renderSection(overrides: Partial<AnalysisModelSectionProps> = {}) {
  const props: AnalysisModelSectionProps = {
    setup: buildSetup(),
    onChange: vi.fn(),
    onConnectOpenRouter: vi.fn(),
    openRouterConnected: false,
    ...overrides,
  };
  return { props, ...render(<AnalysisModelSection {...props} />) };
}

describe("AnalysisModelSection", () => {
  it("explains that the project pass needs a strong model and names the recommended default", () => {
    renderSection({ setup: buildSetup({ provider: "cloud" }) });

    expect(screen.getByText(/project pass/i)).toBeTruthy();
    expect(screen.getByText(/GPT-5 mini/)).toBeTruthy();
    expect(screen.getByText(/separate from the small model/i)).toBeTruthy();
  });

  it("shows only the Drifty Cloud note for the cloud provider", () => {
    renderSection({ setup: buildSetup({ provider: "cloud" }) });

    expect(screen.getByText(/Drifty Cloud provides the analysis model/i)).toBeTruthy();
    expect(screen.queryByLabelText("Analysis model")).toBeNull();
    expect(screen.queryByRole("button", { name: /Connect OpenRouter/i })).toBeNull();
    expect(screen.queryByLabelText("Analysis endpoint base URL")).toBeNull();
  });

  it("shows the model picker and Connect action for the OpenRouter provider without exposing a key", () => {
    renderSection({ setup: buildSetup({ provider: "openrouter" }) });

    expect(screen.getByLabelText("Analysis model")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Connect OpenRouter/i })).toBeTruthy();
    // The raw provisioned key is never rendered.
    expect(screen.queryByLabelText(/OpenRouter API key/i)).toBeNull();
    expect(screen.queryByLabelText("Analysis endpoint base URL")).toBeNull();
  });

  it("seeds the model dropdown with the recommended default model id", () => {
    const { container } = renderSection({ setup: buildSetup({ provider: "openrouter" }) });

    const option = container.querySelector('datalist option[value="openai/gpt-5-mini"]');
    expect(option).toBeTruthy();
  });

  it("shows base URL, model, and optional API key inputs for the self-hosted provider", () => {
    renderSection({ setup: buildSetup({ provider: "self_hosted" }) });

    expect(screen.getByLabelText("Analysis endpoint base URL")).toBeTruthy();
    expect(screen.getByLabelText("Analysis endpoint model")).toBeTruthy();
    expect(screen.getByLabelText("Analysis endpoint API key")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Connect OpenRouter/i })).toBeNull();
  });

  it("calls onChange with the newly selected provider", () => {
    const onChange = vi.fn();
    renderSection({ setup: buildSetup({ provider: "cloud" }), onChange });

    fireEvent.click(screen.getByRole("radio", { name: "OpenRouter" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "openrouter" }));
  });

  it("edits the OpenRouter model immutably through onChange", () => {
    const onChange = vi.fn();
    renderSection({ setup: buildSetup({ provider: "openrouter" }), onChange });

    fireEvent.change(screen.getByLabelText("Analysis model"), { target: { value: "anthropic/claude-sonnet-5" } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "openrouter", openRouterModel: "anthropic/claude-sonnet-5" }));
  });

  it("edits the self-hosted base URL immutably through onChange", () => {
    const onChange = vi.fn();
    renderSection({ setup: buildSetup({ provider: "self_hosted" }), onChange });

    fireEvent.change(screen.getByLabelText("Analysis endpoint base URL"), { target: { value: "http://localhost:8080/v1" } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "self_hosted", selfHostedBaseUrl: "http://localhost:8080/v1" }));
  });

  it("triggers the one-click connect flow when Connect is clicked", () => {
    const onConnectOpenRouter = vi.fn();
    renderSection({ setup: buildSetup({ provider: "openrouter" }), onConnectOpenRouter });

    fireEvent.click(screen.getByRole("button", { name: /Connect OpenRouter/i }));

    expect(onConnectOpenRouter).toHaveBeenCalledTimes(1);
  });

  it("disables the connect button and shows progress while connecting", () => {
    renderSection({ setup: buildSetup({ provider: "openrouter" }), connecting: true });

    const button = screen.getByRole("button", { name: /Connecting/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("labels the connect button as Connected once a provisioned key is present", () => {
    renderSection({ setup: buildSetup({ provider: "openrouter" }), openRouterConnected: true });

    expect(screen.getByRole("button", { name: "Connected" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Connect OpenRouter/i })).toBeNull();
  });
});
