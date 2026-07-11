// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LeaderboardPublicProfileControls } from "../leaderboard/LeaderboardView";
import type { FocusCardControls } from "../share/useFocusCard";
import { SocialProfileView } from "./SocialProfileView";

const PUBLIC_ID = "9f3a1b2c-0000-4d5e-8f6a-1b2c3d4e5f60";

function makeCard(overrides: Partial<FocusCardControls> = {}): FocusCardControls {
  return {
    enabled: true,
    busy: false,
    error: null,
    detailFlags: { shareCategoryBreakdown: false, shareHourlyPattern: false },
    previewPayload: {
      focus_seconds_today: 5400,
      focus_seconds_7d: 20 * 3600,
      drift_seconds_7d: 1800,
      neutral_seconds_7d: 1200,
      focus_share: 0.96,
      daily_focus: [],
      window_start_date: "2026-06-12",
      window_end_date: "2026-07-11",
      share_category_breakdown: true,
      share_hourly_pattern: true,
      category_breakdown_7d: [
        { category: "workspace", seconds: 7200, focusSeconds: 6000, neutralSeconds: 600, driftSeconds: 600 },
      ],
      hourly_focus_pattern: [],
    },
    refresh: vi.fn().mockResolvedValue(undefined),
    enable: vi.fn().mockResolvedValue(true),
    disable: vi.fn().mockResolvedValue(undefined),
    setDetailFlag: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeProfile(card = makeCard()): LeaderboardPublicProfileControls {
  return {
    card,
    dailyProductivity: [
      { day: "2026-07-10", focus: 3600, drift: 1200, neutral: 0 },
      { day: "2026-07-11", focus: 5400, drift: 600, neutral: 0 },
    ],
    draft: {
      displayName: "Alex",
      bio: "Building quiet tools.",
      avatarUrl: "",
      websiteUrl: "https://drifty.so",
      githubUrl: "",
      linkedinUrl: "",
      isPublic: true,
    },
    focusSeconds7d: 20 * 3600,
    profileError: null,
    profileLoading: false,
    profileMessage: null,
    profileSaving: false,
    publicId: PUBLIC_ID,
    shareMessage: null,
    onCopyProfileLink: vi.fn(),
    onEditProfile: vi.fn(),
    onEnsureProfile: vi.fn().mockResolvedValue(true),
    onSetProfileVisibility: vi.fn().mockResolvedValue(true),
  };
}

function renderProfile(publicProfile = makeProfile()) {
  return render(
    <SocialProfileView
      isSignedIn
      isSupabaseEnabled
      profileDisplayName="Alex"
      publicProfile={publicProfile}
      onSignIn={vi.fn()}
    />,
  );
}

describe("SocialProfileView", () => {
  it("keeps profile identity, sharing choices, and embeds on one surface", () => {
    renderProfile();

    expect(screen.getByRole("heading", { name: "Alex" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /what you share/i })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /public profile/i })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /focus summary/i })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /leaderboard rank/i })).toBeNull();
    expect(screen.getByRole("button", { name: /profile embed/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^badge/i })).toBeNull();
    expect(screen.getByText(/local preview · not public/i)).toBeTruthy();
    expect(screen.getByText(/stays on this Mac until you turn on Category breakdown/i)).toBeTruthy();
    expect(screen.getByText("Workspace")).toBeTruthy();
    const publicPreview = screen.getByRole("region", { name: /public preview/i });
    expect(within(publicPreview).getByText(/20h/)).toBeTruthy();
    expect(within(publicPreview).getByText(/96% focus share/i)).toBeTruthy();
    expect(within(publicPreview).queryByText("Workspace")).toBeNull();
  });

  it("persists master visibility and focus detail choices", () => {
    const card = makeCard();
    const profile = makeProfile(card);
    renderProfile(profile);

    fireEvent.click(screen.getByRole("switch", { name: /public profile/i }));
    expect(profile.onSetProfileVisibility).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("checkbox", { name: /category breakdown/i }));
    expect(card.setDetailFlag).toHaveBeenCalledWith("shareCategoryBreakdown", true);
  });

  it("opens the selected focus embed format", () => {
    renderProfile();

    fireEvent.click(screen.getByRole("button", { name: /profile embed/i }));
    const modal = screen.getByRole("dialog", { name: /^profile embed$/i });
    expect(within(modal).getByRole("radio", { name: /card/i }).getAttribute("aria-checked")).toBe("true");
  });

  it("keeps subordinate focus details unavailable until the base summary is shared", () => {
    renderProfile(makeProfile(makeCard({ enabled: false })));

    expect((screen.getByRole("checkbox", { name: /category breakdown/i }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: /hourly rhythm/i }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("checkbox", { name: /top apps/i })).toBeNull();
  });

  it("keeps the public profile link available when only focus embeds are off", () => {
    renderProfile(makeProfile(makeCard({ enabled: false })));

    fireEvent.click(screen.getByRole("button", { name: /profile embed/i }));
    const modal = screen.getByRole("dialog", { name: /^profile embed$/i });
    expect(within(modal).getByRole("button", { name: /copy profile link/i })).toBeTruthy();
    expect(within(modal).getByText(/focus summary is off/i)).toBeTruthy();
  });

  it("shows optional category metrics in the visitor preview only while they are shared", () => {
    renderProfile(makeProfile(makeCard({
      detailFlags: { shareCategoryBreakdown: true, shareHourlyPattern: false },
    })));

    const publicPreview = screen.getByRole("region", { name: /public preview/i });
    expect(within(publicPreview).getByText("Workspace")).toBeTruthy();
    expect(within(publicPreview).getByText(/F 1h 40m/i)).toBeTruthy();
    expect(within(publicPreview).queryByText(/shared hourly rhythm/i)).toBeNull();
  });
});
