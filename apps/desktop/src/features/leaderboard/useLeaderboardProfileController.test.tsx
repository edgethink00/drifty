// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLeaderboardProfileController } from "./useLeaderboardProfileController";
import { LocalizationTestProvider } from "../localization/LocalizationContext";

vi.mock("./leaderboardService", () => ({
  DEFAULT_LEADERBOARD_PERIOD: "weekly",
  LEADERBOARD_PERIODS: ["daily", "weekly", "monthly"],
  fetchGlobalLeaderboard: vi.fn().mockResolvedValue({ success: true, error: null, data: [] }),
  fetchOwnLeaderboardEntry: vi.fn().mockResolvedValue({ success: true, error: null, data: null }),
  optOutLeaderboard: vi.fn().mockResolvedValue({ success: true, error: null }),
  publishOwnLeaderboardCheckpoint: vi.fn().mockResolvedValue({ success: true, error: null, data: true }),
}));

vi.mock("../profile/profileService", () => ({
  fallbackDisplayName: vi.fn().mockReturnValue("member"),
  fetchOwnProfile: vi.fn().mockResolvedValue({ success: true, error: null, data: null }),
  fetchPublicProfile: vi.fn().mockResolvedValue({ success: true, error: null, data: null }),
  saveOwnProfile: vi.fn().mockResolvedValue({ success: true, error: null, data: { display_name: "member" } }),
}));

vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: {
    getTimeline: vi.fn().mockResolvedValue([]),
  },
}));

import { optOutLeaderboard, publishOwnLeaderboardCheckpoint } from "./leaderboardService";
import { saveOwnProfile } from "../profile/profileService";

function defaultProps() {
  return {
    activeTab: "other", // Avoid mounting 5-minute background refresh interval
    allowsEffectiveAnonymousAuth: true,
    authMetadataAvatarUrl: "",
    isAuthResolved: true,
    hasRequiredAccountAuth: true,
    isEffectiveAuthRequired: false,
    isSupabaseConfigured: true,
    classificationAssessmentReady: true,
    classificationAvailabilityState: "ready" as const,
    classificationCatchingUp: false,
    showAiClassificationImpact: false,
    includeBuiltInHeuristics: true,
    builtInHeuristicsUnavailableSince: null,
    signInAnonymously: vi.fn().mockResolvedValue({ error: null, user: { id: "anon-1" } }),
    startOfDayMinutes: 0,
    user: { id: "user-1", email: "test@example.com" } as any,
    onAuthRequired: vi.fn(),
  };
}

describe("useLeaderboardProfileController - AI gate & catch-up UX", () => {
  it("identifies a failed plan check instead of asking the user to reconnect the provider", async () => {
    const { result } = renderHook(() => useLeaderboardProfileController({
      ...defaultProps(), classificationAssessmentReady: false,
      classificationAvailabilityState: "degraded", classificationAvailabilityReason: "cloud_entitlement_unavailable",
    }));
    await act(async () => { await result.current.handleLeaderboardOptIn(); });
    expect(result.current.leaderboardActionError).toBe("Your Cloud plan could not be verified. Open AI settings and refresh your plan, then try again.");
  });

  it("surfaces the quota exceeded error when joining while daily quota has reached limit", async () => {
    const { result } = renderHook(() => useLeaderboardProfileController({
      ...defaultProps(),
      classificationAssessmentReady: false,
      classificationAvailabilityReason: "cloud_quota_exceeded",
      classificationRecoveryAction: "upgrade",
      classificationCloudQuota: { window: "day", retryAtMs: null },
    }));

    await act(async () => {
      await result.current.handleLeaderboardOptIn();
    });

    expect(result.current.leaderboardActionError).toBe(
      "Cloud AI daily limit reached. Automatic classification will retry when the wait ends. Trial users can also upgrade to Pro. You can join the leaderboard after AI catches up.",
    );
  });

  it.each(["minute", "hour", "day", null] as const)("does not suggest Upgrade for a paid %s quota when joining", async (window) => {
    const { result } = renderHook(() => useLeaderboardProfileController({
      ...defaultProps(), classificationAssessmentReady: false,
      classificationAvailabilityReason: "cloud_quota_exceeded", classificationRecoveryAction: "retry",
      classificationCloudQuota: { window, retryAtMs: new Date("2026-10-06T15:00:00Z").getTime() },
    }));
    await act(async () => { await result.current.handleLeaderboardOptIn(); });
    expect(result.current.leaderboardActionError).toContain("Automatic classification can retry at");
    expect(result.current.leaderboardActionError).not.toContain("{time}");
    expect(result.current.leaderboardActionError).not.toMatch(/upgrad/i);
    if (window !== "day") expect(result.current.leaderboardActionError).not.toMatch(/daily/i);
    expect(publishOwnLeaderboardCheckpoint).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("surfaces a clear catching-up error when joining while AI is catching up on recent activity", async () => {
    const { result } = renderHook(() => useLeaderboardProfileController({
      ...defaultProps(),
      classificationAssessmentReady: false,
      classificationCatchingUp: true,
    }));

    expect(result.current.isClassificationCatchingUp).toBe(true);

    await act(async () => {
      await result.current.handleLeaderboardOptIn();
    });

    expect(result.current.leaderboardActionError).toBe(
      "AI is catching up on recent activity. You can join the leaderboard once catch-up is complete.",
    );
  });

  it("surfaces an AI verification error when joining while connection check is in-flight", async () => {
    const { result } = renderHook(() => useLeaderboardProfileController({
      ...defaultProps(),
      classificationAssessmentReady: false,
      classificationAvailabilityState: "checking",
    }));

    await act(async () => {
      await result.current.handleLeaderboardOptIn();
    });

    expect(result.current.leaderboardActionError).toBe(
      "AI connection is being verified. Please try joining again in a moment.",
    );
  });

  it("surfaces the reconnect AI error when joining while AI is truly unavailable or paused", async () => {
    const { result } = renderHook(() => useLeaderboardProfileController({
      ...defaultProps(),
      classificationAssessmentReady: false,
      classificationAvailabilityState: "unavailable",
    }));

    await act(async () => {
      await result.current.handleLeaderboardOptIn();
    });

    expect(result.current.leaderboardActionError).toBe(
      "AI classification is paused. Reconnect AI before joining the leaderboard.",
    );
  });

  it("automatically clears catching-up action error once classification assessment becomes ready", async () => {
    let ready = false;
    let catchingUp = true;
    const { result, rerender } = renderHook(() => useLeaderboardProfileController({
      ...defaultProps(),
      classificationAssessmentReady: ready,
      classificationCatchingUp: catchingUp,
    }));

    await act(async () => {
      await result.current.handleLeaderboardOptIn();
    });

    expect(result.current.leaderboardActionError).toContain("catching up");

    // Readiness returns once background backlog drain finishes
    ready = true;
    catchingUp = false;
    rerender();

    expect(result.current.leaderboardActionError).toBeNull();
  });
});

describe("useLeaderboardProfileController - leave privacy", () => {
  beforeEach(() => {
    vi.mocked(optOutLeaderboard).mockResolvedValue({ success: true, error: null });
    vi.mocked(saveOwnProfile).mockResolvedValue({ success: true, error: null, data: { display_name: "member" } as never });
    vi.mocked(saveOwnProfile).mockClear();
    vi.mocked(optOutLeaderboard).mockClear();
  });

  it("does not change profile visibility when leaving without the privacy option", async () => {
    const { result } = renderHook(() => useLeaderboardProfileController(defaultProps()));
    await act(async () => {
      await result.current.handleLeaderboardOptOut();
    });
    expect(optOutLeaderboard).toHaveBeenCalled();
    expect(saveOwnProfile).not.toHaveBeenCalled();
  });

  it("makes the public profile private when leaving with that option", async () => {
    const { result } = renderHook(() => useLeaderboardProfileController(defaultProps()));
    await act(async () => {
      await result.current.handleLeaderboardOptOut({ makeProfilePrivate: true });
    });
    expect(saveOwnProfile).toHaveBeenCalledWith(expect.objectContaining({ is_public: false }));
  });

  it("keeps the leaderboard leave and reports when hiding the profile fails", async () => {
    vi.mocked(saveOwnProfile).mockResolvedValueOnce({ success: false, error: "write failed" });
    const { result } = renderHook(() => useLeaderboardProfileController(defaultProps()));
    await act(async () => {
      await result.current.handleLeaderboardOptOut({ makeProfilePrivate: true });
    });
    expect(result.current.leaderboardActionError).toMatch(/public profile page is still on/i);
  });
});

describe("useLeaderboardProfileController - share message", () => {
  it("tells a Korean user in Korean that a public profile is needed before sharing", async () => {
    const { result } = renderHook(() => useLeaderboardProfileController(defaultProps()), {
      wrapper: ({ children }) => <LocalizationTestProvider language="ko">{children}</LocalizationTestProvider>,
    });

    await act(async () => {
      await result.current.handleShareLeaderboardProfile();
    });

    expect(result.current.profileShareMessage).toBe("먼저 프로필을 저장하거나 리더보드에 참여하면 공개 링크가 만들어집니다.");
  });
});
