// @vitest-environment jsdom
import type { ActivitySegment } from "@drifty/domain";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLeaderboardProfileController } from "./useLeaderboardProfileController";
import { LocalizationTestProvider } from "../localization/LocalizationContext";

vi.mock("./leaderboardService", () => ({
  DEFAULT_LEADERBOARD_PERIOD: "weekly",
  LEADERBOARD_PERIODS: ["daily", "weekly", "monthly"],
  fetchGlobalLeaderboard: vi.fn().mockResolvedValue({ success: true, error: null, data: [] }),
  fetchOwnLeaderboardEntry: vi.fn().mockResolvedValue({ success: true, error: null, data: null }),
  optOutLeaderboard: vi.fn().mockResolvedValue({ success: true, error: null }),
  publishOwnFocusTotal: vi.fn().mockResolvedValue({ success: true, error: null }),
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
    getCompactTimeline: vi.fn().mockResolvedValue([]),
  },
}));

import { optOutLeaderboard, publishOwnFocusTotal, publishOwnLeaderboardCheckpoint } from "./leaderboardService";
import { fetchOwnProfile, saveOwnProfile } from "../profile/profileService";
import { trackerClient } from "../../lib/api/trackerClient";

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
  it("keeps a failed plan check quiet while retaining the publication gate", async () => {
    const { result } = renderHook(() => useLeaderboardProfileController({
      ...defaultProps(), classificationAssessmentReady: false,
      classificationAvailabilityState: "degraded", classificationAvailabilityReason: "cloud_entitlement_unavailable",
    }));
    await act(async () => { await result.current.handleLeaderboardOptIn(); });
    expect(result.current.leaderboardActionError).toBeNull();
    expect(publishOwnLeaderboardCheckpoint).not.toHaveBeenCalled();
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
      "Daily AI classification limit reached",
    );
  });

  it("clears a prior trial quota notice when the plan becomes paid while classification is still paused", async () => {
    const { result, rerender } = renderHook(({ paid }) => useLeaderboardProfileController({
      ...defaultProps(), classificationAssessmentReady: false,
      classificationAvailabilityReason: "cloud_quota_exceeded", classificationRecoveryAction: paid ? null : "upgrade",
    }), { initialProps: { paid: false } });
    await act(async () => { await result.current.handleLeaderboardOptIn(); });
    expect(result.current.leaderboardActionError).toBe("Daily AI classification limit reached");
    rerender({ paid: true });
    expect(result.current.leaderboardActionError).toBeNull();
    expect(publishOwnLeaderboardCheckpoint).not.toHaveBeenCalled();
  });

  it.each(["minute", "hour", "day", null] as const)("keeps a paid %s quota quiet when joining without publishing", async (window) => {
    const { result } = renderHook(() => useLeaderboardProfileController({
      ...defaultProps(), classificationAssessmentReady: false,
      classificationAvailabilityReason: "cloud_quota_exceeded", classificationRecoveryAction: null,
      classificationCloudQuota: { window, retryAtMs: new Date("2026-10-06T15:00:00Z").getTime() },
    }));
    await act(async () => { await result.current.handleLeaderboardOptIn(); });
    expect(result.current.leaderboardActionError).toBeNull();
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

  it("closes the public profile when leaving the leaderboard", async () => {
    const { result } = renderHook(() => useLeaderboardProfileController(defaultProps()));
    await act(async () => {
      await result.current.handleLeaderboardOptOut();
    });
    expect(saveOwnProfile).toHaveBeenCalledWith(expect.objectContaining({ is_public: false }));
  });

  it("keeps the leaderboard leave and reports when hiding the profile fails", async () => {
    vi.mocked(saveOwnProfile).mockResolvedValueOnce({ success: false, error: "write failed" });
    const { result } = renderHook(() => useLeaderboardProfileController(defaultProps()));
    await act(async () => {
      await result.current.handleLeaderboardOptOut();
    });
    expect(result.current.leaderboardActionError).toMatch(/public profile page is still on/i);
  });
});

describe("useLeaderboardProfileController - editor draft", () => {
  afterEach(() => {
    vi.mocked(fetchOwnProfile).mockResolvedValue({ success: true, error: null, data: null });
  });

  it("drops unsaved edits when the editor closes, so a later leave saves only what was confirmed", async () => {
    vi.mocked(fetchOwnProfile).mockResolvedValue({
      success: true,
      error: null,
      data: { display_name: "Saved name", bio: "Saved bio", avatar_url: "", website_url: "", github_url: "", linkedin_url: "", is_public: false } as never,
    });
    vi.mocked(saveOwnProfile).mockClear();
    const { result } = renderHook(() => useLeaderboardProfileController(defaultProps()));
    await waitFor(() => expect(result.current.profileDraft.displayName).toBe("Saved name"));

    act(() => result.current.openProfileEditor());
    act(() => result.current.updateProfileDraft({ displayName: "Typed name", bio: "Typed bio" }));
    expect(result.current.profileDraft.displayName).toBe("Typed name");

    act(() => result.current.closeProfileEditor());
    expect(result.current.isProfileEditorOpen).toBe(false);
    expect(result.current.profileDraft).toMatchObject({ displayName: "Saved name", bio: "Saved bio" });

    await act(async () => {
      await result.current.handleLeaderboardOptOut();
    });
    expect(saveOwnProfile).toHaveBeenLastCalledWith(expect.objectContaining({ display_name: "Saved name", bio: "Saved bio", is_public: false }));
  });

  it("opens the editor again without the last save's outcome", async () => {
    vi.mocked(saveOwnProfile).mockResolvedValueOnce({
      success: true,
      error: null,
      data: { display_name: "Saved name", bio: "", avatar_url: "", website_url: "", github_url: "", linkedin_url: "", is_public: false } as never,
    });
    const { result } = renderHook(() => useLeaderboardProfileController(defaultProps()));
    act(() => result.current.openProfileEditor());
    await act(async () => {
      await result.current.handleSaveProfileFromModal();
    });
    // The saved line belongs to the screen the editor closed onto.
    expect(result.current.isProfileEditorOpen).toBe(false);
    expect(result.current.profileMessage).toBe("Profile saved.");

    act(() => result.current.openProfileEditor());
    expect(result.current.profileMessage).toBeNull();
    expect(result.current.profileError).toBeNull();
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

describe("useLeaderboardProfileController - assessment transitions", () => {
  it.each([
    ["catching_up", "paid_quota"],
    ["catching_up", "read_failed"],
    ["paused", "paid_quota"],
    ["paused", "read_failed"],
    ["paused", "ready"],
  ] as const)("clears %s assessment advice when state becomes %s", async (before, after) => {
    const { result, rerender } = renderHook(({ transitioned }) => {
      const nextState = !transitioned ? {
        classificationAssessmentReady: false,
        classificationAvailabilityState: before === "paused" ? "degraded" as const : "ready" as const,
        classificationAvailabilityReason: before === "paused" ? "cloud_disconnected" as const : "ready" as const,
        classificationCatchingUp: before === "catching_up",
      } : after === "paid_quota" ? {
        classificationAssessmentReady: false,
        classificationAvailabilityState: "cloud_locked" as const,
        classificationAvailabilityReason: "cloud_quota_exceeded" as const,
        classificationCatchingUp: false,
        classificationRecoveryAction: null,
      } : after === "read_failed" ? {
        classificationAssessmentReady: false,
        classificationAvailabilityState: "degraded" as const,
        classificationAvailabilityReason: "cloud_entitlement_unavailable" as const,
        classificationCatchingUp: false,
        classificationRecoveryAction: null,
      } : {
        classificationAssessmentReady: true,
        classificationAvailabilityState: "ready" as const,
        classificationAvailabilityReason: "ready" as const,
        classificationCatchingUp: false,
      };
      return useLeaderboardProfileController({ ...defaultProps(), ...nextState });
    }, { initialProps: { transitioned: false } });
    await act(async () => { await result.current.handleLeaderboardOptIn(); });
    expect(result.current.leaderboardActionError).not.toBeNull();
    rerender({ transitioned: true });
    expect(result.current.leaderboardActionError).toBeNull();
  });
});

describe("useLeaderboardProfileController - localized assessment recovery", () => {
  it.each(["en", "ko"] as const)("clears the %s trial quota notice after assessment is ready", async (language) => {
    const { result, rerender } = renderHook(({ ready }) => useLeaderboardProfileController({
      ...defaultProps(),
      classificationAssessmentReady: ready,
      classificationAvailabilityState: ready ? "ready" : "cloud_locked",
      classificationAvailabilityReason: ready ? "ready" : "cloud_quota_exceeded",
      classificationRecoveryAction: ready ? null : "upgrade",
    }), {
      initialProps: { ready: false },
      wrapper: ({ children }) => <LocalizationTestProvider language={language}>{children}</LocalizationTestProvider>,
    });
    await act(async () => { await result.current.handleLeaderboardOptIn(); });
    expect(result.current.leaderboardActionError).not.toBeNull();
    rerender({ ready: true });
    expect(result.current.leaderboardActionError).toBeNull();
  });
});

describe("useLeaderboardProfileController - assessment and service error separation", () => {
  beforeEach(() => {
    vi.mocked(trackerClient.getCompactTimeline).mockResolvedValue([]);
    vi.mocked(publishOwnFocusTotal).mockResolvedValue({ success: true, error: null });
    vi.mocked(publishOwnFocusTotal).mockClear();
  });

  it("updates a trial quota notice when the language changes", async () => {
    let language = "en" as "en" | "ko";
    const { result, rerender } = renderHook(() => useLeaderboardProfileController({
      ...defaultProps(), classificationAssessmentReady: false,
      classificationAvailabilityReason: "cloud_quota_exceeded", classificationRecoveryAction: "upgrade",
    }), { wrapper: ({ children }) => <LocalizationTestProvider language={language}>{children}</LocalizationTestProvider> });
    await act(async () => { await result.current.handleLeaderboardOptIn(); });
    expect(result.current.leaderboardActionError).toBe("Daily AI classification limit reached");
    language = "ko";
    rerender();
    expect(result.current.leaderboardActionError).toBe("오늘치 무료 AI 분류 한도에 도달했습니다");
  });

  it("does not revive a quiet join warning when the next block requires AI recovery", async () => {
    const { result, rerender } = renderHook(({ quiet }) => useLeaderboardProfileController({
      ...defaultProps(), classificationAssessmentReady: false,
      classificationAvailabilityState: quiet ? "cloud_locked" : "degraded",
      classificationAvailabilityReason: quiet ? "cloud_quota_exceeded" : "cloud_disconnected",
    }), { initialProps: { quiet: true } });
    await act(async () => { await result.current.handleLeaderboardOptIn(); });
    expect(result.current.leaderboardActionError).toBeNull();
    rerender({ quiet: false });
    expect(result.current.leaderboardActionError).toBeNull();
    expect(publishOwnFocusTotal).not.toHaveBeenCalled();
  });

  it("keeps a real publication failure through quiet waits and assessment recovery", async () => {
    // The service's English wording becomes one translated line; what matters
    // here is that the failure outlives the quiet waits around it.
    const message = "Couldn't join the leaderboard. Try again.";
    vi.mocked(publishOwnFocusTotal).mockResolvedValue({ success: false, error: "Server publication limit reached" });
    const { result, rerender } = renderHook(({ ready }) => useLeaderboardProfileController({
      ...defaultProps(), classificationAssessmentReady: ready,
      classificationAvailabilityState: ready ? "ready" : "cloud_locked",
      classificationAvailabilityReason: ready ? "ready" : "cloud_quota_exceeded",
    }), { initialProps: { ready: true } });
    await act(async () => { await result.current.handleLeaderboardOptIn(); });
    expect(publishOwnFocusTotal).toHaveBeenCalled();
    expect(result.current.leaderboardActionError).toBe(message);
    rerender({ ready: false });
    expect(result.current.leaderboardActionError).toBe(message);
    rerender({ ready: true });
    expect(result.current.leaderboardActionError).toBe(message);
  });

  it("clears a gate warning created during payload collection after recovery without publishing", async () => {
    let resolveTimeline: (segments: ActivitySegment[]) => void;
    const timeline = new Promise<ActivitySegment[]>((resolve) => { resolveTimeline = resolve; });
    vi.mocked(trackerClient.getCompactTimeline).mockReturnValue(timeline);
    vi.mocked(trackerClient.getCompactTimeline).mockClear();
    const { result, rerender } = renderHook(({ ready }) => useLeaderboardProfileController({
      ...defaultProps(), classificationAssessmentReady: ready,
      classificationAvailabilityState: ready ? "ready" : "degraded",
      classificationAvailabilityReason: ready ? "ready" : "cloud_disconnected",
    }), { initialProps: { ready: true } });
    let join: Promise<void>;
    act(() => { join = result.current.handleLeaderboardOptIn(); });
    await waitFor(() => expect(trackerClient.getCompactTimeline).toHaveBeenCalled());
    rerender({ ready: false });
    await act(async () => { resolveTimeline!([]); await join!; });
    expect(result.current.leaderboardActionError).toContain("paused before");
    expect(publishOwnFocusTotal).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(result.current.leaderboardActionError).toBeNull();
  });
});
