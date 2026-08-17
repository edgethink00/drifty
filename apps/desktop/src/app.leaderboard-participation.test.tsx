// @vitest-environment jsdom
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { shiftIsoDate, todayIsoDate, type ActivitySegment } from "@drifty/domain";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardPeriod, LeaderboardResult, LeaderboardRow, OwnLeaderboardEntry } from "./features/leaderboard/leaderboardService";
import { LEADERBOARD_AUTO_PUBLISH_STORAGE_KEY } from "./features/leaderboard/leaderboardAutoPublishState";
import { getUserOnboardingStorageKey } from "./features/onboarding/OnboardingModal";

const {
  authState,
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
  fetchOwnLeaderboardCheckpoint,
  publishOwnLeaderboardCheckpoint,
  publishOwnFocusTotal,
  optOutLeaderboard,
  fetchOwnProfile,
  saveOwnProfile,
  fetchPublicProfile,
  getTimeline,
  billingMocks,
} = vi.hoisted(() => ({
  authState: {
    user: { email: "alex@example.com" } as { id?: string; email: string | null; is_anonymous?: boolean; user_metadata?: Record<string, unknown> } | null,
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
  fetchOwnLeaderboardCheckpoint: vi.fn().mockResolvedValue({ success: true, error: null, data: null }),
  publishOwnLeaderboardCheckpoint: vi.fn().mockResolvedValue({ success: true, error: null, data: true }),
  publishOwnFocusTotal: vi.fn(),
  optOutLeaderboard: vi.fn(),
  fetchOwnProfile: vi.fn(),
  saveOwnProfile: vi.fn(),
  fetchPublicProfile: vi.fn(),
  getTimeline: vi.fn(),
  billingMocks: {
    fetchBillingEntitlement: vi.fn().mockResolvedValue({ success: true, data: { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null } }),
    createIndividualCheckout: vi.fn().mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } }),
    createBillingPortalSession: vi.fn().mockResolvedValue({ success: true, data: { url: "https://portal.example.test" } }),
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
  fetchOwnLeaderboardCheckpoint,
  publishOwnLeaderboardCheckpoint,
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
    getDashboardWeekTimeline: vi.fn().mockResolvedValue([]),
    getLiveTail: vi.fn().mockResolvedValue({
      running: false,
      trackerMode: "tracking",
      lastEventAt: null,
      segments: [],
    }),
    getHourlySummary: vi.fn().mockResolvedValue([]),
    getTopSites: vi.fn().mockResolvedValue([]),
    getAppIcons: vi.fn().mockResolvedValue({}),
    start: vi.fn(),
    stop: vi.fn(),
    updateTrayProductivityIcon: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./features/share/focusCardService", () => ({
  DEFAULT_FOCUS_CARD_DETAIL_FLAGS: { shareCategoryBreakdown: false, shareHourlyPattern: false },
  fetchOwnFocusCard: vi.fn().mockResolvedValue({
    success: true,
    error: null,
    data: {
      enabled: true,
      detailFlags: { shareCategoryBreakdown: false, shareHourlyPattern: false },
      updatedAt: null,
    },
  }),
  publishFocusCard: vi.fn().mockResolvedValue({ success: true, error: null }),
  refreshFocusCardAggregates: vi.fn().mockResolvedValue({ success: true, error: null }),
  setFocusCardEnabled: vi.fn().mockResolvedValue({ success: true, error: null }),
  setFocusCardDetailFlags: vi.fn().mockResolvedValue({ success: true, error: null }),
}));

vi.mock("./features/billing/billingService", () => ({
  fetchBillingEntitlement: billingMocks.fetchBillingEntitlement,
  createIndividualCheckout: billingMocks.createIndividualCheckout,
  createBillingPortalSession: billingMocks.createBillingPortalSession,
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

async function openSocialLeaderboard() {
  const nav = await screen.findByRole("navigation", { name: /social navigation/i });
  fireEvent.click(within(nav).getByRole("button", { name: /^leaderboard$/i }));
  await screen.findByRole("heading", { name: /global focus ranking/i });
  await screen.findByRole("region", { name: /^leaderboard$/i });
}

/** Profile is a Dev-mode beta surface — call before render(<App/>) to expose it. */
function enableProfileBetaGate() {
  window.localStorage.setItem("drifty.dev.mode", "1");
  window.localStorage.setItem("drifty.dev.profileBeta", "1");
}

async function openSocialProfile() {
  const nav = await screen.findByRole("navigation", { name: /social navigation/i });
  fireEvent.click(within(nav).getByRole("button", { name: /^profile$/i }));
  await screen.findByRole("heading", { name: /^profile$/i });
}

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: ((value: T) => void) | undefined;
  let rejectDeferred: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });

  if (!resolveDeferred || !rejectDeferred) throw new Error("Unable to create deferred promise");

  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred,
  };
}

function makeLeaderboardRow(period: LeaderboardPeriod): LeaderboardRow {
  return {
    rank: 1,
    public_id: "profile-1",
    display_name: "Alex",
    avatar_url: "",
    period,
    focus_seconds: 3600,
    focus_seconds_7d: 3600,
    window_start_date: shiftIsoDate(todayIsoDate(), period === "monthly" ? -29 : -6),
    window_end_date: todayIsoDate(),
    updated_at: new Date().toISOString(),
  };
}

function makeOwnLeaderboardEntry(period: LeaderboardPeriod): OwnLeaderboardEntry {
  return {
    rank: 1,
    display_name: "Alex",
    period,
    focus_seconds: 3600,
    focus_seconds_7d: 3600,
    window_start_date: shiftIsoDate(todayIsoDate(), period === "monthly" ? -29 : -6),
    window_end_date: todayIsoDate(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    opted_in: true,
    updated_at: new Date().toISOString(),
  };
}

describe("App leaderboard participation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 2, 13, 15, 0, 0));
    vi.clearAllMocks();
    fetchGlobalLeaderboard.mockReset().mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockReset().mockResolvedValue({ success: true, error: null, data: null });
    fetchOwnLeaderboardCheckpoint.mockReset().mockResolvedValue({ success: true, error: null, data: null });
    publishOwnLeaderboardCheckpoint.mockReset().mockResolvedValue({ success: true, error: null, data: true });
    publishOwnFocusTotal.mockReset().mockResolvedValue({ success: true, error: null });
    optOutLeaderboard.mockReset().mockResolvedValue({ success: true, error: null });
    window.localStorage.clear();
    enableProfileBetaGate();
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

    await openSocialLeaderboard();

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
        siteDomain: "stackoverflow.com",
        siteTitle: "Developer docs",
        platform: "macos",
        source: "nsworkspace",
      },
    ]);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: null });
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null });

    render(<App />);

    await openSocialLeaderboard();
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

  it("automatically republishes opted-in signed-in users after the daily publish cadence passes", async () => {
    const today = todayIsoDate();
    const windowStartDay = shiftIsoDate(today, -6);
    const monthStartDay = shiftIsoDate(today, -29);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const staleRemoteUpdatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    authState.user = { id: "user-1", email: "alex@example.com" };
    fetchOwnProfile.mockResolvedValue({
      success: true,
      error: null,
      data: {
        public_id: "profile-1",
        display_name: "Alex Remote",
        bio: "",
        avatar_url: "",
        website_url: "",
        github_url: "",
        linkedin_url: "",
        timezone,
        is_public: true,
        updated_at: new Date().toISOString(),
      },
    });
    getTimeline.mockResolvedValue([
      {
        id: "today-window",
        startedAt: `${today}T09:00:00.000Z`,
        endedAt: `${today}T10:00:00.000Z`,
        durationSeconds: 3600,
        appName: "Safari",
        siteDomain: "stackoverflow.com",
        siteTitle: "Developer docs",
        platform: "macos",
        source: "nsworkspace",
      },
    ]);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockImplementation(async (period: LeaderboardPeriod = "weekly") => ({
      success: true,
      error: null,
      data: {
        ...makeOwnLeaderboardEntry(period),
        display_name: "Alex Remote",
        timezone,
        updated_at: staleRemoteUpdatedAt,
      },
    }));
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null });

    render(<App />);

    await waitFor(() => {
      expect(publishOwnFocusTotal).toHaveBeenCalledTimes(3);
    });
    expect(authState.signInAnonymously).not.toHaveBeenCalled();
    expect(saveOwnProfile).not.toHaveBeenCalled();
    expect(publishOwnFocusTotal).toHaveBeenCalledWith({
      profileDisplayName: "Alex Remote",
      period: "daily",
      focus_seconds: 3600,
      focus_seconds_7d: 3600,
      window_start_date: today,
      window_end_date: today,
      timezone,
    }, undefined, { updateProfile: false });
    expect(publishOwnFocusTotal).toHaveBeenCalledWith({
      profileDisplayName: "Alex Remote",
      period: "weekly",
      focus_seconds: 3600,
      focus_seconds_7d: 3600,
      window_start_date: windowStartDay,
      window_end_date: today,
      timezone,
    }, undefined, { updateProfile: false });
    expect(publishOwnFocusTotal).toHaveBeenCalledWith({
      profileDisplayName: "Alex Remote",
      period: "monthly",
      focus_seconds: 3600,
      focus_seconds_7d: 3600,
      window_start_date: monthStartDay,
      window_end_date: today,
      timezone,
    }, undefined, { updateProfile: false });
  });

  it("does not automatically republish opted-in users when the remote row is in the current hour slot", async () => {
    const today = todayIsoDate();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    // Pinned clock is 2026-06-02 13:15 local; 13:05 shares the current hour slot.
    const sameSlotRemoteUpdatedAt = new Date(2026, 5, 2, 13, 5, 0, 0).toISOString();

    authState.user = { id: "user-1", email: "alex@example.com" };
    fetchOwnProfile.mockResolvedValue({
      success: true,
      error: null,
      data: {
        public_id: "profile-1",
        display_name: "Alex Remote",
        bio: "",
        avatar_url: "",
        website_url: "",
        github_url: "",
        linkedin_url: "",
        timezone,
        is_public: true,
        updated_at: new Date().toISOString(),
      },
    });
    getTimeline.mockResolvedValue([
      {
        id: "today-window",
        startedAt: `${today}T09:00:00.000Z`,
        endedAt: `${today}T10:00:00.000Z`,
        durationSeconds: 3600,
        appName: "Safari",
        siteDomain: "stackoverflow.com",
        siteTitle: "Developer docs",
        platform: "macos",
        source: "nsworkspace",
      },
    ]);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockImplementation(async (period: LeaderboardPeriod = "weekly") => ({
      success: true,
      error: null,
      data: {
        ...makeOwnLeaderboardEntry(period),
        display_name: "Alex Remote",
        timezone,
        updated_at: sameSlotRemoteUpdatedAt,
      },
    }));
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null });

    render(<App />);

    await waitFor(() => {
      expect(fetchOwnLeaderboardEntry).toHaveBeenCalledWith("daily");
      expect(fetchOwnLeaderboardEntry).toHaveBeenCalledWith("weekly");
      expect(fetchOwnLeaderboardEntry).toHaveBeenCalledWith("monthly");
    });
    expect(publishOwnFocusTotal).not.toHaveBeenCalled();
  });

  it("keeps current-slot publishing suppressed while materializing a due closed weekly result", async () => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const sameSlotSuccessAt = new Date(2026, 5, 2, 13, 5, 0, 0).toISOString();

    authState.user = { id: "user-1", email: "alex@example.com" };
    fetchOwnProfile.mockResolvedValue({
      success: true,
      error: null,
      data: {
        public_id: "profile-1",
        display_name: "Alex Remote",
        bio: "",
        avatar_url: "",
        website_url: "",
        github_url: "",
        linkedin_url: "",
        timezone,
        is_public: true,
        updated_at: new Date().toISOString(),
      },
    });
    window.localStorage.setItem(LEADERBOARD_AUTO_PUBLISH_STORAGE_KEY, JSON.stringify(
      (["daily", "weekly", "monthly"] as const).map((period) => ({
        userScopeKey: "user-1",
        period,
        payloadKey: `${period}-current-slot`,
        lastAttemptAt: sameSlotSuccessAt,
        lastSuccessAt: sameSlotSuccessAt,
        lastErrorAt: null,
      })),
    ));
    getTimeline.mockReset().mockResolvedValue([]);
    fetchOwnLeaderboardEntry.mockImplementation(async (period: LeaderboardPeriod = "weekly") => ({
      success: true,
      error: null,
      data: makeOwnLeaderboardEntry(period),
    }));

    render(<App />);

    await waitFor(() => {
      expect(fetchOwnProfile).toHaveBeenCalledTimes(1);
    });
    await vi.advanceTimersByTimeAsync(100);

    // Public rows remain slot-gated, while the separate owner checkpoint path
    // computes the closed window without replacing the current board row.
    expect(fetchOwnLeaderboardEntry).toHaveBeenCalledWith("daily");
    expect(fetchOwnLeaderboardEntry).toHaveBeenCalledWith("weekly");
    expect(fetchOwnLeaderboardEntry).toHaveBeenCalledWith("monthly");
    expect(publishOwnLeaderboardCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      period: "weekly",
      windowEndDay: "2026-05-31",
    }));
    expect(publishOwnFocusTotal).not.toHaveBeenCalled();
  });

  it("automatically republishes only periods whose hour slot has advanced", async () => {
    const today = todayIsoDate();
    const windowStartDay = shiftIsoDate(today, -6);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    // Pinned clock is 2026-06-02 13:15 local. daily/monthly last published inside
    // the current 13:00 hour slot (still throttled); weekly published two slots ago.
    const sameSlotAt = new Date(2026, 5, 2, 13, 5, 0, 0).toISOString();
    const previousSlotAt = new Date(2026, 5, 2, 11, 0, 0, 0).toISOString();

    window.localStorage.setItem(LEADERBOARD_AUTO_PUBLISH_STORAGE_KEY, JSON.stringify([
      {
        userScopeKey: "user-1",
        period: "daily",
        payloadKey: "previous-daily",
        lastAttemptAt: sameSlotAt,
        lastSuccessAt: sameSlotAt,
        lastErrorAt: null,
      },
      {
        userScopeKey: "user-1",
        period: "weekly",
        payloadKey: "previous-weekly",
        lastAttemptAt: previousSlotAt,
        lastSuccessAt: previousSlotAt,
        lastErrorAt: null,
      },
      {
        userScopeKey: "user-1",
        period: "monthly",
        payloadKey: "previous-monthly",
        lastAttemptAt: sameSlotAt,
        lastSuccessAt: sameSlotAt,
        lastErrorAt: null,
      },
    ]));

    authState.user = { id: "user-1", email: "alex@example.com" };
    fetchOwnProfile.mockResolvedValue({
      success: true,
      error: null,
      data: {
        public_id: "profile-1",
        display_name: "Alex Remote",
        bio: "",
        avatar_url: "",
        website_url: "",
        github_url: "",
        linkedin_url: "",
        timezone,
        is_public: true,
        updated_at: new Date().toISOString(),
      },
    });
    getTimeline.mockResolvedValue([
      {
        id: "today-window",
        startedAt: `${today}T09:00:00.000Z`,
        endedAt: `${today}T10:00:00.000Z`,
        durationSeconds: 3600,
        appName: "Safari",
        siteDomain: "stackoverflow.com",
        siteTitle: "Developer docs",
        platform: "macos",
        source: "nsworkspace",
      },
    ]);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockImplementation(async (period: LeaderboardPeriod = "weekly") => ({
      success: true,
      error: null,
      data: {
        ...makeOwnLeaderboardEntry(period),
        display_name: "Alex Remote",
        timezone,
      },
    }));
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null });

    render(<App />);

    await waitFor(() => {
      expect(publishOwnFocusTotal).toHaveBeenCalledTimes(1);
    });
    expect(publishOwnFocusTotal).toHaveBeenCalledWith({
      profileDisplayName: "Alex Remote",
      period: "weekly",
      focus_seconds: 3600,
      focus_seconds_7d: 3600,
      window_start_date: windowStartDay,
      window_end_date: today,
      timezone,
    }, undefined, { updateProfile: false });
  });

  it("shows joined controls after a signed-out anonymous join refresh", async () => {
    const today = todayIsoDate();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const zeroFocusRow = {
      ...makeLeaderboardRow("weekly"),
      display_name: "alex",
      focus_seconds: 0,
      focus_seconds_7d: 0,
      window_start_date: shiftIsoDate(today, -6),
      window_end_date: today,
    };
    const zeroFocusOwnEntry = {
      ...makeOwnLeaderboardEntry("weekly"),
      display_name: "alex",
      focus_seconds: 0,
      focus_seconds_7d: 0,
      window_start_date: shiftIsoDate(today, -6),
      window_end_date: today,
    };

    authState.user = null;
    authState.status = "unauthenticated";
    authState.hasRequiredAccountAuth = false;
    authState.signInAnonymously.mockImplementation(() => {
      authState.user = { email: null };
      authState.status = "authenticated";
      return Promise.resolve({ error: null, user: { email: null } });
    });
    getTimeline.mockResolvedValue([]);
    fetchGlobalLeaderboard
      .mockResolvedValueOnce({ success: true, error: null, data: [] })
      .mockResolvedValue({ success: true, error: null, data: [zeroFocusRow] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: zeroFocusOwnEntry });
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null });

    render(<App />);

    await openSocialLeaderboard();
    fireEvent.click(await screen.findByRole("button", { name: /join leaderboard/i }));

    await waitFor(() => {
      expect(authState.signInAnonymously).toHaveBeenCalledTimes(1);
      expect(publishOwnFocusTotal).toHaveBeenCalledTimes(3);
      expect(fetchGlobalLeaderboard).toHaveBeenCalledWith("weekly", 100);
    });

    expect(screen.queryByText(/loading leaderboard/i)).toBeNull();
    expect(fetchOwnLeaderboardEntry).toHaveBeenCalledWith("weekly");
    expect(await screen.findByRole("button", { name: /^leave leaderboard$/i })).toBeTruthy();
    await openSocialProfile();
    expect(await screen.findByRole("button", { name: /edit profile/i })).toBeTruthy();
    expect(saveOwnProfile).toHaveBeenCalledWith(expect.objectContaining({ timezone, is_public: true }));
  });

  it("prefills the leaderboard profile photo from Google metadata when the user has no saved avatar", async () => {
    const googleAvatarUrl = "https://lh3.googleusercontent.com/a/avatar.png";
    authState.user = {
      id: "user-1",
      email: "alex@example.com",
      user_metadata: { picture: googleAvatarUrl },
    };
    getTimeline.mockResolvedValue([]);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: null });
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null });

    render(<App />);

    await openSocialLeaderboard();
    fireEvent.click(await screen.findByRole("button", { name: /join leaderboard/i }));

    await waitFor(() => {
      expect(saveOwnProfile).toHaveBeenCalledWith(expect.objectContaining({
        avatar_url: googleAvatarUrl,
      }));
    });
  });

  it("keeps an existing Drifty profile photo instead of replacing it with Google metadata", async () => {
    const profileAvatarUrl = "data:image/png;base64,profile-photo";
    authState.user = {
      id: "user-1",
      email: "alex@example.com",
      user_metadata: { picture: "https://lh3.googleusercontent.com/a/avatar.png" },
    };
    fetchOwnProfile.mockResolvedValue({
      success: true,
      error: null,
      data: {
        public_id: "profile-1",
        display_name: "Alex",
        bio: "",
        avatar_url: profileAvatarUrl,
        website_url: "",
        github_url: "",
        linkedin_url: "",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        is_public: true,
        updated_at: new Date().toISOString(),
      },
    });
    getTimeline.mockResolvedValue([]);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: null });
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null });

    render(<App />);

    await openSocialLeaderboard();
    fireEvent.click(await screen.findByRole("button", { name: /join leaderboard/i }));

    await waitFor(() => {
      expect(saveOwnProfile).toHaveBeenCalledWith(expect.objectContaining({
        avatar_url: profileAvatarUrl,
      }));
    });
  });

  it("does not call anonymous sign-in when anonymous leaderboard joins are disabled", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = false;
    getTimeline.mockResolvedValue([]);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });

    render(<App />);

    await openSocialLeaderboard();
    fireEvent.click(await screen.findByRole("button", { name: /join leaderboard/i }));

    await waitFor(() => {
      expect(authState.signInAnonymously).not.toHaveBeenCalled();
      expect(saveOwnProfile).not.toHaveBeenCalled();
      expect(publishOwnFocusTotal).not.toHaveBeenCalled();
    });
    expect(await screen.findByRole("heading", { name: /sign in to drifty/i })).toBeTruthy();
    expect(screen.getByText(/sign in before joining the beta leaderboard/i)).toBeTruthy();
  });

  it("blocks a restored anonymous user from required-mode leaderboard publishing through account onboarding", async () => {
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

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();

    await waitFor(() => {
      expect(authState.signInAnonymously).not.toHaveBeenCalled();
      expect(saveOwnProfile).not.toHaveBeenCalled();
      expect(publishOwnFocusTotal).not.toHaveBeenCalled();
    });
    expect(screen.queryByRole("navigation", { name: /primary navigation/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /sign in to drifty/i })).toBeNull();
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
        siteDomain: "stackoverflow.com",
        siteTitle: "Developer docs",
        platform: "macos",
        source: "nsworkspace",
      },
    ]);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: null });
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null });

    render(<App />);

    await openSocialLeaderboard();
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
            siteDomain: "stackoverflow.com",
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
            siteDomain: "stackoverflow.com",
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
    await openSocialLeaderboard();

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

    const leaveButton = await screen.findByRole("button", { name: /^leave leaderboard$/i });
    fireEvent.click(leaveButton);

    await waitFor(() => {
      expect(optOutLeaderboard).toHaveBeenCalledTimes(3);
      expect(optOutLeaderboard).toHaveBeenCalledWith("daily");
      expect(optOutLeaderboard).toHaveBeenCalledWith("weekly");
      expect(optOutLeaderboard).toHaveBeenCalledWith("monthly");
    });

    expect(await screen.findByRole("button", { name: /join leaderboard/i })).toBeTruthy();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    fireEvent.click(await screen.findByRole("button", { name: /^alex$/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /my profile/i }));
    fireEvent.click(await screen.findByRole("button", { name: /profile embed/i }));
    fireEvent.click(await screen.findByRole("button", { name: /copy profile link/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://drifty.so/profile/?id=profile-1");
    });
  });

  it("keeps rendered leaderboard content mounted during a deferred refresh after initial load", async () => {
    const deferredLeaderboard = createDeferred<LeaderboardResult<LeaderboardRow[]>>();
    getTimeline.mockResolvedValue([]);
    fetchGlobalLeaderboard
      .mockResolvedValueOnce({ success: true, error: null, data: [makeLeaderboardRow("weekly")] })
      .mockReturnValueOnce(deferredLeaderboard.promise);
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: makeOwnLeaderboardEntry("weekly") });

    render(<App />);

    await openSocialLeaderboard();

    expect(await screen.findByRole("button", { name: /view alex profile/i })).toBeTruthy();
    expect(await screen.findByText("Alex")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /^monthly$/i }));
    await waitFor(() => {
      expect(fetchGlobalLeaderboard).toHaveBeenCalledWith("monthly", 100);
    });

    const blockingLoading = screen.queryByText(/loading leaderboard/i);
    const profileButtonDuringRefresh = screen.queryByRole("button", { name: /view alex profile/i });
    const profileNameDuringRefresh = screen.queryByText("Alex");
    const compactRefreshStatus = screen.queryByText(/refreshing leaderboard/i);
    deferredLeaderboard.resolve({ success: true, error: null, data: [makeLeaderboardRow("monthly")] });
    await screen.findByRole("button", { name: /view alex profile/i });

    expect(blockingLoading).toBeNull();
    expect(profileButtonDuringRefresh).toBeTruthy();
    expect(profileNameDuringRefresh).toBeTruthy();
    expect(compactRefreshStatus).toBeTruthy();
    expect(compactRefreshStatus?.classList.contains("leaderboard-refresh-status")).toBe(true);
    expect(compactRefreshStatus?.closest(".capture-recency--error")).toBeNull();
  });

  it("renders remote rankings before local focus totals finish", async () => {
    const deferredTimeline = createDeferred<ActivitySegment[]>();
    getTimeline.mockReset().mockReturnValue(deferredTimeline.promise);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [makeLeaderboardRow("weekly")] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: makeOwnLeaderboardEntry("weekly") });

    render(<App />);

    await openSocialLeaderboard();

    expect(await screen.findByRole("button", { name: /view alex profile/i })).toBeTruthy();
    expect(screen.getByText("Calculating your local focus totals…")).toBeTruthy();
    expect(within(screen.getByLabelText("Focus totals")).getAllByText("—")).toHaveLength(3);

    deferredTimeline.resolve([]);
    await waitFor(() => {
      expect(screen.queryByText("Calculating your local focus totals…")).toBeNull();
    });
  });

  it("keeps remote rankings visible when local focus totals fail", async () => {
    getTimeline.mockReset().mockRejectedValue(new Error("Local tracker unavailable"));
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [makeLeaderboardRow("weekly")] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: makeOwnLeaderboardEntry("weekly") });

    render(<App />);

    await openSocialLeaderboard();

    expect(await screen.findByRole("button", { name: /view alex profile/i })).toBeTruthy();
    expect(await screen.findByText("Local focus totals are unavailable.")).toBeTruthy();
    expect(screen.queryByText("Unable to load leaderboard")).toBeNull();
    expect(within(screen.getByLabelText("Focus totals")).getAllByText("—")).toHaveLength(3);
  });

  it("clears joined controls after opt-out even when the follow-up refresh fails", async () => {
    window.localStorage.setItem(LEADERBOARD_AUTO_PUBLISH_STORAGE_KEY, JSON.stringify([
      {
        userScopeKey: "alex@example.com",
        period: "weekly",
        payloadKey: "stale-payload",
        lastAttemptAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
        lastErrorAt: null,
      },
    ]));
    getTimeline.mockResolvedValue([]);
    fetchGlobalLeaderboard
      .mockResolvedValueOnce({ success: true, error: null, data: [makeLeaderboardRow("weekly")] })
      .mockRejectedValueOnce(new Error("Network unavailable"));
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: makeOwnLeaderboardEntry("weekly") });
    optOutLeaderboard.mockResolvedValue({ success: true, error: null });

    render(<App />);

    await openSocialLeaderboard();

    fireEvent.click(await screen.findByRole("button", { name: /^leave leaderboard$/i }));

    await waitFor(() => {
      expect(optOutLeaderboard).toHaveBeenCalledTimes(3);
    });
    expect(await screen.findByRole("button", { name: /join leaderboard/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^leave leaderboard$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /view profile/i })).toBeNull();
    // Rank embed remains discoverable after opting out, but stays locked until rejoining.
    expect(screen.getByRole("button", { name: /^embed$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^share$/i })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(LEADERBOARD_AUTO_PUBLISH_STORAGE_KEY) ?? "[]")).toEqual([]);
    expect((await screen.findByRole("status")).textContent).toMatch(/network unavailable/i);
  });

  it("keeps joined profile editing available and avoids blocking loading during the save refresh", async () => {
    const deferredLeaderboard = createDeferred<LeaderboardResult<LeaderboardRow[]>>();
    getTimeline.mockResolvedValue([]);
    fetchOwnProfile.mockResolvedValue({
      success: true,
      error: null,
      data: {
        public_id: "profile-1",
        display_name: "Alex",
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
    fetchGlobalLeaderboard
      .mockResolvedValueOnce({ success: true, error: null, data: [makeLeaderboardRow("weekly")] })
      .mockReturnValueOnce(deferredLeaderboard.promise);
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: makeOwnLeaderboardEntry("weekly") });
    saveOwnProfile.mockResolvedValue({
      success: true,
      error: null,
      data: {
        public_id: "profile-1",
        display_name: "Alex Drifty",
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

    render(<App />);

    await openSocialLeaderboard();
    expect(await screen.findByRole("searchbox", { name: /search leaderboard/i })).toBeTruthy();

    await openSocialProfile();
    fireEvent.click(await screen.findByRole("button", { name: /edit profile/i }));
    expect(await screen.findByRole("dialog", { name: /edit profile/i })).toBeTruthy();
    fireEvent.change(await screen.findByLabelText("Display name"), { target: { value: "Alex Drifty" } });
    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() => {
      expect(saveOwnProfile).toHaveBeenCalledWith(expect.objectContaining({ display_name: "Alex Drifty" }));
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /edit profile/i })).toBeNull();
    });
    await waitFor(() => {
      expect(fetchGlobalLeaderboard).toHaveBeenCalledTimes(2);
    });
    const blockingLoading = screen.queryByText(/loading leaderboard/i);
    deferredLeaderboard.resolve({ success: true, error: null, data: [makeLeaderboardRow("weekly")] });
    await openSocialLeaderboard();
    await screen.findByRole("button", { name: /view alex profile/i });

    expect(blockingLoading).toBeNull();
  });

  it("reopens sign-in when a stale leaderboard session cannot save a profile", async () => {
    getTimeline.mockResolvedValue([]);
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: null });
    saveOwnProfile.mockResolvedValue({ success: false, error: "Not authenticated", data: null });

    render(<App />);

    await openSocialLeaderboard();
    await openSocialProfile();
    fireEvent.click(await screen.findByRole("button", { name: /edit profile/i }));
    expect(await screen.findByRole("dialog", { name: /edit profile/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() => {
      expect(saveOwnProfile).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/not authenticated/i)).toBeTruthy();
    expect(await screen.findByRole("heading", { name: /sign in to drifty/i })).toBeTruthy();
  });
});
