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
    });
  });

  it("returns checking while local provider settings are being verified", () => {
    const status = resolveAiConnectionStatus(statusInput({
      localProviderStatus: { kind: "checking" },
      localProviderLabel: "Gemma 4 12B local",
    }));

    expect(status).toMatchObject({
      tone: "neutral",
      label: "Checking",
      providerLabel: "Gemma 4 12B local",
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
    });
  });

  it("returns setup with an error tone when no AI provider is connected", () => {
    const status = resolveAiConnectionStatus(statusInput());

    expect(status).toMatchObject({
      tone: "error",
      label: "Disconnected",
      providerLabel: "Setup needed",
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
        }}
        onOpenSettings={onOpenSettings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open ai settings/i }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

function statusInput(overrides: Partial<AiConnectionStatusInput> = {}): AiConnectionStatusInput {
  return {
    canUseCloudAi: false,
    localProviderStatus: { kind: "unconfigured" },
    localProviderLabel: null,
    classificationRunning: false,
    classificationIssueKind: null,
    cloudIssueKind: null,
    ...overrides,
  };
}
