// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../../../localization/LocalizationContext";
import { connectionChecksForSetup, type ConnectionFailure } from "../../onboardingFlow";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { TestConnectionStep } from "./TestConnectionStep";

afterEach(cleanup);

function renderFailedTest(failure: ConnectionFailure, language: "en" | "ko" = "ko") {
  const retryConnectionTest = vi.fn();
  const flow = {
    connectionPhase: "failed",
    connectionFailure: failure,
    connectionChecks: connectionChecksForSetup("byok"),
    checkStatuses: ["success", "error", "pending"],
    isByokSetup: true,
    retryConnectionTest,
  } as unknown as OnboardingFlow;
  render(
    <LocalizationTestProvider language={language}>
      <TestConnectionStep flow={flow} />
    </LocalizationTestProvider>,
  );
  return { retryConnectionTest };
}

describe("onboarding connection test failure", () => {
  it("shows Korean check labels and a known provider failure without English fallbacks", () => {
    renderFailedTest({ kind: "remote", message: "OpenRouter rejected the API key." });

    expect(screen.getByText("OpenRouter 키 형식 확인")).toBeTruthy();
    expect(screen.getByText("제공업체 연결 확인")).toBeTruthy();
    expect(screen.queryByText(/OpenRouter rejected the API key/)).toBeNull();
  });

  it("keeps an unrecognized error only as a detail after the next step", () => {
    renderFailedTest({ kind: "remote", message: "socket hang up" }, "en");

    expect(screen.getByText("Check your settings and network. Details: socket hang up")).toBeTruthy();
  });

  it("offers a retry that reruns the test", () => {
    const { retryConnectionTest } = renderFailedTest({ kind: "local", key: "onboarding.connection.invalidKey" });

    expect(screen.getByText("OpenRouter 키는 sk-or-로 시작해야 합니다.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다시 테스트" }));
    expect(retryConnectionTest).toHaveBeenCalledTimes(1);
  });
});
