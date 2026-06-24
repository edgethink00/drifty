// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("returns running with a green light while classification is active", () => {
    const status = resolveAiConnectionStatus(statusInput({
      localProviderStatus: { kind: "connected" },
      localProviderLabel: "DeepSeek V4 Flash BYOK",
      classificationRunning: true,
    }));

    expect(status).toMatchObject({
      tone: "ok",
      label: "Running",
      providerLabel: "DeepSeek V4 Flash BYOK",
      memoryLabel: null,
    });
  });

  it("returns error with a red light when the latest AI run failed", () => {
    const status = resolveAiConnectionStatus(statusInput({
      canUseCloudAi: true,
      classificationIssueKind: "provider",
    }));

    expect(status).toMatchObject({
      tone: "error",
      label: "Issue",
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

  it("returns checking while local provider settings are being verified", () => {
    const status = resolveAiConnectionStatus(statusInput({
      localProviderStatus: { kind: "checking" },
      localProviderLabel: "Gemma 4 12B local",
      localMemoryLabel: "16 GB RAM",
    }));

    expect(status).toMatchObject({
      tone: "neutral",
      label: "Checking",
      providerLabel: "Gemma 4 12B local",
      memoryLabel: "16.0 GB RAM",
    });
  });

  it("does not attach memory details to cloud AI status", () => {
    const status = resolveAiConnectionStatus(statusInput({
      canUseCloudAi: true,
      localMemoryLabel: "16 GB RAM",
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
      label: "Issue",
      providerLabel: "OpenAI GPT 4o Mini BYOK",
      memoryLabel: null,
    });
  });

  it("returns setup with an error tone when no AI provider is connected", () => {
    const status = resolveAiConnectionStatus(statusInput());

    expect(status).toMatchObject({
      tone: "error",
      label: "Disconnected",
      providerLabel: "Setup needed",
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
          providerLabel: "Gemma 4 12B local",
          memoryLabel: null,
        }}
        onOpenSettings={onOpenSettings}
      />,
    );

    const status = screen.getByRole("button", { name: /ai connection/i });

    expect(status.textContent).toContain("Issue");
    expect(status.textContent).toContain("Gemma 4 12B local");
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
        }}
        onOpenSettings={onOpenSettings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open ai settings/i }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("renders local AI memory when provided", () => {
    render(
      <AiConnectionStatusBar
        status={{
          tone: "ok",
          label: "Connected",
          providerLabel: "Local AI",
          memoryLabel: "16.0 GB RAM",
        }}
        onOpenSettings={vi.fn()}
      />,
    );

    const status = screen.getByRole("button", { name: /memory 16\.0 gb ram/i });

    expect(status.textContent).toContain("16.0 GB RAM");
  });
});

function statusInput(overrides: Partial<AiConnectionStatusInput> = {}): AiConnectionStatusInput {
  return {
    canUseCloudAi: false,
    localProviderStatus: { kind: "unconfigured" },
    localProviderLabel: null,
    localMemoryLabel: null,
    classificationRunning: false,
    classificationIssueKind: null,
    cloudIssueKind: null,
    ...overrides,
  };
}
