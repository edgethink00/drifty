// @vitest-environment jsdom
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { shiftIsoDate, todayIsoDate } from "@drifty/domain";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserOnboardingStorageKey } from "./features/onboarding/OnboardingModal";

const {
  authState,
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
  publishOwnFocusTotal,
  optOutLeaderboard,
  fetchOwnProfile,
  saveOwnProfile,
  fetchPublicProfile,
  getTimeline,
  billingMocks,
} = vi.hoisted(() => ({
  authState: {
    user: { email: "alex@example.com" } as { id?: string; email: string | null; is_anonymous?: boolean } | null,
    session: null,
    status: "authenticated" as "authenticated" | "unauthenticated",
    callbackStatus: null,
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
  fetchGlobalLeaderboard: vi.fn(),
  fetchOwnLeaderboardEntry: vi.fn(),
  publishOwnFocusTotal: vi.fn(),
  optOutLeaderboard: vi.fn(),
  fetchOwnProfile: vi.fn(),
  saveOwnProfile: vi.fn(),
  fetchPublicProfile: vi.fn(),
  getTimeline: vi.fn(),
  billingMocks: {
    fetchBillingEntitlement: vi.fn().mockResolvedValue({ success: true, data: { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null } }),
    createIndividualCheckout: vi.fn().mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } }),
  },
}));

vi.mock("./features/auth/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => authState,
}));

vi.mock("./features/leaderboard/leaderboardService", () => ({
  DEFAULT_LEADERBOARD_PERIOD: "weekly",
  LEADERBOARD_PERIODS: ["daily", "weekly", "monthly"],
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
  publishOwnFocusTotal,
  optOutLeaderboard,
}));

vi.mock("./features/profile/profileService", () => ({
  fetchOwnProfile,
  saveOwnProfile,
  fetchPublicProfile,
  fallbackDisplayName: (email?: string | null) => email?.split("@")[0]?.trim() || "drifty",
}));

vi.mock("./lib/api/trackerClient", () => ({
  trackerClient: {
    getStatus: vi.fn().mockResolvedValue({
      running: false,
      accessibilityGranted: false,
      lastEventAt: null,
      databasePath: null,
      trackerMode: "unavailable",
      message: "Tracker not available in this environment",
    }),
    getTimeline,
    getHourlySummary: vi.fn().mockResolvedValue([]),
    getTopSites: vi.fn().mockResolvedValue([]),
    getAppIcons: vi.fn().mockResolvedValue({}),
    start: vi.fn(),
    stop: vi.fn(),
    updateTrayProductivityIcon: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./features/billing/billingService", () => ({
  fetchBillingEntitlement: billingMocks.fetchBillingEntitlement,
  createIndividualCheckout: billingMocks.createIndividualCheckout,
}));

import App from "./App";


function markOnboardingCompleted(userId: string) {
  window.localStorage.setItem(
    getUserOnboardingStorageKey(userId),
    JSON.stringify({
      version: 1,
      completed: true,
      displayName: "Alex",
      purpose: "exploring",
      completedAt: "2026-05-08T00:00:00.000Z",
    }),
  );
}

function formatDayLabel(day: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00`));
}

describe("App leaderboard participation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 2, 13, 15, 0, 0));
    vi.clearAllMocks();
    window.localStorage.clear();
    markOnboardingCompleted("local");
    markOnboardingCompleted("user-1");
    authState.user = { email: "alex@example.com" };
    authState.status = "authenticated";
    authState.callbackStatus = null;
    authState.authMode = "optional";
    authState.isAuthRequired = false;
    authState.allowsAnonymousAuth = true;
    authState.hasRequiredAccountAuth = true;
    authState.hasBlockingAuthConfigurationError = false;
    authState.signInAnonymously.mockResolvedValue({ error: null, user: { email: null } });
    fetchOwnProfile.mockResolvedValue({ success: true, error: null, data: null });
    saveOwnProfile.mockResolvedValue({
      success: true,
      error: null,
      data: {
        public_id: "profile-1",
        display_name: "alex",
        bio: "",
        avatar_url: "",
        website_url: "",
        github_url: "",
        linkedin_url: "",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        is_public: true,
        updated_at: new Date().toISOString(),
      },
    });
    fetchPublicProfile.mockResolvedValue({ success: true, error: null, data: null });
  });

  it("lets signed-out local users browse the public leaderboard without publishing until they join", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.hasRequiredAccountAuth = false;
    getTimeline.mockResolvedValue([]);
    fetchPublicProfile.mockResolvedValue({
      success: true,
      error: null,
      data: {
        public_id: "profile-1",
        display_name: "alex",
        bio: "",
        avatar_url: "",
        website_url: "",
        github_url: "",
        linkedin_url: "",
        focus_seconds_7d: 60,
        rank: 99,
        updated_at: new Date().toISOString(),
      },
    });
    fetchGlobalLeaderboard.mockImplementation(async (period: "daily" | "weekly" | "monthly") => ({
      success: true,
      error: null,
      data: [
        {
          rank: 1,
          public_id: "profile-1",
          display_name: "alex",
          avatar_url: "",
          period,
          focus_seconds: period === "monthly" ? 7200 : 3600,
          focus_seconds_7d: period === "monthly" ? 7200 : 3600,
          window_start_date: shiftIsoDate(todayIsoDate(), period === "monthly" ? -29 : -6),
          window_end_date: todayIsoDate(),
          updated_at: new Date().toISOString(),
        },
      ],
    }));

    render(<App />);

    const nav = await screen.findByRole("navigation", { name: /primary navigation/i });
    fireEvent.click(within(nav).getByRole("button", { name: /^leaderboard$/i }));

    expect(await screen.findByRole("region", { name: /^leaderboard$/i })).toBeTruthy();
    expect(await screen.findByText("alex")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /join leaderboard/i })).toBeTruthy();
    expect(fetchGlobalLeaderboard).toHaveBeenCalledWith("weekly", 100);

    fireEvent.click(await screen.findByRole("button", { name: /^monthly$/i }));
    await waitFor(() => {
      expect(fetchGlobalLeaderboard).toHaveBeenCalledWith("monthly", 100);
    });

    fireEvent.click(await screen.findByRole("button", { name: /view alex profile/i }));
    await waitFor(() => {
      expect(fetchPublicProfile).toHaveBeenCalledWith("profile-1", "monthly");
    });
    await waitFor(() => {
      expect(screen.getAllByText(/rolling 30-day focus total/i).length).toBeGreaterThanOrEqual(1);
    });
    expect(await screen.findByRole("heading", { name: "alex" })).toBeTruthy();
    expect(screen.getAllByText("2h").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("#1").length).toBeGreaterThanOrEqual(1);

    expect(fetchOwnLeaderboardEntry).not.toHaveBeenCalled();
    expect(saveOwnProfile).not.toHaveBeenCalled();
    expect(publishOwnFocusTotal).not.toHaveBeenCalled();
  });

  it("lets signed-out local users join the beta leaderboard with an anonymous session", async () => {
    const today = todayIsoDate();
    const windowStartDay = shiftIsoDate(today, -6);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    authState.user = null;
    authState.status = "unauthenticated";
    authState.hasRequiredAccountAuth = false;
    authState.signInAnonymously.mockImplementation(() => {
      authState.user = { email: null };
      authState.status = "authenticated";
      return Promise.resolve({ error: null, user: { email: null } });
    });
    getTimeline.mockResolvedValue([
      {
        id: "today-window",
        startedAt: `${today}T09:00:00.000Z`,
        endedAt: `${today}T10:00:00.000Z`,
        durationSeconds: 3600,
        appName: "Safari",
        siteTitle: "Developer docs",
        platform: "macos",
        source: "nsworkspace",
      },
    ]);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: null });
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null });

    render(<App />);

    const nav = await screen.findByRole("navigation", { name: /primary navigation/i });
    fireEvent.click(within(nav).getByRole("button", { name: /^leaderboard$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /join leaderboard/i }));

    await waitFor(() => {
      expect(authState.signInAnonymously).toHaveBeenCalledTimes(1);
      expect(saveOwnProfile).toHaveBeenCalledWith({
        display_name: "drifty",
        bio: "",
        avatar_url: "",
        website_url: "",
        github_url: "",
        linkedin_url: "",
        timezone,
        is_public: true,
      });
      expect(publishOwnFocusTotal).toHaveBeenCalledTimes(3);
      expect(publishOwnFocusTotal).toHaveBeenCalledWith({
        profileDisplayName: "alex",
        period: "daily",
        focus_seconds: 3600,
        focus_seconds_7d: 3600,
        window_start_date: today,
        window_end_date: today,
        timezone,
      });
      expect(publishOwnFocusTotal).toHaveBeenCalledWith({
        profileDisplayName: "alex",
        period: "weekly",
        focus_seconds: 3600,
        focus_seconds_7d: 3600,
        window_start_date: windowStartDay,
        window_end_date: today,
        timezone,
      });
      expect(publishOwnFocusTotal).toHaveBeenCalledWith({
        profileDisplayName: "alex",
        period: "monthly",
        focus_seconds: 3600,
        focus_seconds_7d: 3600,
        window_start_date: shiftIsoDate(today, -29),
        window_end_date: today,
        timezone,
      });
    });
    expect(screen.queryByRole("heading", { name: /sign in to drifty/i })).toBeNull();
  });

  it("does not call anonymous sign-in when anonymous leaderboard joins are disabled", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = false;
    getTimeline.mockResolvedValue([]);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });

    render(<App />);

    const nav = await screen.findByRole("navigation", { name: /primary navigation/i });
    fireEvent.click(within(nav).getByRole("button", { name: /^leaderboard$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /join leaderboard/i }));

    await waitFor(() => {
      expect(authState.signInAnonymously).not.toHaveBeenCalled();
      expect(saveOwnProfile).not.toHaveBeenCalled();
      expect(publishOwnFocusTotal).not.toHaveBeenCalled();
    });
    expect(await screen.findByRole("heading", { name: /sign in to drifty/i })).toBeTruthy();
    expect(screen.getByText(/sign in before joining the beta leaderboard/i)).toBeTruthy();
  });

  it("blocks a restored anonymous user from required-mode leaderboard publishing without locking the local shell", async () => {
    authState.user = { id: "anon-1", email: null, is_anonymous: true };
    authState.status = "authenticated";
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = false;
    markOnboardingCompleted("anon-1");
    getTimeline.mockResolvedValue([]);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });

    render(<App />);

    const nav = await screen.findByRole("navigation", { name: /primary navigation/i });
    fireEvent.click(within(nav).getByRole("button", { name: /^leaderboard$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /join leaderboard/i }));

    await waitFor(() => {
      expect(authState.signInAnonymously).not.toHaveBeenCalled();
      expect(saveOwnProfile).not.toHaveBeenCalled();
      expect(publishOwnFocusTotal).not.toHaveBeenCalled();
    });
    expect(await screen.findByRole("heading", { name: /sign in to drifty/i })).toBeTruthy();
    expect(screen.getByText(/sign in with a drifty\.so account before joining the beta leaderboard/i)).toBeTruthy();
  });

  it("lets an optional-mode restored anonymous user publish the beta leaderboard aggregate", async () => {
    const today = todayIsoDate();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    authState.user = { id: "anon-1", email: null, is_anonymous: true };
    authState.status = "authenticated";
    authState.authMode = "optional";
    authState.isAuthRequired = false;
    authState.allowsAnonymousAuth = true;
    authState.hasRequiredAccountAuth = false;
    markOnboardingCompleted("anon-1");
    getTimeline.mockResolvedValue([
      {
        id: "today-window",
        startedAt: `${today}T09:00:00.000Z`,
        endedAt: `${today}T10:00:00.000Z`,
        durationSeconds: 3600,
        appName: "Safari",
        siteTitle: "Developer docs",
        platform: "macos",
        source: "nsworkspace",
      },
    ]);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: null });
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null });

    render(<App />);

    const nav = await screen.findByRole("navigation", { name: /primary navigation/i });
    fireEvent.click(within(nav).getByRole("button", { name: /^leaderboard$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /join leaderboard/i }));

    await waitFor(() => {
      expect(authState.signInAnonymously).not.toHaveBeenCalled();
      expect(saveOwnProfile).toHaveBeenCalledWith({
        display_name: "drifty",
        bio: "",
        avatar_url: "",
        website_url: "",
        github_url: "",
        linkedin_url: "",
        timezone,
        is_public: true,
      });
      expect(publishOwnFocusTotal).toHaveBeenCalledTimes(3);
    });
  });

  it("publishes a today-based leaderboard window even if the app day selection changes elsewhere", async () => {
    const today = todayIsoDate();
    const previousDay = shiftIsoDate(today, -1);
    const windowStartDay = shiftIsoDate(today, -6);
    const monthStartDay = shiftIsoDate(today, -29);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    getTimeline.mockImplementation(async (query: { day?: string; start?: string; end?: string }) => {
      if (query.day === previousDay || (query.start === `${previousDay}T04:00:00` && query.end === `${today}T03:59:59`)) {
        return [
          {
            id: "previous-day",
            startedAt: `${previousDay}T10:00:00.000Z`,
            endedAt: `${previousDay}T10:30:00.000Z`,
            durationSeconds: 1800,
            appName: "Safari",
            siteTitle: "Developer docs",
            platform: "macos",
            source: "nsworkspace",
          },
        ];
      }

      if (
        (query.start === `${windowStartDay}T04:00:00` || query.start === `${monthStartDay}T04:00:00`) &&
        query.end === `${shiftIsoDate(today, 1)}T03:59:59`
      ) {
        return [
          {
            id: "today-window",
            startedAt: `${today}T09:00:00.000Z`,
            endedAt: `${today}T10:00:00.000Z`,
            durationSeconds: 3600,
            appName: "Safari",
            siteTitle: "Developer docs",
            platform: "macos",
            source: "nsworkspace",
          },
        ];
      }

      return [];
    });

    fetchGlobalLeaderboard
      .mockResolvedValueOnce({ success: true, error: null, data: [] })
      .mockResolvedValueOnce({
        success: true,
        error: null,
        data: [
          {
            rank: 1,
            public_id: "profile-1",
            display_name: "alex",
            focus_seconds_7d: 3600,
            window_start_date: windowStartDay,
            window_end_date: today,
            updated_at: new Date().toISOString(),
          },
        ],
      })
      .mockResolvedValueOnce({ success: true, error: null, data: [] });

    fetchOwnLeaderboardEntry
      .mockResolvedValueOnce({ success: true, error: null, data: null })
      .mockResolvedValueOnce({
        success: true,
        error: null,
        data: {
          rank: 1,
          display_name: "alex",
          focus_seconds_7d: 3600,
          window_start_date: windowStartDay,
          window_end_date: today,
          timezone,
          opted_in: true,
          updated_at: new Date().toISOString(),
        },
      })
      .mockResolvedValueOnce({ success: true, error: null, data: null });

    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null });
    optOutLeaderboard.mockResolvedValue({ success: true, error: null });

    render(<App />);

    const nav = await screen.findByRole("navigation", { name: /primary navigation/i });
    fireEvent.click(within(nav).getByRole("button", { name: /^classification$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /show previous day/i }));
    fireEvent.click(within(nav).getByRole("button", { name: /^leaderboard$/i }));

    expect(await screen.findByRole("searchbox", { name: /search leaderboard/i })).toBeTruthy();
    expect(screen.queryByText(formatDayLabel(previousDay))).toBeNull();

    const joinButton = await screen.findByRole("button", { name: /join leaderboard/i });
    fireEvent.click(joinButton);

    await waitFor(() => {
      expect(saveOwnProfile).toHaveBeenCalledWith({
        display_name: "alex",
        bio: "",
        avatar_url: "",
        website_url: "",
        github_url: "",
        linkedin_url: "",
        timezone,
        is_public: true,
      });
      expect(publishOwnFocusTotal).toHaveBeenCalledTimes(3);
      expect(publishOwnFocusTotal).toHaveBeenCalledWith({
        profileDisplayName: "alex",
        period: "weekly",
        focus_seconds: 3600,
        focus_seconds_7d: 3600,
        window_start_date: windowStartDay,
        window_end_date: today,
        timezone,
      });
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    fireEvent.click(await screen.findByRole("button", { name: /^share$/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://drifty.so/profile/?id=profile-1");
    });

    const leaveButton = await screen.findByRole("button", { name: /leave leaderboard/i });
    fireEvent.click(leaveButton);

    await waitFor(() => {
      expect(optOutLeaderboard).toHaveBeenCalledTimes(3);
      expect(optOutLeaderboard).toHaveBeenCalledWith("daily");
      expect(optOutLeaderboard).toHaveBeenCalledWith("weekly");
      expect(optOutLeaderboard).toHaveBeenCalledWith("monthly");
    });

    expect(await screen.findByRole("button", { name: /join leaderboard/i })).toBeTruthy();
  });

  it("reopens sign-in when a stale leaderboard session cannot save a profile", async () => {
    getTimeline.mockResolvedValue([]);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: null });
    saveOwnProfile.mockResolvedValue({ success: false, error: "Not authenticated", data: null });

    render(<App />);

    const nav = await screen.findByRole("navigation", { name: /primary navigation/i });
    fireEvent.click(within(nav).getByRole("button", { name: /^leaderboard$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /join leaderboard/i }));

    expect((await screen.findByRole("status")).textContent).toMatch(/not authenticated/i);
    expect(await screen.findByRole("heading", { name: /sign in to drifty/i })).toBeTruthy();
  });
});
