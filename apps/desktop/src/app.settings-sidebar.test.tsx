// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserOnboardingStorageKey } from "./features/onboarding/OnboardingModal";

type AuthUserMock = {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
};

const { accessibilityClient, authState, billingMocks, processMocks, trackerClient, tauriEventHandlers, tauriInvoke, updaterMocks } = vi.hoisted(() => {
  const invoke = vi.fn().mockResolvedValue(null);

  return {
    accessibilityClient: {
      getStatus: vi.fn(),
      requestAccess: vi.fn(),
    },
    authState: {
      user: { id: "user-1", email: "alex@example.com" } as AuthUserMock | null,
      session: null,
      status: "authenticated" as "loading" | "authenticated" | "unauthenticated",
      callbackStatus: null as { phase: "waiting" | "received" | "exchanging" | "completed" | "failed"; message: string } | null,
      isEnabled: true,
      authMode: "optional" as "optional" | "required",
      isAuthRequired: false,
      allowsAnonymousAuth: true,
      hasRequiredAccountAuth: true,
      hasBlockingAuthConfigurationError: false,
      signInAnonymously: vi.fn(),
      signInWithWebsite: vi.fn(),
      signInWithGoogle: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      clearCallbackStatus: vi.fn(),
      signOut: vi.fn(),
    },
    billingMocks: {
      fetchBillingEntitlement: vi.fn().mockResolvedValue({ success: true, data: { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null } }),
      createIndividualCheckout: vi.fn().mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } }),
    },
    processMocks: {
      relaunch: vi.fn().mockResolvedValue(undefined),
    },
    tauriEventHandlers: new Map<string, Array<(event: { payload: unknown }) => void>>(),
    tauriInvoke: invoke,
    trackerClient: {
      getStatus: vi.fn(),
      getTimeline: vi.fn(),
      getCurrentSnapshot: vi.fn(),
      getHourlySummary: vi.fn(),
      getTopSites: vi.fn(),
      getAppIcons: vi.fn(),
      getClassificationRules: vi.fn(),
      saveClassificationRule: vi.fn(),
      deleteClassificationRule: vi.fn(),
      searchClassificationRuleCandidates: vi.fn(),
      applyClassificationRules: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      updateTrayProductivityIcon: vi.fn(),
    },
    updaterMocks: {
      check: vi.fn().mockResolvedValue(null),
    },
  };
});

vi.mock("./features/auth/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => authState,
}));

vi.mock("./lib/api/accessibilityClient", () => ({ accessibilityClient }));
vi.mock("./lib/api/trackerClient", () => ({ trackerClient }));
vi.mock("./features/billing/billingService", () => ({
  createIndividualCheckout: billingMocks.createIndividualCheckout,
  fetchBillingEntitlement: billingMocks.fetchBillingEntitlement,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriInvoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, handler: (event: { payload: unknown }) => void) => {
    const handlers = tauriEventHandlers.get(eventName) ?? [];
    handlers.push(handler);
    tauriEventHandlers.set(eventName, handlers);

    return Promise.resolve(() => {
      const currentHandlers = tauriEventHandlers.get(eventName) ?? [];
      tauriEventHandlers.set(eventName, currentHandlers.filter((currentHandler) => currentHandler !== handler));
    });
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: processMocks.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: updaterMocks.check }));

import App from "./App";

function markOnboardingCompleted(userId: string) {
  window.localStorage.setItem(
    getUserOnboardingStorageKey(userId),
    JSON.stringify({
      completed: true,
      completedAt: "2026-05-08T00:00:00.000Z",
      displayName: "Alex",
      purpose: "exploring",
      version: 1,
    }),
  );
}

describe("App settings sidebar", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 4, 20, 13, 15, 0, 0));
    vi.clearAllMocks();
    tauriEventHandlers.clear();
    window.localStorage.clear();
    markOnboardingCompleted("user-1");
    markOnboardingCompleted("local");
    trackerClient.getStatus.mockResolvedValue({
      accessibilityGranted: false,
      databasePath: null,
      lastEventAt: null,
      message: "Tracker not available in this environment",
      running: false,
      trackerMode: "unavailable",
    });
    trackerClient.getTimeline.mockResolvedValue([]);
    trackerClient.getCurrentSnapshot.mockResolvedValue(null);
    trackerClient.getHourlySummary.mockResolvedValue([]);
    trackerClient.getTopSites.mockResolvedValue([]);
    trackerClient.getAppIcons.mockResolvedValue({});
    trackerClient.getClassificationRules.mockResolvedValue([]);
    trackerClient.deleteClassificationRule.mockResolvedValue({ deleted: 0 });
    trackerClient.searchClassificationRuleCandidates.mockResolvedValue([]);
    trackerClient.applyClassificationRules.mockResolvedValue({ appliedCount: 0, matchedCount: 0, skippedCount: 0 });
    trackerClient.start.mockResolvedValue({ running: true });
    trackerClient.stop.mockResolvedValue({ running: false });
    trackerClient.updateTrayProductivityIcon.mockResolvedValue(undefined);
    accessibilityClient.getStatus.mockResolvedValue({ granted: false });
    accessibilityClient.requestAccess.mockResolvedValue({ granted: true });
  });

  it("replaces the app sidebar with settings navigation and returns with Back", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /alex drifty cloud ai/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^settings$/i }));

    expect(await screen.findByRole("heading", { name: /^Settings$/ })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: /dashboard views/i })).toBeNull();
    expect(screen.queryByRole("navigation", { name: /primary navigation/i })).toBeNull();

    const settingsSidebar = screen.getByRole("complementary", { name: /settings navigation/i });
    expect(within(settingsSidebar).getByRole("navigation", { name: /settings sections/i })).toBeTruthy();
    const backButton = within(settingsSidebar).getByRole("button", { name: /^Back$/i });

    act(() => {
      fireEvent.click(backButton);
    });

    await waitFor(() => expect(screen.queryByRole("heading", { name: /^Settings$/ })).toBeNull());
    expect(await screen.findByRole("navigation", { name: /dashboard views/i })).toBeTruthy();
  });
});
