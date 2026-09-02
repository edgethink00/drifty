// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../../../localization/LocalizationContext";
import { AccountStep } from "./AccountStep";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

const baseProps: ComponentProps<typeof AccountStep> = {
  accountConnected: false,
  accountAccessState: "disconnected" as const,
  expectsPromotion: false,
  promotionActive: false,
  promotionEndsAt: null,
  authCallbackStatus: null,
  devAuthSkipEnabled: false,
  onSkipAuthForDev: vi.fn(),
  onStartCloudTrialWithEmail: vi.fn(),
  onStartCloudTrialWithGoogle: vi.fn(),
  onStartCloudTrialWithWebsite: vi.fn(),
};

function renderAccountStep(props: Partial<ComponentProps<typeof AccountStep>> = {}) {
  return render(
    <LocalizationTestProvider language="en">
      <AccountStep {...baseProps} {...props} />
    </LocalizationTestProvider>,
  );
}

describe("AccountStep", () => {
  it("prioritizes the claiming browser session only for a promotional handoff", () => {
    const onStartCloudTrialWithWebsite = vi.fn();
    renderAccountStep({ expectsPromotion: true, onStartCloudTrialWithWebsite });

    expect(screen.getByRole("heading", { name: /connect your pro pass/i })).toBeTruthy();
    expect(screen.getByText(/same account that claimed the pass/i)).toBeTruthy();
    expect(screen.getAllByRole("button").slice(0, 3).map((button) => button.textContent)).toEqual([
      expect.stringMatching(/continue with my drifty\.so account/i),
      expect.stringMatching(/continue with google/i),
      expect.stringMatching(/continue with email/i),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /continue with my drifty\.so account/i }));
    expect(onStartCloudTrialWithWebsite).toHaveBeenCalledTimes(1);
  });

  it("keeps the standard onboarding account path to Google and email", () => {
    renderAccountStep();

    expect(screen.getByRole("heading", { name: /connect your account/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /drifty\.so account/i })).toBeNull();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue with email/i })).toBeTruthy();
  });

  it("leaves Calendar consent to Google's own permission screen instead of restating it in onboarding", () => {
    vi.stubEnv("VITE_GOOGLE_CALENDAR_ONBOARDING_ENABLED", "1");
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const onStartCloudTrialWithGoogle = vi.fn();

    renderAccountStep({ onStartCloudTrialWithGoogle });

    expect(screen.queryByText(/calendar/i)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();

    const googleButton = screen.getByRole("button", { name: /continue with google/i });
    fireEvent.click(googleButton);
    expect(onStartCloudTrialWithGoogle).toHaveBeenCalledTimes(1);
  });

  it("shows a busy verification state before confirming promotional access", () => {
    renderAccountStep({
      accountConnected: true,
      accountAccessState: "checking",
      expectsPromotion: true,
    });

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(within(status).getByText(/checking pro access/i)).toBeTruthy();
  });

  it("presents an unavailable verification as a neutral deferred status", () => {
    renderAccountStep({
      accountConnected: true,
      accountAccessState: "verification-deferred",
      expectsPromotion: true,
    });

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("false");
    expect(status.textContent).toMatch(/check pro access again later/i);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
