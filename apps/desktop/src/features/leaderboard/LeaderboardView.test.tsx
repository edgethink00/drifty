// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LeaderboardRow } from "./leaderboardService";
import { LeaderboardView } from "./LeaderboardView";

type TestProps = Parameters<typeof LeaderboardView>[0];

function renderView(overrides: Partial<TestProps> = {}) {
  const props: TestProps = {
    isSupabaseEnabled: true,
    isSignedIn: true,
    isLoading: false,
    error: null,
    isOptedIn: true,
    activePeriod: "weekly",
    leaderboard: [],
    focusSeconds7d: 0,
    windowStartDay: "2026-04-01",
    windowEndDay: "2026-04-07",
    profileDisplayName: null,
    email: null,
    isActionLoading: false,
    actionError: null,
    onOptIn: vi.fn(),
    ...overrides,
  };

  return render(<LeaderboardView {...props} />);
}

function makeLeaderboardRow(overrides: Partial<LeaderboardRow>): LeaderboardRow {
  const focusSeconds = overrides.focus_seconds ?? overrides.focus_seconds_7d ?? 0;
  return {
    rank: 1,
    public_id: "profile-1",
    display_name: "Alex",
    avatar_url: "",
    period: "weekly",
    focus_seconds: focusSeconds,
    focus_seconds_7d: focusSeconds,
    window_start_date: "2026-04-01",
    window_end_date: "2026-04-07",
    updated_at: "2026-04-07T12:00:00.000Z",
    ...overrides,
  };
}

describe("LeaderboardView", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("renders a disabled state when Supabase is unavailable", () => {
    renderView({ isSupabaseEnabled: false, isSignedIn: false });

    expect(screen.getByText(/leaderboard unavailable/i)).toBeTruthy();
    expect(screen.getByText(/supabase is not configured for this workspace/i)).toBeTruthy();
  });

  it("renders a signed-out beta join state", () => {
    const onSignIn = vi.fn();
    renderView({ isSignedIn: false, isOptedIn: false, onSignIn });

    expect(screen.getByText(/join in beta/i)).toBeTruthy();
    expect(screen.getByText(/apps, sites, windows, and sessions are not published to the leaderboard/i)).toBeTruthy();
    expect(screen.queryByText(/publish only your public name/i)).toBeNull();
    expect(screen.queryByText(/rolling focus total/i)).toBeNull();
    const hero = screen.getByLabelText(/your leaderboard profile/i);
    const heroJoin = within(hero).getByRole("button", { name: /join leaderboard/i });
    expect(screen.getAllByRole("button", { name: /join leaderboard/i })).toHaveLength(1);

    fireEvent.click(heroJoin);

    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("keeps the profile label accessible while flattening profile and board blocks", () => {
    renderView({
      leaderboard: [makeLeaderboardRow({ display_name: "Alex", focus_seconds_7d: 7200 })],
      profileDisplayName: "Alex",
      ownRank: 1,
    });

    expect(screen.queryByText("Your profile")).toBeNull();

    const profileBlock = screen.getByLabelText(/leaderboard profile controls/i);
    const boardBlock = screen.getByLabelText(/^global leaderboard$/i);

    expect(profileBlock.contains(boardBlock)).toBe(false);
    expect(boardBlock.contains(profileBlock)).toBe(false);
    const profileSummary = within(profileBlock).getByLabelText(/profile ranking summary/i);
    expect(within(profileBlock).getByLabelText(/your leaderboard profile/i)).toBeTruthy();
    expect(profileSummary.classList.contains("leaderboard-row__meta--compact")).toBe(true);
    expect(profileSummary.querySelectorAll(".leaderboard-stat")).toHaveLength(3);
    expect(within(boardBlock).getByRole("group", { name: /leaderboard period/i })).toBeTruthy();
    expect(within(boardBlock).getByRole("list", { name: /global focus leaderboard rankings/i })).toBeTruthy();
  });

  it("shows profile details and keeps edit profile beside the name", () => {
    const onEditProfile = vi.fn();
    renderView({
      profileDisplayName: "Alex",
      profileBio: "Building quiet tools for deeper work.",
      profileWebsiteUrl: "https://drifty.so/drifty",
      profileGithubUrl: "github.com/edgethink00",
      profileLinkedinUrl: "https://www.linkedin.com/in/drifty/",
      email: "alex@example.com",
      onEditProfile,
    });

    const hero = screen.getByLabelText(/your leaderboard profile/i);
    const heading = within(hero).getByRole("heading", { name: "Alex" });
    const nameRow = heading.closest(".leaderboard-hero__name-row") as HTMLElement;

    expect(within(nameRow).getByRole("button", { name: /edit profile/i })).toBeTruthy();
    expect(within(hero).getByText("Building quiet tools for deeper work.")).toBeTruthy();
    expect(within(hero).getByText("drifty.so/drifty")).toBeTruthy();
    expect(within(hero).getByText("github.com/edgethink00")).toBeTruthy();
    expect(within(hero).getByText("linkedin.com/in/drifty")).toBeTruthy();
    expect(screen.queryByText("alex@example.com")).toBeNull();

    fireEvent.click(within(nameRow).getByRole("button", { name: /edit profile/i }));

    expect(onEditProfile).toHaveBeenCalledTimes(1);
  });

  it("renders a loading state while leaderboard data is being fetched", () => {
    renderView({ isLoading: true });

    expect(screen.getByText(/loading leaderboard/i)).toBeTruthy();
    expect(screen.getByText(/checking the latest opt-in rankings/i)).toBeTruthy();
  });

  it("renders an error state when the fetch fails", () => {
    renderView({ error: "RPC exploded" });

    expect(screen.getByText(/unable to load leaderboard/i)).toBeTruthy();
    expect(screen.getByText("RPC exploded")).toBeTruthy();
  });

  it("renders an opted-out state with the exact trimmed public-name preview", () => {
    renderView({
      isOptedIn: false,
      profileDisplayName: "  Alex Kim  ",
      email: "alex@example.com",
    });

    expect(screen.getByText(/ready when you are/i)).toBeTruthy();
    expect(screen.getByText(/apps, sites, windows, and sessions are not published to the leaderboard/i)).toBeTruthy();
    expect(screen.queryByText(/join to publish your profile/i)).toBeNull();
    expect(screen.queryByText(/rolling total/i)).toBeNull();
    expect(screen.getByLabelText(/profile ranking summary/i)).toBeTruthy();
    expect(within(screen.getByLabelText(/your leaderboard profile/i)).getByRole("button", { name: /join leaderboard/i })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /join leaderboard/i })).toHaveLength(1);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText(/your focus window/i)).toBeTruthy();
    expect(screen.getAllByText(/^Alex Kim$/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("alex@example.com")).toBeNull();
  });

  it("falls back to the email prefix in the opted-out preview when no profile name is provided", () => {
    renderView({
      isOptedIn: false,
      profileDisplayName: "   ",
      email: "focus-mode@example.com",
    });

    expect(screen.getAllByText(/^focus-mode$/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders an empty opted-in state when no eligible participants are ranked yet", () => {
    renderView({ isOptedIn: true, leaderboard: [] });

    expect(screen.getByText(/no ranked participants yet/i)).toBeTruthy();
    expect(screen.getByText(/once someone opts in, rankings will appear here/i)).toBeTruthy();
    expect(screen.getByText(/not ranked yet/i)).toBeTruthy();
    expect(screen.getByText(/focus time/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /leave leaderboard/i })).toBeTruthy();
  });

  it("calls the opt-in callback from the opted-out state", () => {
    const onOptIn = vi.fn();
    renderView({ isOptedIn: false, onOptIn });

    fireEvent.click(screen.getByRole("button", { name: /join leaderboard/i }));

    expect(onOptIn).toHaveBeenCalledTimes(1);
  });

  it("disables the opt-in button and shows an action error while joining", () => {
    renderView({ isOptedIn: false, isActionLoading: true, actionError: "Publish failed" });

    expect((screen.getByRole("button", { name: /joining…/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Publish failed")).toBeTruthy();
  });

  it("switches the leaderboard period from the segmented control", () => {
    const onPeriodChange = vi.fn();
    renderView({ activePeriod: "weekly", onPeriodChange });

    expect(screen.getByRole("button", { name: /^weekly$/i }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /^monthly$/i }));

    expect(onPeriodChange).toHaveBeenCalledWith("monthly");
  });

  it("uses single-line period controls and omits row subtitles", () => {
    renderView({
      activePeriod: "monthly",
      leaderboard: [makeLeaderboardRow({ period: "monthly", focus_seconds: 7200, focus_seconds_7d: 7200 })],
    });

    const periodControl = screen.getByRole("group", { name: /leaderboard period/i });
    expect(within(periodControl).getByRole("button", { name: /^monthly$/i })).toBeTruthy();
    expect(within(periodControl).queryByText(/today/i)).toBeNull();
    expect(within(periodControl).queryByText(/7 days/i)).toBeNull();
    expect(within(periodControl).queryByText(/30 days/i)).toBeNull();
    expect(screen.queryByText(/rolling 7-day focus total/i)).toBeNull();
    expect(screen.queryByText(/rolling 30-day focus total/i)).toBeNull();
  });

  it("shows a simple daily average for weekly and monthly periods", () => {
    renderView({
      activePeriod: "monthly",
      focusSeconds7d: 108000,
      leaderboard: [makeLeaderboardRow({ period: "monthly", focus_seconds: 108000, focus_seconds_7d: 108000 })],
    });

    expect(screen.getAllByText(/daily avg/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("1h").length).toBeGreaterThanOrEqual(2);
  });

  it("does not show daily average for daily periods", () => {
    renderView({
      activePeriod: "daily",
      focusSeconds7d: 3600,
      leaderboard: [makeLeaderboardRow({ period: "daily", focus_seconds: 3600, focus_seconds_7d: 3600 })],
    });

    expect(screen.queryByText(/daily avg/i)).toBeNull();
  });

  it("renders a populated ranked list with only safe public fields", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T13:00:00.000Z"));

    const leaderboard: LeaderboardRow[] = [
      makeLeaderboardRow({
        rank: 1,
        public_id: "profile-1",
        display_name: "Alex",
        focus_seconds_7d: 7260,
        updated_at: "2026-04-07T12:00:00.000Z",
      }),
      makeLeaderboardRow({
        rank: 2,
        public_id: "profile-2",
        display_name: "Sam",
        focus_seconds_7d: 3600,
        updated_at: "2026-04-07T12:55:00.000Z",
      }),
    ];

    renderView({ leaderboard, profileDisplayName: "Sam", ownRank: 2 });

    const list = screen.getByRole("list", { name: /global focus leaderboard rankings/i });
    const boardBlock = screen.getByLabelText(/^global leaderboard$/i);
    const rows = within(list).getAllByRole("listitem");

    expect(rows).toHaveLength(2);
    expect(within(boardBlock).getByText("Participant")).toBeTruthy();
    expect(within(boardBlock).getByText("Focus time")).toBeTruthy();
    expect(within(boardBlock).getByText("Daily avg")).toBeTruthy();
    expect(within(rows[0]).getByText("#1")).toBeTruthy();
    expect(within(rows[0]).getByText("Alex")).toBeTruthy();
    expect(within(rows[0]).getByText("2h 1m")).toBeTruthy();
    expect(within(rows[0]).queryByText(/focus time/i)).toBeNull();
    expect(within(rows[0]).queryByText(/daily avg/i)).toBeNull();
    expect(within(rows[0]).queryByText(/1h ago/i)).toBeNull();

    expect(within(rows[1]).getByText("#2")).toBeTruthy();
    expect(within(rows[1]).getByText("Sam")).toBeTruthy();
    expect(within(rows[1]).queryByText(/your published period total/i)).toBeNull();
    expect(within(rows[1]).getByText("1h")).toBeTruthy();
    expect(within(rows[1]).queryByText(/5m ago/i)).toBeNull();
    expect(screen.getAllByText("#2").length).toBeGreaterThanOrEqual(2);

    expect(screen.queryByText("2026-04-01")).toBeNull();
    expect(screen.queryByText("2026-04-07")).toBeNull();
  });

  it("filters leaderboard rows by search text", () => {
    const leaderboard: LeaderboardRow[] = [
      makeLeaderboardRow({
        rank: 1,
        public_id: "profile-1",
        display_name: "Alex",
        focus_seconds_7d: 7260,
        updated_at: "2026-04-07T12:00:00.000Z",
      }),
      makeLeaderboardRow({
        rank: 2,
        public_id: "profile-2",
        display_name: "Sam",
        focus_seconds_7d: 3600,
        updated_at: "2026-04-07T12:55:00.000Z",
      }),
    ];

    renderView({ leaderboard });
    fireEvent.change(screen.getByRole("searchbox", { name: /search leaderboard/i }), { target: { value: "sam" } });

    const list = screen.getByRole("list", { name: /global focus leaderboard rankings/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("Sam")).toBeTruthy();
    expect(within(list).queryByText("Alex")).toBeNull();
    expect(screen.getByText("1 of 2")).toBeTruthy();
  });

  it("opens the selected participant profile from a ranked row", () => {
    const onSelectProfile = vi.fn();
    const leaderboard: LeaderboardRow[] = [
      makeLeaderboardRow({
        rank: 1,
        public_id: "profile-1",
        display_name: "Alex",
        focus_seconds_7d: 7260,
        updated_at: "2026-04-07T12:00:00.000Z",
      }),
    ];

    renderView({ leaderboard, onSelectProfile });

    fireEvent.click(screen.getByRole("button", { name: /view alex profile/i }));

    expect(onSelectProfile).toHaveBeenCalledWith(leaderboard[0]);
  });
});
