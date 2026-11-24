// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capturePostHogEvent = vi.fn();
vi.mock("../../lib/analytics/posthogClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/analytics/posthogClient")>(),
  capturePostHogEvent: (...args: unknown[]) => capturePostHogEvent(...args),
}));

import { invokeMock, renderPanel, resetManagedStatusMock } from "./AiSetupPanel.testHarness";
import { DEFAULT_LOCAL_AI_SETUP } from "./localAiSetup";

function modelBeingUsed() {
  return screen.getByRole("region", { name: /^Model being used$/i });
}

function menuOptions(name: RegExp): string[] {
  const card = modelBeingUsed();
  fireEvent.click(within(card).getByRole("combobox", { name }));
  return within(card).getAllByRole("option").map((option) => option.textContent?.trim() ?? "");
}

describe("AiSetupPanel CLI connections inside their providers", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    resetManagedStatusMock();
    capturePostHogEvent.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("lists each provider once, with Anthropic and OpenAI right after Drifty", () => {
    renderPanel();
    expect(menuOptions(/^AI provider$/i)).toEqual(["Drifty", "Anthropic", "OpenAI", "OpenRouter", "Custom endpoint"]);
  });

  it("shows a Claude Code connection as Anthropic with Claude Code as its model, beside the API models", () => {
    renderPanel({ initialSetup: { ...DEFAULT_LOCAL_AI_SETUP, provider: "claude_cli" } });
    const card = modelBeingUsed();
    expect(within(card).getByRole("combobox", { name: /^AI provider$/i }).textContent).toContain("Anthropic");
    expect(within(card).getByRole("combobox", { name: /^AI model$/i }).textContent).toContain("Claude Code");
    const options = menuOptions(/^AI model$/i);
    expect(options[0]).toMatch(/^Claude Code/);
    expect(options.length).toBeGreaterThan(1);
  });

  it("connects Claude Code from the Anthropic card and records the plan state after the trial ended", () => {
    const panel = renderPanel({ billingEntitlementStatus: "locked", billingEntitlementLockedReason: "trial_expired" });
    fireEvent.click(screen.getByRole("button", { name: "Anthropic setup row" }));
    const row = screen.getByRole("group", { name: "Claude Code" });
    expect(row.textContent).toContain("Sign in once with claude in Terminal.");
    fireEvent.click(within(row).getByRole("button", { name: "Use subscription" }));
    expect(panel.getLocalAiSetup().provider).toBe("claude_cli");
    expect(capturePostHogEvent).toHaveBeenCalledWith("ai_setup_action", {
      action: "save_provider",
      provider_kind: "claude_cli",
      result: "success",
      entitlement_status: "locked",
      locked_reason: "trial_expired",
    });
    expect(within(screen.getByRole("group", { name: "Claude Code" })).getByText("In use")).toBeTruthy();
  });

  it("switches to Codex CLI from OpenAI's model menu during a trial", () => {
    const panel = renderPanel({
      billingEntitlementStatus: "trialing",
      initialSetup: { ...DEFAULT_LOCAL_AI_SETUP, provider: "openai", openaiApiKey: "sk-test-not-real", openaiModel: "gpt-5.5-mini" },
    });
    const card = modelBeingUsed();
    fireEvent.click(within(card).getByRole("combobox", { name: /^AI model$/i }));
    fireEvent.click(within(card).getByRole("option", { name: /^Codex CLI/ }));
    expect(panel.getLocalAiSetup().provider).toBe("codex_cli");
    expect(capturePostHogEvent).toHaveBeenCalledWith("ai_setup_action", {
      action: "save_provider",
      provider_kind: "codex_cli",
      result: "success",
      entitlement_status: "trialing",
    });
  });

  it("does not offer a new CLI connection on Windows, where CLI classification is unverified", () => {
    const userAgent = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    try {
      renderPanel({ initialSetup: { ...DEFAULT_LOCAL_AI_SETUP, provider: "anthropic", anthropicApiKey: "sk-ant-test-not-real", anthropicModel: "claude-haiku-5-5" } });
      expect(menuOptions(/^AI model$/i).some((option) => option.startsWith("Claude Code"))).toBe(false);
      expect(screen.queryByRole("group", { name: "Claude Code" })).toBeNull();
    } finally {
      userAgent.mockRestore();
    }
  });
});

