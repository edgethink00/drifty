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

const { accessibilityClient, accountStatsPublisherMock, authState, billingMocks, leaderboardMocks, processMocks, trackerClient, tauriEventHandlers, tauriInvoke, updaterMocks } = vi.hoisted(() => {
  const invoke = vi.fn().mockResolvedValue(null);

  return {
    accountStatsPublisherMock: vi.fn(),
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
      createBillingPortalSession: vi.fn().mockResolvedValue({ success: true, data: { url: "https://portal.example.test" } }),
    },
    leaderboardMocks: {
      fetchGlobalLeaderboard: vi.fn(),
      fetchOwnLeaderboardEntry: vi.fn(),
      optOutLeaderboard: vi.fn(),
    },
    processMocks: {
      relaunch: vi.fn().mockResolvedValue(undefined),
    },
    tauriEventHandlers: new Map<string, Array<(event: { payload: unknown }) => void>>(),
    tauriInvoke: invoke,
    trackerClient: {
      getStatus: vi.fn(),
      getTimeline: vi.fn(),
      getDashboardWeekTimeline: vi.fn(),
      getLiveTail: vi.fn(),
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
  useAuthConnectionStatus: () => ({ cloudConnectionStatus: "online" }),
}));

vi.mock("./lib/api/accessibilityClient", () => ({ accessibilityClient }));
vi.mock("./lib/api/trackerClient", () => ({ trackerClient }));
vi.mock("./features/account-stats/useAccountStatsPublisher", () => ({
  useAccountStatsPublisher: accountStatsPublisherMock,
}));
vi.mock("./features/billing/billingService", () => ({
  fetchFriendInvite: vi.fn().mockResolvedValue({ kind: "disabled" }),
  createIndividualCheckout: billingMocks.createIndividualCheckout,
  createBillingPortalSession: billingMocks.createBillingPortalSession,
  fetchBillingEntitlement: billingMocks.fetchBillingEntitlement,
  fetchIndividualPricingQuote: vi.fn().mockResolvedValue({ success: false, error: "Pricing unavailable in this test." }),
}));
vi.mock("./features/leaderboard/leaderboardService", () => ({
  DEFAULT_LEADERBOARD_PERIOD: "weekly",
  LEADERBOARD_PERIODS: ["daily", "weekly", "monthly"],
  fetchGlobalLeaderboard: leaderboardMocks.fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry: leaderboardMocks.fetchOwnLeaderboardEntry,
  fetchOwnLeaderboardCheckpoint: vi.fn().mockResolvedValue({ success: true, error: null, data: null }),
  publishOwnLeaderboardCheckpoint: vi.fn().mockResolvedValue({ success: true, error: null, data: true }),
  optOutLeaderboard: leaderboardMocks.optOutLeaderboard,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriInvoke,
  isTauri: () => false,
}));
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
    trackerClient.getDashboardWeekTimeline.mockResolvedValue([]);
    trackerClient.getLiveTail.mockResolvedValue({
      running: false,
      trackerMode: "tracking",
      lastEventAt: null,
      segments: [],
    });
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
    accessibilityClient.getStatus.mockResolvedValue({ granted: false, required: true });
    accessibilityClient.requestAccess.mockResolvedValue({ granted: true, required: true });
    leaderboardMocks.fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    leaderboardMocks.fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: null });
    leaderboardMocks.optOutLeaderboard.mockResolvedValue({ success: true, error: null });
  });

  it("shows Calendar and the Activity group by default", async () => {
    render(<App />);

    const primaryNav = await screen.findByRole("navigation", { name: /primary navigation/i });
    // Chat is lazy-loaded but is part of the public beta navigation. Observe
    // the settled sidebar before asserting its complete destination list.
    await within(primaryNav).findByRole("button", { name: /^Chat$/i });
    expect(within(primaryNav).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Calendar",
      "Classification",
      "Projects",
      "Insights",
      "History",
      "ChatBeta",
    ]);
    expect(screen.queryByRole("button", { name: /^Agents$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Your Day$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Your Week$/i })).toBeNull();
    // Calendar stands alone above the one labelled group.
    const activityGroup = screen.getByRole("group", { name: /^Activity$/i });
    expect(within(activityGroup).queryByRole("button", { name: /^Calendar$/i })).toBeNull();
    expect(screen.getByText("Social")).toBeTruthy();

    const calendarButton = within(primaryNav).getByRole("button", { name: /^Calendar$/i });
    const classificationButton = within(primaryNav).getByRole("button", { name: /^Classification$/i });
    expect(calendarButton.getAttribute("aria-current")).toBe("page");
    expect(calendarButton.querySelector("small")).toBeNull();
    expect(classificationButton.getAttribute("aria-current")).toBeNull();

    await act(async () => {
      fireEvent.click(classificationButton);
    });
    expect(classificationButton.getAttribute("aria-current")).toBe("page");
    expect(within(primaryNav).getAllByRole("button").filter((button) => button.getAttribute("aria-current") === "page")).toHaveLength(1);

    const socialNav = screen.getByRole("navigation", { name: /social navigation/i });
    const leaderboardButton = within(socialNav).getByRole("button", { name: /^Leaderboard$/i });

    await act(async () => {
      fireEvent.click(leaderboardButton);
    });
    expect(leaderboardButton.getAttribute("aria-current")).toBe("page");
    expect(classificationButton.getAttribute("aria-current")).toBeNull();
  });

  it("switches Calendar between Day and Week in the page and remembers the choice", async () => {
    const first = render(<App />);
    const calendarRange = await screen.findByRole("group", { name: /calendar view/i });
    expect(within(calendarRange).getByRole("button", { name: /^Day$/i }).getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.click(within(calendarRange).getByRole("button", { name: /^Week$/i }));
    });
    expect(window.localStorage.getItem("drifty.dashboard.period.v1")).toBe("Week");

    first.unmount();
    render(<App />);
    const restoredRange = await screen.findByRole("group", { name: /calendar view/i });
    expect(within(restoredRange).getByRole("button", { name: /^Week$/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the web-account publisher disabled when persisted preview state outlives Dev mode", async () => {
    window.localStorage.setItem("drifty.dev.mode", "0");
    window.localStorage.setItem("drifty.dev.webAccountPreview", "1");

    render(<App />);

    await waitFor(() => expect(accountStatsPublisherMock).toHaveBeenCalled());
    const latestPublisherInput = accountStatsPublisherMock.mock.calls[accountStatsPublisherMock.mock.calls.length - 1]?.[0];
    expect(latestPublisherInput).toMatchObject({ active: false });
    await waitFor(() => expect(window.localStorage.getItem("drifty.dev.webAccountPreview")).toBe("0"));
  });

  it("keeps the web-account publisher available while Dev mode and its preview are enabled", async () => {
    window.localStorage.setItem("drifty.dev.mode", "1");
    window.localStorage.setItem("drifty.dev.webAccountPreview", "1");
    window.localStorage.setItem("drifty.dev.disableAiAvailabilityGate", "1");

    render(<App />);

    await waitFor(() => expect(accountStatsPublisherMock).toHaveBeenCalled());
    const latestPublisherInput = accountStatsPublisherMock.mock.calls[accountStatsPublisherMock.mock.calls.length - 1]?.[0];
    expect(latestPublisherInput).toMatchObject({ active: true });
    expect(window.localStorage.getItem("drifty.dev.webAccountPreview")).toBe("1");
  });

  it("replaces the app sidebar with settings navigation and returns with Back", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /^alex$/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^settings$/i }));

    expect(await screen.findByRole("heading", { name: /^Settings$/ })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: /primary navigation/i })).toBeNull();

    const settingsSidebar = screen.getByRole("complementary", { name: /settings navigation/i });
    expect(within(settingsSidebar).getByRole("navigation", { name: /settings sections/i })).toBeTruthy();
    const backButton = within(settingsSidebar).getByRole("button", { name: /^Back$/i });

    act(() => {
      fireEvent.click(backButton);
    });

    await waitFor(() => expect(screen.queryByRole("heading", { name: /^Settings$/ })).toBeNull());
    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
  });

  it("keeps settings navigation expanded and hides the collapse toggle when the sidebar preference is collapsed", async () => {
    window.localStorage.setItem("drifty.sidebar.collapsed", "1");
    render(<App />);

    expect(await screen.findByRole("button", { name: /^Expand sidebar$/i })).toBeTruthy();
    expect(document.querySelector(".app-shell")?.classList.contains("app-shell--sidebar-collapsed")).toBe(true);

    fireEvent.click(await screen.findByRole("button", { name: /^alex$/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^settings$/i }));

    const settingsSidebar = await screen.findByRole("complementary", { name: /settings navigation/i });
    const settingsNav = within(settingsSidebar).getByRole("navigation", { name: /settings sections/i });
    const generalButton = within(settingsNav).getByRole("button", { name: /^General$/ });

    expect(screen.queryByRole("button", { name: /^(Expand|Collapse) sidebar$/i })).toBeNull();
    expect(document.querySelector(".app-shell")?.classList.contains("app-shell--settings")).toBe(true);
    expect(document.querySelector(".app-shell")?.classList.contains("app-shell--sidebar-collapsed")).toBe(false);
    expect(settingsSidebar.classList.contains("sidebar--collapsed")).toBe(false);
    expect(generalButton.querySelector(".nav-item__hover-label")).toBeNull();
  });
});
