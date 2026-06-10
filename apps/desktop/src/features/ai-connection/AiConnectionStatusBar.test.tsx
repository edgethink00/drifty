// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AiConnectionStatusBar,
  resolveAiConnectionStatus,
} from "./AiConnectionStatusBar";

describe("resolveAiConnectionStatus", () => {
  it("returns ready with a green light when cloud AI is available", () => {
    const status = resolveAiConnectionStatus({
      canUseCloudAi: true,
      hasLocalAiProvider: false,
      localProviderLabel: null,
      classificationRunning: false,
      classificationError: null,
      cloudError: null,
    });

    expect(status).toMatchObject({
      tone: "ok",
      label: "Connected",
      providerLabel: "Cloud AI",
    });
  });

  it("returns running with a green light while classification is active", () => {
    const status = resolveAiConnectionStatus({
      canUseCloudAi: false,
      hasLocalAiProvider: true,
      localProviderLabel: "BYOK AI",
      classificationRunning: true,
      classificationError: null,
      cloudError: null,
    });

    expect(status).toMatchObject({
      tone: "ok",
      label: "Running",
      providerLabel: "BYOK AI",
    });
  });

  it("returns error with a red light when the latest AI run failed", () => {
    const status = resolveAiConnectionStatus({
      canUseCloudAi: true,
      hasLocalAiProvider: false,
      localProviderLabel: null,
      classificationRunning: false,
      classificationError: "Quota exceeded",
      cloudError: null,
    });

    expect(status).toMatchObject({
      tone: "error",
      label: "Issue",
      providerLabel: "Cloud AI",
    });
  });

  it("returns setup when no AI provider is connected", () => {
    const status = resolveAiConnectionStatus({
      canUseCloudAi: false,
      hasLocalAiProvider: false,
      localProviderLabel: null,
      classificationRunning: false,
      classificationError: null,
      cloudError: null,
    });

    expect(status).toMatchObject({
      tone: "neutral",
      label: "Disconnected",
      providerLabel: "Setup needed",
    });
  });
});

describe("AiConnectionStatusBar", () => {
  it("renders an accessible status with tone and provider details", () => {
    render(
      <AiConnectionStatusBar
        status={{
          tone: "error",
          label: "Issue",
          providerLabel: "BYOK AI",
        }}
      />,
    );

    const status = screen.getByRole("group", { name: /ai connection/i });

    expect(status.textContent).toContain("Issue");
    expect(status.textContent).toContain("BYOK AI");
    expect(status.getAttribute("data-tone")).toBe("error");
  });
});
