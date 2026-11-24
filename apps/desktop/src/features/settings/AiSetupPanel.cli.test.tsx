// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capturePostHogEvent = vi.fn();
vi.mock("../../lib/analytics/posthogClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/analytics/posthogClient")>(),
  capturePostHogEvent: (...args: unknown[]) => capturePostHogEvent(...args),
}));

import { invokeMock, renderPanel, resetManagedStatusMock } from "./AiSetupPanel.testHarness";

function openProviderMenu() {
  const card = screen.getByRole("region", { name: /^Model being used$/i });
  fireEvent.click(within(card).getByRole("combobox", { name: /^AI provider$/i }));
  return card;
}

describe("AiSetupPanel CLI connections", () => {
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

  it("lists Claude Code and Codex CLI for everyone, right after Drifty", () => {
    renderPanel();
    const card = openProviderMenu();
    const options = within(card).getAllByRole("option").map((option) => option.textContent?.trim());
    expect(options.slice(0, 3)).toEqual(["Drifty", "Claude Code", "Codex CLI"]);
  });

  it("does not offer a new CLI connection on Windows, where CLI classification is unverified", () => {
    const userAgent = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    try {
      renderPanel();
      const card = openProviderMenu();
      expect(within(card).queryByRole("option", { name: /^Claude Code$/i })).toBeNull();
      expect(within(card).queryByRole("option", { name: /^Codex CLI$/i })).toBeNull();
    } finally {
      userAgent.mockRestore();
    }
  });

  it("records the plan state when a CLI is chosen after the trial ended", () => {
    renderPanel({ billingEntitlementStatus: "locked", billingEntitlementLockedReason: "trial_expired" });
    const card = openProviderMenu();
    fireEvent.click(within(card).getByRole("option", { name: /^Claude Code$/i }));
    expect(capturePostHogEvent).toHaveBeenCalledWith("ai_setup_action", {
      action: "save_provider",
      provider_kind: "claude_cli",
      result: "success",
      entitlement_status: "locked",
      locked_reason: "trial_expired",
    });
  });

  it("records a trial-time choice without a locked reason", () => {
    renderPanel({ billingEntitlementStatus: "trialing" });
    const card = openProviderMenu();
    fireEvent.click(within(card).getByRole("option", { name: /^Codex CLI$/i }));
    expect(capturePostHogEvent).toHaveBeenCalledWith("ai_setup_action", {
      action: "save_provider",
      provider_kind: "codex_cli",
      result: "success",
      entitlement_status: "trialing",
    });
  });
});

