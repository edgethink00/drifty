// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capturePostHogEvent = vi.fn();
vi.mock("../../lib/analytics/posthogClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/analytics/posthogClient")>(),
  capturePostHogEvent: (...args: unknown[]) => capturePostHogEvent(...args),
}));

type Install = import("../onboarding/cliInstall").CliInstall;
const cliInstalls: { claude_cli: Install; codex_cli: Install } = {
  claude_cli: { state: "found", version: "2.1.0", signedIn: true },
  codex_cli: { state: "found", version: "0.162.0", signedIn: true },
};
const recheckCli = vi.fn();
vi.mock("../onboarding/cliInstall", async (importOriginal) => ({
  ...await importOriginal<typeof import("../onboarding/cliInstall")>(),
  useCliInstalls: () => ({ installs: cliInstalls, checking: false, recheck: recheckCli }),
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
    recheckCli.mockClear();
    cliInstalls.claude_cli = { state: "found", version: "2.1.0", signedIn: true };
    cliInstalls.codex_cli = { state: "found", version: "0.162.0", signedIn: true };
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

  it("shows a Claude Code connection as Anthropic with only models in its model menu", () => {
    const panel = renderPanel({ initialSetup: { ...DEFAULT_LOCAL_AI_SETUP, provider: "claude_cli", anthropicModel: "claude-sonnet-5" } });
    const card = modelBeingUsed();
    expect(within(card).getByRole("combobox", { name: /^AI provider$/i }).textContent).toContain("Anthropic");
    // A model the CLI cannot run falls back to the lightest one without changing the saved choice.
    expect(within(card).getByRole("combobox", { name: /^AI model$/i }).textContent).toContain("Claude Haiku 5.5");
    expect(menuOptions(/^AI model$/i)).toEqual(["Claude Haiku 5.5", "Claude Sonnet 5.5"]);
    fireEvent.click(within(card).getByRole("option", { name: "Claude Sonnet 5.5" }));
    expect(panel.getLocalAiSetup()).toMatchObject({ provider: "claude_cli", anthropicModel: "claude-sonnet-5-5" });
  });

  it("connects Claude Code from the Anthropic card and records the plan state after the trial ended", () => {
    const panel = renderPanel({ billingEntitlementStatus: "locked", billingEntitlementLockedReason: "trial_expired" });
    fireEvent.click(screen.getByRole("button", { name: "Anthropic setup row" }));
    const row = screen.getByRole("group", { name: "Claude Code" });
    const status = within(row).getByRole("status");
    expect(status.textContent).toBe("Signed in");
    expect(status.getAttribute("title")).toBe("v2.1.0");
    expect(row.textContent).toContain("Classifies with your signed-in Claude account");
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

  it("connects Codex CLI from the OpenAI card during a trial and keeps its model menu to models", () => {
    const panel = renderPanel({
      billingEntitlementStatus: "trialing",
      initialSetup: { ...DEFAULT_LOCAL_AI_SETUP, provider: "openai", openaiApiKey: "sk-test-not-real", openaiModel: "gpt-5.5-mini" },
    });
    const card = modelBeingUsed();
    expect(menuOptions(/^AI model$/i).some((option) => option.startsWith("Codex CLI"))).toBe(false);
    fireEvent.click(within(card).getByRole("combobox", { name: /^AI model$/i }));
    // The OpenAI card is already open for an OpenAI connection.
    fireEvent.click(within(screen.getByRole("group", { name: "Codex CLI" })).getByRole("button", { name: "Use subscription" }));
    expect(panel.getLocalAiSetup().provider).toBe("codex_cli");
    expect(capturePostHogEvent).toHaveBeenCalledWith("ai_setup_action", {
      action: "save_provider",
      provider_kind: "codex_cli",
      result: "success",
      entitlement_status: "trialing",
    });
    expect(menuOptions(/^AI model$/i)).toEqual(["GPT-6 Luna", "GPT-6.1 Sol"]);
  });

  it("sets out the API key like the CLI row and switches back to a saved key from it", () => {
    const panel = renderPanel({ initialSetup: { ...DEFAULT_LOCAL_AI_SETUP, provider: "claude_cli", anthropicApiKey: "sk-ant-test-not-real", anthropicModel: "claude-haiku-5-5" } });
    // On the subscription the model menu above is the one place to choose the model.
    expect(screen.queryByRole("combobox", { name: "Anthropic model id" })).toBeNull();
    const apiKey = screen.getByRole("group", { name: "API key" });
    expect(within(apiKey).getByRole("status").textContent).toBe("Saved");
    expect(apiKey.textContent).toContain("Pay Anthropic for what you use, with your own key.");
    fireEvent.click(within(apiKey).getByRole("button", { name: "Use API key" }));
    expect(panel.getLocalAiSetup()).toMatchObject({ provider: "anthropic", anthropicModel: "claude-haiku-5-5" });
    expect(screen.queryByRole("button", { name: "Use API key" })).toBeNull();
    expect(within(screen.getByRole("group", { name: "API key" })).getByRole("status").textContent).toBe("In use");
    expect(screen.getByRole("combobox", { name: "Anthropic model id" })).toBeTruthy();
  });

  it("offers a saved key from any other connection, as the CLI row offers the subscription", () => {
    const panel = renderPanel({ initialSetup: { ...DEFAULT_LOCAL_AI_SETUP, anthropicApiKey: "sk-ant-test-not-real", anthropicModel: "claude-haiku-5-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Anthropic setup row" }));
    fireEvent.click(within(screen.getByRole("group", { name: "API key" })).getByRole("button", { name: "Use API key" }));
    expect(panel.getLocalAiSetup().provider).toBe("anthropic");
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

  it("only reports a missing Claude Code and offers Check again", () => {
    cliInstalls.claude_cli = { state: "missing" };
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Anthropic setup row" }));
    const row = screen.getByRole("group", { name: "Claude Code" });
    expect(within(row).getByRole("status").textContent).toBe("Not installed");
    expect(row.textContent).not.toContain("install.sh");
    expect(within(row).queryByRole("button", { name: "Copy" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Use subscription" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Check again" }));
    expect(recheckCli).toHaveBeenCalledTimes(1);
  });

  it("names the sign-in command for a signed-out Codex CLI in its status line", () => {
    cliInstalls.codex_cli = { state: "found", version: "0.162.0", signedIn: false };
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "OpenAI setup row" }));
    const row = screen.getByRole("group", { name: "Codex CLI" });
    expect(within(row).getByRole("status").textContent).toBe("Sign-in needed");
    // The sign-in step takes the description's place, so the row stays two lines.
    expect(row.textContent).toContain("Sign in with codex login in Terminal, then check again.");
    expect(row.textContent).not.toContain("Classifies with your signed-in ChatGPT account");
    expect(within(row).getByText("codex login").tagName).toBe("CODE");
    expect(within(row).queryByRole("button", { name: "Copy" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Use subscription" })).toBeNull();
    expect(within(row).getByRole("button", { name: "Check again" })).toBeTruthy();
  });
});
