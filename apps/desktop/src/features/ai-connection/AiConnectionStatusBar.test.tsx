// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Auto-cleanup isn't unmounting between cases here, so the broad "open ai
// settings" / "ai connection" role queries otherwise match a prior render's
// leftover pill. Tear down explicitly.
afterEach(cleanup);
import {
  AiConnectionStatusBar,
  resolveAiConnectionStatus,
  type AiConnectionStatusInput,
} from "./AiConnectionStatusBar";

describe("resolveAiConnectionStatus", () => {
  it("returns ready with a green light when cloud AI is available", () => {
    const status = resolveAiConnectionStatus(statusInput({
      canUseCloudAi: true,
    }));

    expect(status).toMatchObject({
      tone: "ok",
      label: "Connected",
      providerLabel: "Drifty Cloud",
      memoryLabel: null,
    });
  });

  it("returns a classifying state with a green light while classification is active", () => {
    const status = resolveAiConnectionStatus(statusInput({
      localProviderStatus: { kind: "connected" },
      localProviderLabel: "DeepSeek V4 Flash BYOK",
      classificationRunning: true,
    }));

    expect(status).toMatchObject({
      tone: "ok",
      label: "Classifying…",
      providerLabel: "DeepSeek V4 Flash BYOK",
      memoryLabel: null,
      activity: "classifying",
    });
  });

  it("shows the remaining count while classifying when it is known", () => {
    const status = resolveAiConnectionStatus(statusInput({
      canUseCloudAi: true,
      classificationRunning: true,
      classificationRemaining: 12,
    }));

    expect(status).toMatchObject({
      tone: "ok",
      label: "Classifying…",
      providerLabel: "12 left",
      activity: "classifying",
    });
  });

  it("returns error with a red light when the latest AI run failed", () => {
    const status = resolveAiConnectionStatus(statusInput({
      canUseCloudAi: true,
      classificationIssueKind: "provider",
    }));

    expect(status).toMatchObject({
      tone: "error",
      label: "Provider error",
      providerLabel: "Drifty Cloud",
      memoryLabel: null,
    });
  });

  it("returns a warning tone for connection issues", () => {
    const status = resolveAiConnectionStatus(statusInput({
      cloudIssueKind: "network",
    }));

    expect(status).toMatchObject({
      tone: "warning",
      label: "Connection issue",
      providerLabel: "Drifty Cloud",
      memoryLabel: null,
    });
  });

  it("returns checking with actual local memory usage while local provider settings are being verified", () => {
    const status = resolveAiConnectionStatus(statusInput({
      localProviderStatus: { kind: "checking" },
      localProviderLabel: "Gemma 4 12B",
      localMemoryUsageBytes: 2_684_354_560,
    }));

    expect(status).toMatchObject({
      tone: "neutral",
      label: "Checking",
      providerLabel: "Gemma 4 12B",
      memoryLabel: "2.5 GB RAM",
    });
  });

  it("shows a sub-gigabyte local footprint in megabytes", () => {
    const status = resolveAiConnectionStatus(statusInput({
      localProviderStatus: { kind: "connected" },
      localProviderLabel: "Local AI",
      localMemoryUsageBytes: 170_247_824,
    }));

    expect(status.memoryLabel).toBe("162 MB RAM");
  });

  it("does not attach memory details to cloud AI status", () => {
    const status = resolveAiConnectionStatus(statusInput({
      canUseCloudAi: true,
      localMemoryUsageBytes: 2_684_354_560,
    }));

    expect(status).toMatchObject({
      tone: "ok",
      label: "Connected",
      providerLabel: "Drifty Cloud",
      memoryLabel: null,
    });
  });

  it("returns provider issue when a tested local provider failed for a non-network reason", () => {
    const status = resolveAiConnectionStatus(statusInput({
      localProviderStatus: { kind: "failed", issueKind: "provider" },
      localProviderLabel: "OpenAI GPT 4o Mini BYOK",
    }));

    expect(status).toMatchObject({
      tone: "error",
      label: "Provider error",
      providerLabel: "OpenAI GPT 4o Mini BYOK",
      memoryLabel: null,
    });
  });

  it.each([
    ["authentication", "error", "Key issue"],
    ["credits", "error", "Credits needed"],
    ["access", "error", "Access blocked"],
    ["model_unavailable", "error", "Model unavailable"],
    ["rate_limited", "warning", "Rate limited"],
    ["unavailable", "warning", "Provider unavailable"],
  ] as const)("renders a specific %s topbar state", (issueKind, tone, label) => {
    expect(resolveAiConnectionStatus(statusInput({
      localProviderStatus: { kind: "failed", issueKind },
      localProviderLabel: "DeepSeek V4 Flash BYOK",
    }))).toMatchObject({ issueKind, tone, label, providerLabel: "DeepSeek V4 Flash BYOK" });
  });

  it("returns setup with an error tone when no AI provider is connected", () => {
    const status = resolveAiConnectionStatus(statusInput());

    expect(status).toMatchObject({
      tone: "error",
      label: "AI setup needed",
      providerLabel: "Open settings",
      memoryLabel: null,
    });
  });
});

describe("AiConnectionStatusBar", () => {
  it("renders an accessible status button with tone and provider details", () => {
    const onOpenSettings = vi.fn();
    render(
      <AiConnectionStatusBar
        status={{
          tone: "error",
          label: "Issue",
          providerLabel: "Gemma 4 12B",
          memoryLabel: null,
          issueKind: "provider",
        }}
        onOpenSettings={onOpenSettings}
      />,
    );

    const status = screen.getByRole("button", { name: /ai connection/i });

    expect(status.textContent).toContain("Issue");
    expect(status.textContent).toContain("Gemma 4 12B");
    expect(status.getAttribute("data-tone")).toBe("error");
  });

  it("opens AI settings when clicked", () => {
    const onOpenSettings = vi.fn();
    render(
      <AiConnectionStatusBar
        status={{
          tone: "warning",
          label: "Connection issue",
          providerLabel: "Drifty Cloud",
          memoryLabel: null,
          issueKind: "network",
        }}
        onOpenSettings={onOpenSettings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open ai settings/i }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("marks the pill as classifying so the dot can pulse", () => {
    render(
      <AiConnectionStatusBar
        status={{
          tone: "ok",
          label: "Classifying…",
          providerLabel: "12 left",
          memoryLabel: null,
          issueKind: null,
          activity: "classifying",
        }}
        onOpenSettings={vi.fn()}
      />,
    );

    const status = screen.getByRole("button", { name: /ai connection/i });
    expect(status.getAttribute("data-activity")).toBe("classifying");
    expect(status.textContent).toContain("Classifying…");
    expect(status.textContent).toContain("12 left");
  });

  it("renders local AI memory when provided", () => {
    render(
      <AiConnectionStatusBar
        status={{
          tone: "ok",
          label: "Connected",
          providerLabel: "Local AI",
          memoryLabel: "2.5 GB RAM",
          issueKind: null,
        }}
        onOpenSettings={vi.fn()}
      />,
    );

    const status = screen.getByRole("button", { name: /memory in use 2\.5 gb ram/i });

    // The memory readout renders in the chrome just before the pill.
    expect(status.textContent).not.toContain("2.5 GB RAM");
    expect(screen.getByText("2.5 GB RAM")).toBeTruthy();
  });
});

function statusInput(overrides: Partial<AiConnectionStatusInput> = {}): AiConnectionStatusInput {
  return {
    canUseCloudAi: false,
    localProviderStatus: { kind: "unconfigured" },
    localProviderLabel: null,
    localMemoryUsageBytes: null,
    classificationRunning: false,
    classificationIssueKind: null,
    cloudIssueKind: null,
    ...overrides,
  };
}

describe("AiConnectionStatusBar on the AI setup page", () => {
  it("drops 'Open settings' while AI setup is already on screen", () => {
    const status = { tone: "error" as const, label: "AI setup needed", providerLabel: "Open settings", memoryLabel: null, issueKind: null };
    const { rerender } = render(<AiConnectionStatusBar status={status} onOpenSettings={vi.fn()} />);
    expect(screen.getByText("Open settings")).toBeTruthy();
    rerender(<AiConnectionStatusBar status={status} onOpenSettings={vi.fn()} settingsOpen />);
    expect(screen.queryByText("Open settings")).toBeNull();
    expect(screen.getByRole("button", { name: "AI setup needed" })).toBeTruthy();
  });
});
