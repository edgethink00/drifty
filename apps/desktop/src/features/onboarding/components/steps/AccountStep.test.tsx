// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../../../localization/LocalizationContext";
import { AccountStep } from "./AccountStep";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

const baseProps: ComponentProps<typeof AccountStep> = {
  accountConnected: false,
  accountAccessState: "disconnected" as const,
  awaitsContinue: false,
  expectsPromotion: false,
  promotionActive: false,
  promotionEndsAt: null,
  authCallbackStatus: null,
  devAuthSkipEnabled: false,
  onSkipAuthForDev: vi.fn(),
  onContinue: vi.fn(),
  onOpenEmail: vi.fn(),
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

    expect(screen.getAllByRole("button").slice(0, 3).map((button) => button.textContent)).toEqual([
      expect.stringMatching(/continue with my drifty\.so account/i),
      expect.stringMatching(/continue with google/i),
      expect.stringMatching(/continue with email/i),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /continue with my drifty\.so account/i }));
    expect(onStartCloudTrialWithWebsite).toHaveBeenCalledTimes(1);
  });

  it("keeps the standard onboarding account path to Google and email", () => {
    const onOpenEmail = vi.fn();
    renderAccountStep({ onOpenEmail });

    expect(screen.queryByRole("button", { name: /drifty\.so account/i })).toBeNull();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /continue with email/i }));
    expect(onOpenEmail).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: /terms/i })).toBeTruthy();
  });

  it("offers Continue instead of sign-in when the account was already connected", () => {
    const onContinue = vi.fn();
    renderAccountStep({ accountConnected: true, accountAccessState: "standard-confirmed", awaitsContinue: true, onContinue });

    expect(within(screen.getByRole("status")).getByText(/account connected/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /continue with google/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /terms/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("leaves without a button after signing in on the screen", () => {
    renderAccountStep({ accountConnected: true, accountAccessState: "standard-confirmed", awaitsContinue: false });

    expect(within(screen.getByRole("status")).getByText(/account connected/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps the Pro pass end date and its no-card note once the pass is active", () => {
    renderAccountStep({
      accountConnected: true,
      accountAccessState: "promotion-confirmed",
      awaitsContinue: true,
      promotionActive: true,
      promotionEndsAt: "2026-11-06T00:00:00.000Z",
    });

    expect(within(screen.getByRole("status")).getByText(/pro access is active/i)).toBeTruthy();
    expect(screen.getByText(/no card required and no automatic renewal/i)).toBeTruthy();
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

  it("keeps required onboarding auth in place while offline and offers a retry", async () => {
    const onStartCloudTrialWithWebsite = vi.fn();
    const onStartCloudTrialWithGoogle = vi.fn();
    const onOpenEmail = vi.fn();
    const onRetryCloudConnection = vi.fn().mockResolvedValue({ error: null });
    renderAccountStep({
      expectsPromotion: true,
      cloudConnectionStatusOverride: "offline",
      onStartCloudTrialWithWebsite,
      onStartCloudTrialWithGoogle,
      onOpenEmail,
      onRetryCloudConnection,
    });

    expect(screen.getByRole("alert").textContent).toMatch(/connect to the internet/i);
    const providerButtons = [
      screen.getByRole("button", { name: /drifty\.so account/i }),
      screen.getByRole("button", { name: /continue with google/i }),
    ] as HTMLButtonElement[];
    expect(providerButtons.every((button) => button.disabled)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /continue with email/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry connection/i }));
      await Promise.resolve();
    });
    expect(onRetryCloudConnection).toHaveBeenCalledTimes(1);
    expect(onStartCloudTrialWithWebsite).not.toHaveBeenCalled();
    expect(onStartCloudTrialWithGoogle).not.toHaveBeenCalled();
    expect(onOpenEmail).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/continue without signing in/i)).toBeNull();
  });
});
