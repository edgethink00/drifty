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
      providerLabel: "Cloud AI",
    });
  });

  it("returns running with a green light while classification is active", () => {
    const status = resolveAiConnectionStatus(statusInput({
      localProviderStatus: { kind: "connected" },
      localProviderLabel: "BYOK AI",
      classificationRunning: true,
    }));

    expect(status).toMatchObject({
      tone: "ok",
      label: "Running",
      providerLabel: "BYOK AI",
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
      providerLabel: "Cloud AI",
    });
  });

  it("returns a warning tone for connection issues", () => {
    const status = resolveAiConnectionStatus(statusInput({
      cloudIssueKind: "network",
    }));

    expect(status).toMatchObject({
      tone: "warning",
      label: "Connection issue",
      providerLabel: "Cloud AI",
    });
  });

  it("returns checking while local provider settings are being verified", () => {
    const status = resolveAiConnectionStatus(statusInput({
      localProviderStatus: { kind: "checking" },
      localProviderLabel: "Local AI",
    }));

    expect(status).toMatchObject({
      tone: "neutral",
      label: "Checking",
      providerLabel: "Local AI",
    });
  });

  it("returns provider issue when a tested local provider failed for a non-network reason", () => {
    const status = resolveAiConnectionStatus(statusInput({
      localProviderStatus: { kind: "failed", issueKind: "provider" },
      localProviderLabel: "BYOK AI",
    }));

    expect(status).toMatchObject({
      tone: "error",
      label: "Issue",
      providerLabel: "BYOK AI",
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
          providerLabel: "BYOK AI",
        }}
        onOpenSettings={onOpenSettings}
      />,
    );

    const status = screen.getByRole("button", { name: /ai connection/i });

    expect(status.textContent).toContain("Issue");
    expect(status.textContent).toContain("BYOK AI");
    expect(status.getAttribute("data-tone")).toBe("error");
  });

  it("opens AI settings when clicked", () => {
    const onOpenSettings = vi.fn();
    render(
      <AiConnectionStatusBar
        status={{
          tone: "warning",
          label: "Connection issue",
          providerLabel: "Cloud AI",
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
