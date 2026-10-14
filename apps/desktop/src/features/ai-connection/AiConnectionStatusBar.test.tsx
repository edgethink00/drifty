// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("opens a recording diagnosis before the existing AI settings action", () => {
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

    fireEvent.click(screen.getByRole("button", { name: /view recording and ai status/i }));
    expect(onOpenSettings).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Recording and AI" })).toBeTruthy();
    expect(screen.getByText("Recording status is unconfirmed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "AI settings" }));
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

const networkIssue = { tone: "warning" as const, label: "Connection issue", providerLabel: "Custom provider", memoryLabel: null, issueKind: "network" as const };

describe("recording recovery popover", () => {
  it("checks recording once on entry and reflects tracker changes without losing the diagnosis", async () => {
    const onCheckRecordingStatus = vi.fn(async () => undefined);
    const onRecordingAction = vi.fn();
    const props = { status: networkIssue, onOpenSettings: vi.fn(), onCheckRecordingStatus, onRecordingAction };
    const { rerender } = render(<AiConnectionStatusBar {...props} recordingHealth={{ kind: "paused", action: "resume" }} />);
    fireEvent.click(screen.getByRole("button", { name: /view recording/i }));
    await waitFor(() => expect(screen.getByText("Recording is paused")).toBeTruthy());
    expect(onCheckRecordingStatus).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Resume recording" }));
    expect(onRecordingAction).toHaveBeenCalledWith("resume");
    rerender(<AiConnectionStatusBar {...props} recordingHealth={{ kind: "recording", action: null }} />);
    expect(await screen.findByText("Recent activity recorded")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume recording" })).toBeNull();
    expect(onCheckRecordingStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps keyboard focus in the panel while a recording action is pending", async () => {
    let finish: (() => void) | undefined;
    const onRecordingAction = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<AiConnectionStatusBar status={networkIssue} onOpenSettings={vi.fn()} onRecordingAction={onRecordingAction} recordingHealth={{ kind: "paused", action: "resume" }} />);
    fireEvent.click(screen.getByRole("button", { name: /view recording/i }));
    const panel = screen.getByRole("dialog");
    const resume = screen.getByRole("button", { name: "Resume recording" });
    resume.focus();
    fireEvent.click(resume);
    expect(document.activeElement).toBe(panel);
    expect(screen.getByText("Checking recording status…")).toBeTruthy();
    finish?.();
    await waitFor(() => expect(screen.queryByText("Checking recording status…")).toBeNull());
    expect(document.activeElement).toBe(panel);
  });

  it("returns focus on Escape and dismisses on an outside click without stealing focus", async () => {
    render(<><AiConnectionStatusBar status={networkIssue} onOpenSettings={vi.fn()} /><button>Outside</button></>);
    const trigger = screen.getByRole("button", { name: /view recording/i });
    fireEvent.click(trigger);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("dialog")));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    const outside = screen.getByRole("button", { name: "Outside" });
    fireEvent.pointerDown(outside);
    outside.focus();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(outside);
  });

  it("closes when keyboard focus leaves the nonmodal panel", () => {
    render(<><AiConnectionStatusBar status={networkIssue} onOpenSettings={vi.fn()} /><button>Outside</button></>);
    const trigger = screen.getByRole("button", { name: /view recording/i });
    fireEvent.click(trigger);
    fireEvent.focusIn(screen.getByRole("button", { name: "Outside" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it.each(["recovered", "provider", "navigation"])("dismisses the old diagnosis after %s changes", (change) => {
    const props = { status: networkIssue, onOpenSettings: vi.fn(), navigationKey: "dashboard" };
    const { rerender } = render(<AiConnectionStatusBar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /view recording/i }));
    rerender(<AiConnectionStatusBar {...props}
      status={change === "recovered" ? { ...networkIssue, issueKind: null } : change === "provider" ? { ...networkIssue, providerLabel: "New provider" } : networkIssue}
      navigationKey={change === "navigation" ? "settings" : "dashboard"} />);
    expect(screen.getByRole("button", { name: /AI connection/i }).getAttribute("aria-expanded")).not.toBe("true");
  });

  it("keeps self-resolving failures quiet and does not invent a classification retry", () => {
    render(<AiConnectionStatusBar status={{ ...networkIssue, issueKind: "rate_limited", label: "Rate limited" }} onOpenSettings={vi.fn()} recordingHealth={{ kind: "idle", action: null }} />);
    fireEvent.click(screen.getByRole("button", { name: /view recording/i }));
    const panel = screen.getByRole("dialog");
    expect(within(panel).queryByRole("button")).toBeNull();
    expect(within(panel).getByText("Waiting for activity")).toBeTruthy();
  });

  it("keeps healthy pills linked directly to settings", () => {
    const onOpenSettings = vi.fn();
    render(<AiConnectionStatusBar status={{ ...networkIssue, issueKind: null, label: "Connected" }} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole("button", { name: /open ai settings/i }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
