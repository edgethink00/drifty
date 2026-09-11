// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LeaderboardRow } from "./leaderboardService";
import { LeaderboardView } from "./LeaderboardView";
import { EditProfileModal, ProfileModal } from "../profile/ProfileModals";
import type { FocusCardControls } from "../share/useFocusCard";

type TestProps = Parameters<typeof LeaderboardView>[0];
const PUBLIC_ID = "9f3a1b2c-0000-4d5e-8f6a-1b2c3d4e5f60";

function renderView(overrides: Partial<TestProps> = {}) {
  const props: TestProps = {
    isSupabaseEnabled: true,
    isSignedIn: true,
    isLoading: false,
    error: null,
    isOptedIn: true,
    activePeriod: "weekly",
    leaderboard: [],
    profileDisplayName: null,
    email: null,
    isActionLoading: false,
    actionError: null,
    onOptIn: vi.fn(),
    onOptOut: vi.fn(),
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

function mockCard(overrides: Partial<FocusCardControls> = {}): FocusCardControls {
  return {
    enabled: false,
    busy: false,
    error: null,
    detailFlags: { shareCategoryBreakdown: false, shareHourlyPattern: false },
    refresh: vi.fn().mockResolvedValue(undefined),
    enable: vi.fn().mockResolvedValue(true),
    disable: vi.fn().mockResolvedValue(undefined),
    setDetailFlag: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makePublicProfile(overrides: Partial<NonNullable<TestProps["publicProfile"]>> = {}): NonNullable<TestProps["publicProfile"]> {
  return {
    card: mockCard(),
    dailyProductivity: null,
    draft: {
      displayName: "Alex",
      bio: "Building quiet tools.",
      avatarUrl: "",
      websiteUrl: "https://drifty.so",
      githubUrl: "",
      linkedinUrl: "",
      isPublic: true,
    },
    focusSeconds7d: 20 * 3600 + 59 * 60,
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

  it("renders a signed-out join state", () => {
    const onSignIn = vi.fn();
    renderView({ isSignedIn: false, isOptedIn: false, onSignIn });

    expect(screen.queryByText(/nothing is published until you join/i)).toBeNull();
    const hero = screen.getByLabelText(/your leaderboard participation/i);
    const heroJoin = within(hero).getByRole("button", { name: /join leaderboard/i });
    const privacyNote = within(hero).getByText(/only focus totals and your public profile are shared/i);
    expect(screen.getAllByRole("button", { name: /join leaderboard/i })).toHaveLength(1);
    expect(heroJoin.getAttribute("aria-describedby")).toBe(privacyNote.id);

    fireEvent.click(heroJoin);

    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("does not present stale rank or focus values before joining", () => {
    renderView({
      isOptedIn: false,
      ownRank: 6,
      profileDisplayName: "Alex",
      leaderboard: [makeLeaderboardRow({ rank: 6, display_name: "Alex", focus_seconds: 3120 })],
      publicProfile: makePublicProfile(),
    });

    const participation = screen.getByLabelText(/your leaderboard participation/i);
    expect(within(participation).queryByText("#6")).toBeNull();
    expect(within(participation).queryByText("52m")).toBeNull();
    expect(within(participation).getByRole("button", { name: /join leaderboard/i }).getAttribute("title")).toMatch(/profile visibility is separate/i);
  });

  it("uses the authenticated entry total even when the user is outside the visible board slice", () => {
    renderView({ isOptedIn: true, ownFocusSeconds: 5430, ownRank: 117, leaderboard: [], publicProfile: makePublicProfile() });

    const participation = screen.getByLabelText(/your leaderboard participation/i);
    expect(within(participation).getByText("#117")).toBeTruthy();
    expect(within(participation).queryByText(/on the board · #117/i)).toBeNull();
    fireEvent.click(within(participation).getByRole("button", { name: /^embed$/i }));
    expect(within(screen.getByRole("dialog", { name: /^rank embed$/i })).getByText("1h 31m")).toBeTruthy();
  });

  it("keeps the rank embed locked until the selected period has a public rank", () => {
    renderView({ isOptedIn: true, ownFocusSeconds: 5430, ownRank: null, leaderboard: [], publicProfile: makePublicProfile() });

    const participation = screen.getByLabelText(/your leaderboard participation/i);
    fireEvent.click(within(participation).getByRole("button", { name: /^embed$/i }));
    const modal = screen.getByRole("dialog", { name: /^rank embed$/i });
    expect(within(modal).getByRole("note").textContent).toMatch(/not public yet/i);
    for (const snippetInput of within(modal).getAllByRole("textbox")) {
      expect((snippetInput as HTMLInputElement).disabled).toBe(true);
    }
  });

  it("does not infer the current user from a duplicate display name", () => {
    renderView({
      isOptedIn: true,
      ownRank: null,
      ownFocusSeconds: null,
      profileDisplayName: "Alex",
      leaderboard: [makeLeaderboardRow({
        rank: 4,
        display_name: "Alex",
        focus_seconds: 7200,
      })],
      publicProfile: makePublicProfile({ focusSeconds7d: 0 }),
    });

    const participation = screen.getByLabelText(/your leaderboard participation/i);
    expect(within(participation).queryByText("#4")).toBeNull();
    expect(within(participation).queryByText("2h")).toBeNull();
    expect(within(participation).getByText("On the board")).toBeTruthy();
  });

  it("keeps the existing participation hero and board as sibling blocks", () => {
    renderView({
      leaderboard: [makeLeaderboardRow({ display_name: "Alex", focus_seconds_7d: 7200 })],
      profileDisplayName: "Alex",
      ownRank: 1,
    });

    const participationBlock = screen.getByLabelText(/^leaderboard participation$/i);
    const boardBlock = screen.getByLabelText(/^global leaderboard$/i);

    expect(participationBlock.contains(boardBlock)).toBe(false);
    expect(boardBlock.contains(participationBlock)).toBe(false);
    expect(within(participationBlock).getByText("#1")).toBeTruthy();
    expect(within(participationBlock).queryByText(/on the board · #1/i)).toBeNull();
    expect(within(participationBlock).getByLabelText(/your leaderboard participation/i).classList.contains("leaderboard-hero")).toBe(true);
    expect(within(boardBlock).getByRole("group", { name: /leaderboard period/i })).toBeTruthy();
    expect(within(boardBlock).getByRole("list", { name: /global focus leaderboard rankings/i })).toBeTruthy();
  });

  it("restores the existing profile actions in the leaderboard hero", () => {
    const onEditProfile = vi.fn();
    renderView({
      profileDisplayName: "Alex",
      publicProfile: makePublicProfile({
        draft: {
          displayName: "Alex",
          bio: "Building quiet tools.",
          avatarUrl: "data:image/png;base64,avatar",
          websiteUrl: "https://drifty.so",
          githubUrl: "",
          linkedinUrl: "",
          isPublic: true,
        },
        onEditProfile,
      }),
    });

    const participation = screen.getByLabelText(/your leaderboard participation/i);
    fireEvent.click(within(participation).getByRole("button", { name: /edit public profile/i }));
    expect(within(participation).getByRole("link", { name: /website/i })).toBeTruthy();
    expect(within(participation).getByRole("button", { name: /^embed$/i })).toBeTruthy();
    expect(onEditProfile).toHaveBeenCalledTimes(1);
  });

  it("opens a rank-only embed from the leaderboard strip", () => {
    const card = mockCard({ enabled: true });
    renderView({ profileDisplayName: "Alex", publicProfile: makePublicProfile({ card }) });

    const strip = screen.getByLabelText(/your leaderboard participation/i);
    fireEvent.click(within(strip).getByRole("button", { name: /^embed$/i }));

    const modal = screen.getByRole("dialog", { name: /^rank embed$/i });
    const [htmlSnippet, markdownSnippet] = within(modal).getAllByRole("textbox") as HTMLInputElement[];
    const designGroup = within(modal).getByRole("group", { name: /embed design/i });
    const designOptions = within(designGroup).getAllByRole("button");
    expect(htmlSnippet!.value).toContain(`id=${PUBLIC_ID}`);
    expect(htmlSnippet!.value).toContain("view=rank");
    expect(htmlSnippet!.value).toContain("design=minimal");
    expect(markdownSnippet!.value).toContain("embed/badge?");
    expect(markdownSnippet!.value).toContain("view=rank");
    expect(designOptions.map((option) => option.textContent)).toEqual(["Minimal", "Compact", "Card"]);
    expect(within(designGroup).getByRole("button", { name: /^minimal$/i }).getAttribute("aria-pressed")).toBe("true");
    expect(modal.querySelector(".rank-embed-preview--minimal")).not.toBeNull();
    expect(within(modal).queryByText(/category breakdown/i)).toBeNull();
    expect(card.refresh).not.toHaveBeenCalled();
  });

  it("uses the public profile photo in card and compact rank embed previews", () => {
    const avatarUrl = "data:image/png;base64,profile-avatar";
    renderView({
      profileDisplayName: "Alex",
      publicProfile: makePublicProfile({
        draft: {
          displayName: "Alex",
          bio: "Building quiet tools.",
          avatarUrl,
          websiteUrl: "https://drifty.so",
          githubUrl: "",
          linkedinUrl: "",
          isPublic: true,
        },
      }),
    });

    fireEvent.click(within(screen.getByLabelText(/your leaderboard participation/i)).getByRole("button", { name: /^embed$/i }));
    const modal = screen.getByRole("dialog", { name: /^rank embed$/i });
    fireEvent.click(within(modal).getByRole("button", { name: /^card$/i }));
    const cardAvatar = modal.querySelector<HTMLImageElement>(".rank-embed-preview__avatar > img");
    expect(cardAvatar?.getAttribute("src")).toBe(avatarUrl);

    fireEvent.click(within(modal).getByRole("button", { name: /^compact$/i }));
    const compactAvatar = modal.querySelector<HTMLImageElement>(".rank-embed-preview__avatar--sm > img");
    expect(compactAvatar?.getAttribute("src")).toBe(avatarUrl);
  });

  it("keeps the profile initial behind a failed rank embed photo", () => {
    renderView({
      profileDisplayName: "Sora",
      publicProfile: makePublicProfile({
        draft: {
          displayName: "Sora",
          bio: "Building quiet tools.",
          avatarUrl: "https://example.test/missing-avatar.png",
          websiteUrl: "https://drifty.so",
          githubUrl: "",
          linkedinUrl: "",
          isPublic: true,
        },
      }),
    });

    fireEvent.click(within(screen.getByLabelText(/your leaderboard participation/i)).getByRole("button", { name: /^embed$/i }));
    const modal = screen.getByRole("dialog", { name: /^rank embed$/i });
    fireEvent.click(within(modal).getByRole("button", { name: /^card$/i }));
    const avatar = modal.querySelector(".rank-embed-preview__avatar");
    const photo = avatar?.querySelector("img");

    expect(photo).not.toBeNull();
    fireEvent.error(photo!);
    expect(avatar?.textContent).toBe("S");
    expect(avatar?.querySelector("img")).toBeNull();
  });

  it("uses the profile editor avatar itself as the photo change control", () => {
    render(
      <EditProfileModal
        displayName="Alex"
        avatarUrl="data:image/png;base64,avatar"
        publicId={null}
        profileDraft={{
          displayName: "Alex",
          bio: "Building quiet tools.",
          avatarUrl: "data:image/png;base64,avatar",
          websiteUrl: "",
          githubUrl: "",
          linkedinUrl: "",
          isPublic: true,
        }}
        profileLoading={false}
        profileSaving={false}
        profileMessage={null}
        profileError={null}
        onClose={vi.fn()}
        onPhotoSelected={vi.fn()}
        onRemovePhoto={vi.fn()}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: /edit profile/i }).getAttribute("aria-modal")).toBe("true");
    expect(screen.getByLabelText(/choose profile photo/i).getAttribute("type")).toBe("file");
    expect(screen.queryByText(/upload picture/i)).toBeNull();
  });

  it("marks the public leaderboard profile popup as a modal dialog", () => {
    render(
      <ProfileModal
        row={makeLeaderboardRow({ display_name: "Alex", focus_seconds: 3600, rank: 2, period: "weekly" })}
        profile={null}
        isLoading={false}
        error={null}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: /alex/i }).getAttribute("aria-modal")).toBe("true");
  });

  it("renders a loading state while leaderboard data is being fetched", () => {
    renderView({ isLoading: true });

    const panel = screen.getByLabelText(/^leaderboard$/i);
    const status = within(panel).getByRole("status");
    const loadingHero = panel.querySelector(".leaderboard-hero");
    const loadingList = panel.querySelector(".leaderboard-list-frame");

    expect(panel.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toBe("Loading latest rankings…");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(loadingHero?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(loadingList?.getAttribute("aria-hidden")).toBe("true");
    expect(panel.querySelector(".leaderboard-toolbar")).not.toBeNull();
    expect(panel.querySelectorAll(".leaderboard-loading-shell__row")).toHaveLength(5);
    expect(within(panel).getByRole("button", { name: "Weekly", hidden: true }).hasAttribute("disabled")).toBe(true);
    expect(panel.querySelector(".leaderboard-search input")?.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText(/checking the latest opt-in rankings/i)).toBeNull();
  });

  it("keeps local focus metrics quiet while they are loading", () => {
    renderView({ publicProfile: makePublicProfile({ localMetricsStatus: "loading", focusSeconds7d: 0 }) });

    const totals = screen.getByLabelText(/focus totals/i);
    expect(within(totals).getAllByText("—")).toHaveLength(3);
    expect(within(totals).queryByText("0m")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Calculating your local focus totals…");
  });

  it("marks local focus metrics unavailable without showing zero totals", () => {
    renderView({ publicProfile: makePublicProfile({ localMetricsStatus: "error", focusSeconds7d: 0 }) });

    const totals = screen.getByLabelText(/focus totals/i);
    expect(within(totals).getAllByText("—")).toHaveLength(3);
    expect(within(totals).queryByText("0m")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Local focus totals are unavailable.");
  });

  it("shows ready weekly totals without inventing a 30-day zero", () => {
    renderView({ publicProfile: makePublicProfile({ focusSeconds7d: 3600 }) });

    const totals = screen.getByLabelText(/focus totals/i);
    expect(within(totals).getByText("1h")).toBeTruthy();
    expect(within(totals).getByText("—")).toBeTruthy();
    expect(within(totals).queryByText("0m")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Calculating your 30-day focus total…");
  });

  it("reports a live public page while off the board, and offers to unpublish", () => {
    const onSetProfileVisibility = vi.fn().mockResolvedValue(true);
    renderView({
      isOptedIn: false,
      publicProfile: makePublicProfile({ liveOffBoard: true, onSetProfileVisibility }),
    });

    expect(screen.getByText(/public profile page is on/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make profile private" }));
    expect(onSetProfileVisibility).toHaveBeenCalledWith(false);
  });

  it("keeps that notice hidden while the user is still on the board", () => {
    renderView({ isOptedIn: true, publicProfile: makePublicProfile({ liveOffBoard: true }) });

    expect(screen.queryByText(/public profile page is on/i)).toBeNull();
  });

  it("renders background refresh status as a non-error toolbar status", () => {
    renderView({
      actionError: null,
      leaderboard: [makeLeaderboardRow({ display_name: "Alex", focus_seconds_7d: 7200 })],
      statusMessage: "Refreshing leaderboard",
      statusTone: "neutral",
    });

    const toolbar = screen.getByLabelText(/global leaderboard/i).querySelector(".leaderboard-toolbar");
    const statusSlot = toolbar?.querySelector(".leaderboard-toolbar__status-slot");
    if (!(statusSlot instanceof HTMLElement)) throw new Error("Expected leaderboard toolbar status slot");
    const refreshStatus = within(statusSlot).getByRole("status");

    expect(refreshStatus.textContent).toBe("Refreshing leaderboard");
    expect(refreshStatus.classList.contains("leaderboard-refresh-status")).toBe(true);
    expect(refreshStatus.classList.contains("capture-recency--error")).toBe(false);
    expect(refreshStatus.getAttribute("data-tone")).toBe("neutral");
    expect(refreshStatus.closest(".capture-recency")).toBeNull();
    expect(refreshStatus.closest(".leaderboard-toolbar__status-slot")).toBe(statusSlot);
  });

  it("omits the idle refresh sentence so the toolbar stays empty until there is a real status", () => {
    renderView({
      leaderboard: [makeLeaderboardRow({ display_name: "Alex", focus_seconds_7d: 7200 })],
    });

    const toolbar = screen.getByLabelText(/global leaderboard/i).querySelector(".leaderboard-toolbar");
    expect(toolbar?.querySelector(".leaderboard-refresh-status--idle")).toBeNull();
    expect(screen.queryByText(/scores refresh throughout the day/i)).toBeNull();
  });

  it("renders an error state when the fetch fails", () => {
    renderView({ error: "RPC exploded" });

    expect(screen.getByText(/unable to load leaderboard/i)).toBeTruthy();
    expect(screen.getByText("RPC exploded")).toBeTruthy();
  });

  it("keeps the stable loading frame ahead of a stale fetch error", () => {
    renderView({ error: "Previous RPC error", isLoading: true });

    expect(screen.getByRole("status").textContent).toBe("Loading latest rankings…");
    expect(screen.queryByText(/unable to load leaderboard/i)).toBeNull();
  });

  it("renders an opted-out state with the exact trimmed public-name preview", () => {
    renderView({
      isOptedIn: false,
      profileDisplayName: "  Alex Kim  ",
      email: "alex@example.com",
    });

    expect(screen.getByText(/not on the board yet/i)).toBeTruthy();
    expect(within(screen.getByLabelText(/your leaderboard participation/i)).getByRole("button", { name: /join leaderboard/i })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /join leaderboard/i })).toHaveLength(1);
    expect(screen.queryByText(/joining shares|join the public leaderboard to share/i)).toBeNull();
    expect(screen.getAllByText(/^Alex Kim$/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("alex@example.com")).toBeNull();
  });

  it("renders join and leave participation controls in the same compact hero action slot", () => {
    const { rerender } = renderView({
      isOptedIn: false,
      profileDisplayName: "Alex",
      email: "alex@example.com",
      onOptOut: vi.fn(),
    });

    const optedOutHero = screen.getByLabelText(/your leaderboard participation/i);
    const joinButton = within(optedOutHero).getByRole("button", { name: /join leaderboard/i });
    const joinActions = joinButton.closest(".leaderboard-hero__participation-slot");
    const joinActionRow = joinActions?.closest(".leaderboard-hero__action-row") as HTMLElement | null;

    expect(joinActions).not.toBeNull();
    expect(joinActions?.contains(joinButton)).toBe(true);
    expect(joinActionRow).not.toBeNull();
    expect(optedOutHero.style.gap).toBe("var(--space-3)");
    expect(joinActionRow?.style.paddingTop).toBe("");
    expect(joinActionRow?.style.borderTop).toBe("");

    rerender(
      <LeaderboardView
        isSupabaseEnabled
        isSignedIn
        isLoading={false}
        error={null}
        isOptedIn
        activePeriod="weekly"
        leaderboard={[]}
        profileDisplayName="Alex"
        email="alex@example.com"
        isActionLoading={false}
        actionError={null}
        onOptIn={vi.fn()}
        onOptOut={vi.fn()}
      />,
    );

    const optedInHero = screen.getByLabelText(/your leaderboard participation/i);
    const leaveButton = within(optedInHero).getByRole("button", { name: /leave leaderboard/i });
    const leaveActions = leaveButton.closest(".leaderboard-hero__participation-slot");
    const leaveActionRow = leaveActions?.closest(".leaderboard-hero__action-row") as HTMLElement | null;

    expect(leaveActions).not.toBeNull();
    expect(leaveActions?.contains(leaveButton)).toBe(true);
    expect(joinActions?.className).toBe(leaveActions?.className);
    expect(joinActionRow?.className).toBe(leaveActionRow?.className);
    expect(optedInHero.style.gap).toBe("var(--space-3)");
    expect(leaveActionRow?.style.paddingTop).toBe("");
    expect(leaveActionRow?.style.borderTop).toBe("");
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
      leaderboard: [makeLeaderboardRow({ period: "monthly", focus_seconds: 108000, focus_seconds_7d: 108000 })],
    });

    expect(screen.getAllByText(/daily avg/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1h").length).toBeGreaterThanOrEqual(1);
  });

  it("does not show daily average for daily periods", () => {
    renderView({
      activePeriod: "daily",
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
    expect(screen.getAllByText("#2").length).toBeGreaterThanOrEqual(1);

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
    expect(screen.getByRole("navigation", { name: /leaderboard pages/i }).textContent).toMatch(/showing 1–1 of 1 matches in all ranked/i);
  });

  it("labels the loaded top slice separately from the full participant count", () => {
    const leaderboard = Array.from({ length: 100 }, (_, index) => makeLeaderboardRow({
      rank: index + 1,
      participant_count: 2_858,
      public_id: `profile-${index + 1}`,
      display_name: `Person ${index + 1}`,
      focus_seconds: (100 - index) * 600,
      updated_at: `2026-04-07T12:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }));

    renderView({ leaderboard, ownParticipantCount: 2_858, ownRank: 117 });

    const scope = screen.getByLabelText(/leaderboard scope/i);
    expect(within(scope).getByText("2,858")).toBeTruthy();
    expect(within(scope).getByText("Top 100 focus")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: /search leaderboard/i }).getAttribute("placeholder")).toBe("Search top 100…");
  });

  it("does not invent a participant total when count metadata is missing or inconsistent", () => {
    const leaderboard = Array.from({ length: 100 }, (_, index) => makeLeaderboardRow({
      rank: index + 1,
      participant_count: null,
      public_id: `profile-${index + 1}`,
      display_name: `Person ${index + 1}`,
      updated_at: `2026-04-07T12:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }));

    renderView({ leaderboard, ownParticipantCount: 90, ownRank: 117 });

    const scope = screen.getByLabelText(/leaderboard scope/i);
    expect(within(scope).getByText("—")).toBeTruthy();
    expect(within(scope).getByText("Top 100 focus")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: /search leaderboard/i }).getAttribute("placeholder")).toBe("Search top 100…");
  });

  it("rejects a participant total below the highest observed rank", () => {
    const leaderboard = Array.from({ length: 31 }, (_, index) => makeLeaderboardRow({
      display_name: `Person ${index + 1}`,
      participant_count: 5,
      rank: index + 1,
    }));

    renderView({ leaderboard, ownParticipantCount: 5, ownRank: null });

    const scope = screen.getByLabelText("Leaderboard scope");
    expect(within(scope).getByText("—")).toBeTruthy();
    expect(within(scope).getByText("All ranked focus")).toBeTruthy();
  });

  it("keeps an explicit zero participant total for an empty board", () => {
    renderView({ leaderboard: [], ownParticipantCount: 0 });

    const scope = screen.getByLabelText("Leaderboard scope");
    expect(within(scope).getByText("0")).toBeTruthy();
  });

  it("paginates the loaded board in groups of 25", () => {
    const leaderboard = Array.from({ length: 60 }, (_, index) => makeLeaderboardRow({
      rank: index + 1,
      public_id: `profile-${index + 1}`,
      display_name: `Person ${index + 1}`,
      focus_seconds: (60 - index) * 600,
      updated_at: `2026-04-07T12:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }));

    renderView({ leaderboard });

    let list = screen.getByRole("list", { name: /global focus leaderboard rankings/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(25);
    expect(within(list).getByText("#1")).toBeTruthy();
    expect(within(list).queryByText("#26")).toBeNull();
    expect(screen.getByRole("navigation", { name: /leaderboard pages/i }).textContent).toMatch(/showing 1–25 of 60/i);

    fireEvent.click(screen.getByRole("button", { name: /next leaderboard page/i }));

    list = screen.getByRole("list", { name: /global focus leaderboard rankings/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(25);
    expect(within(list).getByText("#26")).toBeTruthy();
    expect(within(list).queryByText("#1")).toBeNull();
    expect(screen.getByText(/page 2 of 3/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /next leaderboard page/i }));

    list = screen.getByRole("list", { name: /global focus leaderboard rankings/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    expect(within(list).getByText("#60")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: /leaderboard pages/i }).textContent).toMatch(/showing 51–60 of 60/i);
    expect((screen.getByRole("button", { name: /next leaderboard page/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("returns to the first page when search scope changes", () => {
    const leaderboard = Array.from({ length: 40 }, (_, index) => makeLeaderboardRow({
      rank: index + 1,
      public_id: `profile-${index + 1}`,
      display_name: `Person ${index + 1}`,
      updated_at: `2026-04-07T12:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }));

    renderView({ leaderboard });
    fireEvent.click(screen.getByRole("button", { name: /next leaderboard page/i }));
    expect(screen.getByText(/page 2 of 2/i)).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: /search leaderboard/i }), { target: { value: "Person 3" } });

    expect(screen.getByText(/page 1 of 1/i)).toBeTruthy();
    expect(screen.getByRole("navigation", { name: /leaderboard pages/i }).textContent).toMatch(/showing 1–11 of 11 matches/i);
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

  // Regression: a joined account used to render as a confident "not joined" while
  // the persisted session was still restoring, so Join appeared and Share vanished
  // for a frame before snapping back.
  describe("while participation is still unknown", () => {
    const pendingProps = () => ({
      isOptedIn: false,
      isParticipationResolved: false,
      publicProfile: makePublicProfile(),
    });

    it("shows neither the join nor the leave control", () => {
      renderView(pendingProps());

      expect(screen.queryByRole("button", { name: /join leaderboard/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /^leave leaderboard$/i })).toBeNull();
    });

    it("does not claim the account is off the board", () => {
      renderView(pendingProps());

      expect(screen.queryByText(/not on the board yet/i)).toBeNull();
      expect(screen.getByText(/checking your status/i)).toBeTruthy();
    });

    it("withholds Share but holds its footprint so the hero does not reflow", () => {
      const { container } = renderView(pendingProps());

      expect(screen.queryByRole("button", { name: /^share$/i })).toBeNull();
      // Two placeholders: one for the participation control, one for Share.
      expect(container.querySelectorAll(".leaderboard-hero__participation-placeholder").length).toBe(2);
    });

    it("announces the pending participation check to assistive tech", () => {
      renderView(pendingProps());

      expect(screen.getByRole("status", { name: /checking your leaderboard participation/i })).toBeTruthy();
    });

    it("keeps the participation slot neutral even while the board is loading", () => {
      renderView({ ...pendingProps(), isLoading: true });

      expect(screen.queryByRole("button", { name: /join leaderboard/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /^leave leaderboard$/i })).toBeNull();
    });

    it("restores the joined controls once participation resolves", () => {
      const { rerender } = renderView(pendingProps());

      expect(screen.queryByRole("button", { name: /^share$/i })).toBeNull();

      rerender(
        <LeaderboardView
          isSupabaseEnabled
          isSignedIn
          isLoading={false}
          error={null}
          isOptedIn
          isParticipationResolved
          activePeriod="weekly"
          leaderboard={[]}
          profileDisplayName={null}
          email={null}
          isActionLoading={false}
          actionError={null}
          publicProfile={makePublicProfile()}
          onOptIn={vi.fn()}
          onOptOut={vi.fn()}
        />,
      );

      expect(screen.getByRole("button", { name: /^share$/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^leave leaderboard$/i })).toBeTruthy();
      expect(screen.queryByText(/checking your status/i)).toBeNull();
    });

    it("renders a disabled Catching up button with notice when AI is catching up on recent activity", () => {
      const { rerender } = renderView({
        isSupabaseEnabled: true,
        isSignedIn: true,
        isOptedIn: false,
        isCatchingUp: true,
      });

      const catchingUpButton = screen.getByRole("button", { name: /^catching up…$/i });
      expect(catchingUpButton).toBeTruthy();
      expect(catchingUpButton.hasAttribute("disabled")).toBe(true);
      expect(catchingUpButton.getAttribute("title")).toMatch(/catching up on recent activity/i);
      expect(screen.getByText(/AI is catching up on recent activity/i)).toBeTruthy();

      rerender(
        <LeaderboardView
          isSupabaseEnabled
          isSignedIn
          isLoading={false}
          error={null}
          isOptedIn={false}
          isCatchingUp={false}
          activePeriod="weekly"
          leaderboard={[]}
          profileDisplayName={null}
          email={null}
          isActionLoading={false}
          actionError={null}
          onOptIn={vi.fn()}
          onOptOut={vi.fn()}
        />,
      );

      const joinButton = screen.getByRole("button", { name: /join leaderboard/i });
      expect(joinButton).toBeTruthy();
      expect(joinButton.hasAttribute("disabled")).toBe(false);
      expect(screen.queryByText(/AI is catching up on recent activity/i)).toBeNull();
    });
  });
});
