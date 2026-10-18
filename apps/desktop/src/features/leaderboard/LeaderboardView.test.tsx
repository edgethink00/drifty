// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LeaderboardRow } from "./leaderboardService";
import { LeaderboardView } from "./LeaderboardView";
import { EditProfileModal, ProfileModal } from "../profile/ProfileModals";
import type { FocusCardControls } from "../share/useFocusCard";

type TestProps = Parameters<typeof LeaderboardView>[0];
const PUBLIC_ID = "9f3a1b2c-0000-4d5e-8f6a-1b2c3d4e5f60";
const shareCardModalMock = vi.hoisted(() => ({ props: [] as unknown[] }));
vi.mock("../share/ShareCardModal", () => ({
  ShareCardModal: (props: unknown) => {
    shareCardModalMock.props.push(props);
    return <div role="dialog" aria-label="Share card" />;
  },
}));

afterEach(() => {
  cleanup();
});

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
    shareCard: {
      accountScope: "user-1",
      comparisonWindowKey: "2026-10-13:0",
      theme: "light",
      windowEndDay: "2026-10-13",
      onJoinLeaderboard: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

/** Leave and Embed live in the profile card's menu. */
function openMenuItem(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
  fireEvent.click(screen.getByRole("menuitem", { name }));
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

  it("renders an error state when the fetch fails", () => {
    renderView({ error: "RPC exploded" });

    expect(screen.getByText(/unable to load leaderboard/i)).toBeTruthy();
    expect(screen.getByText("RPC exploded")).toBeTruthy();
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

  it("falls back to the email prefix in the opted-out preview when no profile name is provided", () => {
    renderView({
      isOptedIn: false,
      profileDisplayName: "   ",
      email: "focus-mode@example.com",
    });

    expect(screen.getAllByText(/^focus-mode$/).length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the rank embed locked until the selected period has a public rank", () => {
    renderView({ isOptedIn: true, ownFocusSeconds: 5430, ownRank: null, leaderboard: [], publicProfile: makePublicProfile() });

    openMenuItem(/^embed$/i);
    const modal = screen.getByRole("dialog", { name: /^rank embed$/i });
    expect(within(modal).getByRole("note").textContent).toMatch(/not public yet/i);
    for (const snippetInput of within(modal).getAllByRole("textbox")) {
      expect((snippetInput as HTMLInputElement).disabled).toBe(true);
    }
  });

  it("opens a rank-only embed from the profile menu", () => {
    const card = mockCard({ enabled: true });
    renderView({ profileDisplayName: "Alex", publicProfile: makePublicProfile({ card }) });

    openMenuItem(/^embed$/i);

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

    openMenuItem(/^embed$/i);
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

    openMenuItem(/^embed$/i);
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

  it("keeps loading separate from the public bio state and reuses the leaderboard avatar", () => {
    const row = makeLeaderboardRow({
      display_name: "Alex",
      avatar_url: "data:image/png;base64,leaderboard-avatar",
      focus_seconds: 3600,
      rank: 2,
      period: "weekly",
    });

    render(
      <ProfileModal
        row={row}
        profile={null}
        isLoading
        error={null}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: /alex/i });
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(dialog.getAttribute("data-profile-state")).toBe("loading");
    expect(within(dialog).getByRole("status").textContent).toMatch(/loading public profile/i);
    expect(within(dialog).queryByText(/no public bio yet/i)).toBeNull();
    expect(dialog.querySelector(".profile-modal__bio-placeholder")).toBeTruthy();
    expect(dialog.querySelector<HTMLImageElement>(".profile-modal__avatar")?.src).toBe(row.avatar_url);
  });

  it("shows the empty-bio copy only after a profile resolves", () => {
    render(
      <ProfileModal
        row={makeLeaderboardRow({ display_name: "Alex", focus_seconds: 3600, rank: 2, period: "weekly" })}
        profile={{
          public_id: "profile-1",
          display_name: "Alex",
          bio: "",
          avatar_url: "",
          website_url: "",
          github_url: "",
          linkedin_url: "",
          focus_seconds_7d: 3600,
          rank: 2,
          updated_at: "2026-04-07T12:00:00.000Z",
        }}
        isLoading={false}
        error={null}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: /alex/i });
    expect(dialog.hasAttribute("aria-busy")).toBe(false);
    expect(dialog.getAttribute("data-profile-state")).toBe("ready");
    expect(within(dialog).getByText(/no public bio yet/i)).toBeTruthy();
    expect(within(dialog).queryByRole("status")).toBeNull();
  });

  it("does not label an unavailable or failed profile as an empty bio", () => {
    const row = makeLeaderboardRow({ display_name: "Alex", focus_seconds: 3600, rank: 2, period: "weekly" });
    const { rerender } = render(
      <ProfileModal row={row} profile={null} isLoading={false} error={null} onClose={vi.fn()} />,
    );

    let dialog = screen.getByRole("dialog", { name: /alex/i });
    expect(dialog.getAttribute("data-profile-state")).toBe("unavailable");
    expect(within(dialog).getByText(/public profile is no longer available/i)).toBeTruthy();
    expect(within(dialog).queryByText(/no public bio yet/i)).toBeNull();

    rerender(<ProfileModal row={row} profile={null} isLoading={false} error="Unable to load profile" onClose={vi.fn()} />);
    dialog = screen.getByRole("dialog", { name: /alex/i });
    expect(dialog.getAttribute("data-profile-state")).toBe("error");
    expect(within(dialog).getByRole("alert").textContent).toBe("Unable to load profile");
    expect(within(dialog).queryByText(/no public bio yet/i)).toBeNull();
  });

  it("leads the ranked card with the Top %, the time to the next rank, and the rank at the end of the position bar", () => {
    const leaderboard = Array.from({ length: 20 }, (_, index) => makeLeaderboardRow({
      rank: index + 1,
      public_id: "profile-" + (index + 1),
      display_name: "Person " + (index + 1),
      focus_seconds: (40 - index) * 3600,
      participant_count: 103,
    }));
    // #16 has 25h; the member has 24h 36m, so 24m stands between them.
    renderView({ leaderboard, ownRank: 17, ownParticipantCount: 103, ownFocusSeconds: 24 * 3600 + 36 * 60, profileDisplayName: "Person 17", publicProfile: makePublicProfile() });

    const card = screen.getByRole("region", { name: /^your profile$/i });
    expect(card.textContent).toMatch(/Top\s*16\.5%/);
    expect(within(card).getByText((_, element) => element?.classList.contains("lb7-next__text") === true && element.textContent === "24m to #16")).toBeTruthy();
    expect(within(card).getByText("#17 of 103").closest(".lb7-pv8__track")).not.toBeNull();
    expect(within(card).queryByText("#1")).toBeNull();
    expect(within(card).queryByText("#103")).toBeNull();
  });

  it("leads with the rank on a small board and shows the lead over #2 at the top", () => {
    const leaderboard = [3, 2, 1].map((hours, index) => makeLeaderboardRow({ rank: index + 1, public_id: "p" + index, display_name: "P" + index, focus_seconds: hours * 3600, participant_count: 3 }));
    renderView({ leaderboard, ownRank: 1, ownParticipantCount: 3, ownFocusSeconds: 3 * 3600, publicProfile: makePublicProfile() });

    const card = screen.getByRole("region", { name: /^your profile$/i });
    expect(within(card).getByText("#1")).toBeTruthy();
    expect(within(card).getByText("of 3")).toBeTruthy();
    expect(card.textContent).toContain("1h ahead of #2");
    expect(card.textContent).not.toMatch(/Top\s*\d/);
  });

  it("shows the rank alone when the participant total is unknown", () => {
    renderView({ isOptedIn: true, ownFocusSeconds: 5430, ownRank: 117, leaderboard: [], publicProfile: makePublicProfile() });

    const card = screen.getByRole("region", { name: /^your profile$/i });
    expect(within(card).getByText("#117")).toBeTruthy();
    expect(card.textContent).not.toMatch(/of 0/);
  });

  it("says Not ranked yet for a joined member without a published rank, and never infers it from a matching name", () => {
    renderView({
      isOptedIn: true,
      ownRank: null,
      ownFocusSeconds: null,
      profileDisplayName: "Alex",
      leaderboard: [makeLeaderboardRow({ rank: 4, display_name: "Alex", focus_seconds: 7200 })],
      publicProfile: makePublicProfile({ focusSeconds7d: 0 }),
    });

    const card = screen.getByRole("region", { name: /^your profile$/i });
    expect(within(card).getByText("Not ranked yet")).toBeTruthy();
    expect(within(card).getByText(/your rank shows up once your focus is published/i)).toBeTruthy();
    expect(within(card).queryByText("#4")).toBeNull();
    const list = screen.getByRole("list", { name: /global focus leaderboard rankings/i });
    expect(within(list).queryByText("You")).toBeNull();
  });

  it("keeps the standing blank instead of saying Not ranked yet while a joined board loads", () => {
    renderView({ isOptedIn: true, isLoading: true, ownRank: null, publicProfile: makePublicProfile() });

    expect(screen.getByLabelText(/^leaderboard$/i).getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Not ranked yet")).toBeNull();
    expect(screen.getByRole("button", { name: /^weekly$/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("list", { name: /global focus leaderboard rankings/i })).toBeNull();
  });

  it("shows who is on the board and Join before joining, without stale rank, Share or the menu", () => {
    const leaderboard = Array.from({ length: 8 }, (_, index) => makeLeaderboardRow({ rank: index + 1, public_id: "p" + index, display_name: "Person " + (index + 1), focus_seconds: (10 - index) * 3600, participant_count: 102 }));
    renderView({ isOptedIn: false, ownRank: 6, ownParticipantCount: 102, profileDisplayName: "  Alex Kim  ", email: "alex@example.com", leaderboard, publicProfile: makePublicProfile() });

    const card = screen.getByRole("region", { name: /^your profile$/i });
    expect(within(card).getByText(/^Alex Kim$/)).toBeTruthy();
    expect(within(card).getByText("Join to see where you stand")).toBeTruthy();
    expect(within(card).getByText("Only focus totals are shared.")).toBeTruthy();
    expect(within(card).getByText("102 people on this board")).toBeTruthy();
    expect(within(card).getByRole("button", { name: /join leaderboard/i }).getAttribute("title")).toMatch(/public profile page/i);
    expect(within(card).queryByText("#6")).toBeNull();
    expect(card.textContent).not.toMatch(/Top\s*\d/);
    expect(screen.queryByRole("button", { name: /^share$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /more actions/i })).toBeNull();
    expect(screen.queryByText("alex@example.com")).toBeNull();
  });

  it("signs in first when a signed-out user joins", () => {
    const onSignIn = vi.fn();
    const onOptIn = vi.fn();
    renderView({ isSignedIn: false, isOptedIn: false, onSignIn, onOptIn });

    fireEvent.click(screen.getByRole("button", { name: /join leaderboard/i }));

    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onOptIn).not.toHaveBeenCalled();
  });

  it("asks before leaving and leaves only from the confirmation", () => {
    const onOptOut = vi.fn();
    renderView({ isOptedIn: true, ownRank: 5, onOptOut, publicProfile: makePublicProfile() });

    expect(screen.queryByRole("button", { name: /^leave leaderboard$/i })).toBeNull();
    openMenuItem(/^leave leaderboard$/i);
    let dialog = screen.getByRole("dialog", { name: /leave the leaderboard\?/i });
    expect(dialog.textContent).toMatch(/public profile page is turned off/i);
    expect(dialog.textContent).toMatch(/nothing local is deleted/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(onOptOut).not.toHaveBeenCalled();

    openMenuItem(/^leave leaderboard$/i);
    dialog = screen.getByRole("dialog", { name: /leave the leaderboard\?/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^leave leaderboard$/i }));
    expect(onOptOut).toHaveBeenCalledOnce();
  });

  it("keeps a failed leave inside the confirmation", () => {
    const view = renderView({ isOptedIn: true, ownRank: 5, publicProfile: makePublicProfile() });
    openMenuItem(/^leave leaderboard$/i);
    view.rerender(<LeaderboardView isSupabaseEnabled isSignedIn isOptedIn ownRank={5} activePeriod="weekly" leaderboard={[]} actionError="Could not leave" onOptOut={vi.fn()} publicProfile={makePublicProfile()} />);

    const dialog = screen.getByRole("dialog", { name: /leave the leaderboard\?/i });
    expect(within(dialog).getByRole("alert").textContent).toBe("Could not leave");
    expect(within(screen.getByRole("region", { name: /^your profile$/i })).queryByText("Could not leave")).toBeNull();
  });

  it("lists the board from #4 with only safe public fields and marks the member's row", () => {
    const leaderboard = Array.from({ length: 6 }, (_, index) => makeLeaderboardRow({
      rank: index + 1,
      public_id: "profile-" + (index + 1),
      display_name: ["Alex", "Sam", "Rin", "Mo", "Kai", "Lee"][index],
      focus_seconds: (6 - index) * 3600 + 60,
    }));
    renderView({ leaderboard, ownRank: 5, profileDisplayName: "Kai" });

    const hall = screen.getByRole("region", { name: /top 3/i });
    expect(within(hall).getByText("Alex")).toBeTruthy();
    expect(within(hall).getByText("6h 1m")).toBeTruthy();
    const list = screen.getByRole("list", { name: /global focus leaderboard rankings/i });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector(".lb7-row__rank")?.textContent)).toEqual(["#4", "#5", "#6"]);
    expect(within(rows[1]).getByText("You")).toBeTruthy();
    expect(rows[1].classList.contains("is-self")).toBe(true);
    expect(screen.queryByText(/profile-\d/)).toBeNull();
    expect(screen.queryByText("2026-04-01")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("navigation", { name: /leaderboard pages/i })).toBeNull();
  });

  it("adds the member's own row after the loaded slice when the rank is further down", () => {
    const leaderboard = Array.from({ length: 25 }, (_, index) => makeLeaderboardRow({ rank: index + 1, public_id: "p" + index, display_name: "Person " + (index + 1), focus_seconds: (30 - index) * 3600, participant_count: 140 }));
    renderView({ leaderboard, ownRank: 117, ownParticipantCount: 140, ownFocusSeconds: 5430, profileDisplayName: "Alex" });

    const list = screen.getByRole("list", { name: /global focus leaderboard rankings/i });
    expect(within(list).getByText("Beyond the top 25")).toBeTruthy();
    const own = list.querySelector('[data-rank="117"]');
    expect(own?.textContent).toContain("Alex");
    expect(own?.textContent).toContain("1h 31m");
  });

  it("opens a participant's profile from the Top 3 and from a ranked row", () => {
    const onSelectProfile = vi.fn();
    const leaderboard = Array.from({ length: 4 }, (_, index) => makeLeaderboardRow({ rank: index + 1, public_id: "p" + index, display_name: ["Alex", "Sam", "Rin", "Mo"][index], focus_seconds: (5 - index) * 3600 }));
    renderView({ leaderboard, onSelectProfile });

    fireEvent.click(screen.getByRole("button", { name: /view alex profile/i }));
    fireEvent.click(screen.getByRole("button", { name: /view mo profile/i }));

    expect(onSelectProfile).toHaveBeenNthCalledWith(1, leaderboard[0]);
    expect(onSelectProfile).toHaveBeenNthCalledWith(2, leaderboard[3]);
  });

  it("says when no one is ranked yet and when everyone fits in the Top 3", () => {
    const { rerender } = renderView({ isOptedIn: true, leaderboard: [] });
    expect(screen.getByText(/no ranked participants yet/i)).toBeTruthy();
    expect(screen.getByText(/once someone opts in, rankings will appear here/i)).toBeTruthy();

    rerender(<LeaderboardView isSupabaseEnabled isSignedIn isOptedIn activePeriod="weekly" leaderboard={[makeLeaderboardRow({ rank: 1, display_name: "Alex", focus_seconds: 3600 })]} />);
    expect(screen.getByText(/everyone on this board is in the top 3/i)).toBeTruthy();
  });

  it("counts participants in the header only when the total is trustworthy", () => {
    const rows = (count: number | null, length: number) => Array.from({ length }, (_, index) => makeLeaderboardRow({ rank: index + 1, public_id: "p" + index, display_name: "P" + index, participant_count: count }));
    const { rerender } = renderView({ leaderboard: rows(2_858, 100), ownParticipantCount: 2_858, ownRank: 117, totalFocusSeconds7d: 3600 });
    expect(screen.getByText(/2,858 participants · 1h total/)).toBeTruthy();

    rerender(<LeaderboardView isSupabaseEnabled isSignedIn isOptedIn activePeriod="weekly" leaderboard={rows(5, 31)} ownParticipantCount={5} />);
    expect(screen.queryByText(/participants ·/)).toBeNull();

    rerender(<LeaderboardView isSupabaseEnabled isSignedIn isOptedIn activePeriod="weekly" leaderboard={[]} ownParticipantCount={0} />);
    expect(screen.getByText(/ · 0 participants · /)).toBeTruthy();
  });

  it("puts one status beside the period switch: refresh first, then what needs action, then quiet progress", () => {
    const status = () => screen.getByRole("status");
    const base = { isSupabaseEnabled: true, isSignedIn: true, isOptedIn: true, activePeriod: "weekly" as const, leaderboard: [] };
    const { rerender } = render(<LeaderboardView {...base} statusMessage="Refreshing leaderboard" statusTone="neutral" publicProfile={makePublicProfile({ profileError: "Unable to save profile" })} />);
    expect(status().textContent).toBe("Refreshing leaderboard");
    expect(status().getAttribute("data-tone")).toBe("neutral");

    rerender(<LeaderboardView {...base} publicProfile={makePublicProfile({ profileError: "Unable to save profile" })} />);
    expect(status().textContent).toBe("Unable to save profile");
    expect(status().getAttribute("data-tone")).toBe("error");

    rerender(<LeaderboardView {...base} publiclyValid={false} publicProfile={makePublicProfile()} />);
    expect(status().textContent).toBe("Validation failed · check date & time");

    rerender(<LeaderboardView {...base} publicProfile={makePublicProfile({ localMetricsStatus: "error", focusSeconds7d: 0 })} />);
    expect(status().textContent).toBe("Local focus totals are unavailable.");
    expect(status().getAttribute("data-tone")).toBe("neutral");
    expect(screen.getByRole("region", { name: /^your profile$/i }).querySelector(".lb7-pv8__weekcopy strong")?.textContent).toBe("—");

    rerender(<LeaderboardView {...base} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the loading frame ahead of a stale fetch error", () => {
    renderView({ error: "Previous RPC error", isLoading: true });

    expect(screen.queryByText(/unable to load leaderboard/i)).toBeNull();
    expect(screen.getByLabelText(/^leaderboard$/i).getAttribute("aria-busy")).toBe("true");
  });

  it("shows the profile's edit control and links", () => {
    const onEditProfile = vi.fn();
    renderView({ profileDisplayName: "Alex", publicProfile: makePublicProfile({ onEditProfile }) });

    const card = screen.getByRole("region", { name: /^your profile$/i });
    fireEvent.click(within(card).getByRole("button", { name: /^edit profile$/i }));
    expect(within(card).getByRole("link", { name: /drifty\.so/i }).getAttribute("href")).toMatch(/^https:\/\/drifty\.so\/?$/);
    expect(within(card).getByText("Building quiet tools.")).toBeTruthy();
    expect(onEditProfile).toHaveBeenCalledTimes(1);
  });

  it("titles the page with one shared page-header h1, also when the board cannot load", () => {
    const { rerender } = renderView();
    const heading = screen.getByRole("heading", { level: 1, name: /^leaderboard$/i });
    expect(heading.closest(".pg-head")).not.toBeNull();
    expect(screen.getAllByRole("heading", { name: /^leaderboard$/i })).toHaveLength(1);

    rerender(<LeaderboardView isSupabaseEnabled isSignedIn isOptedIn activePeriod="weekly" leaderboard={[]} error="RPC exploded" />);
    expect(screen.getByRole("heading", { level: 1, name: /^leaderboard$/i }).closest(".pg-head")).not.toBeNull();
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

    it("shows neither Join nor Share nor the menu, and announces the check", () => {
      renderView(pendingProps());

      expect(screen.queryByRole("button", { name: /join leaderboard/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /^share$/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /more actions/i })).toBeNull();
      expect(screen.queryByText("Join to see where you stand")).toBeNull();
      expect(screen.getByRole("status", { name: /checking your leaderboard participation/i })).toBeTruthy();
    });

    it("stays neutral even while the board is loading", () => {
      renderView({ ...pendingProps(), isLoading: true });

      expect(screen.queryByRole("button", { name: /join leaderboard/i })).toBeNull();
      expect(screen.queryByText("Join to see where you stand")).toBeNull();
    });

    it("restores the joined controls once participation resolves", () => {
      const { rerender } = renderView(pendingProps());

      rerender(<LeaderboardView isSupabaseEnabled isSignedIn isOptedIn isParticipationResolved activePeriod="weekly" leaderboard={[]} publicProfile={makePublicProfile()} onOptOut={vi.fn()} />);

      expect(screen.getByRole("button", { name: /^share$/i })).toBeTruthy();
      openMenuItem(/^leave leaderboard$/i);
      expect(screen.getByRole("dialog", { name: /leave the leaderboard\?/i })).toBeTruthy();
    });
  });

  it("disables Join with a Catching up label and says why while AI catches up", () => {
    const { rerender } = renderView({ isOptedIn: false, isCatchingUp: true });

    const button = screen.getByRole("button", { name: /^catching up…$/i });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toMatch(/catching up on recent activity/i);
    expect(screen.getByRole("status").textContent).toMatch(/AI is catching up on recent activity/i);

    rerender(<LeaderboardView isSupabaseEnabled isSignedIn isOptedIn={false} isCatchingUp={false} activePeriod="weekly" leaderboard={[]} onOptIn={vi.fn()} />);
    expect(screen.getByRole("button", { name: /join leaderboard/i }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(/AI is catching up on recent activity/i)).toBeNull();
  });

});

describe("LeaderboardView share card", () => {
  const WINDOW_END = "2026-10-13";
  const PROFILE_URL = `https://drifty.so/profile/?id=${PUBLIC_ID}`;
  const WEEK = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"];
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    shareCardModalMock.props.length = 0;
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });

  function shareProfile(overrides: Partial<NonNullable<TestProps["publicProfile"]>> = {}) {
    return makePublicProfile({
      dailyProductivity: WEEK.map((day, index) => ({ day, focus: (index + 1) * 600, drift: 120, neutral: 60 })),
      shareCard: {
        accountScope: "user-1",
        comparisonWindowKey: `${WINDOW_END}:0`,
        theme: "light",
        windowEndDay: WINDOW_END,
        onJoinLeaderboard: vi.fn().mockResolvedValue(undefined),
      },
      ...overrides,
    });
  }

  function lastModalProps() {
    return shareCardModalMock.props[shareCardModalMock.props.length - 1] as {
      card: { kind: "day" | "week"; data: Record<string, unknown> };
      storyIds: readonly string[];
      profileLinkUrl: string | null;
      accountScope: string | null;
      comparisonWindowKey: string;
    };
  }

  it("opens the share card sheet for the weekly rank window instead of copying a link", () => {
    renderView({ isOptedIn: true, activePeriod: "weekly", ownRank: 6, ownParticipantCount: 50, publicProfile: shareProfile() });

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    expect(screen.getByRole("dialog", { name: "Share card" })).toBeTruthy();
    expect(writeText).not.toHaveBeenCalled();
    const props = lastModalProps();
    expect(props.card.kind).toBe("week");
    expect(props.card.data).toMatchObject({ startDay: "2026-10-07", endDay: WINDOW_END, focusSeconds: 28 * 600 });
    expect(props.storyIds).toEqual(["WR4", "WR1", "W5", "X5"]);
    expect(props.profileLinkUrl).toBe(PROFILE_URL);
    expect(props.accountScope).toBe("user-1");
    expect(props.comparisonWindowKey).toBe(`${WINDOW_END}:0`);
  });

  it("shares today's card, leading with the exact placement, on the daily board", () => {
    renderView({ isOptedIn: true, activePeriod: "daily", ownRank: 6, ownParticipantCount: 50, publicProfile: shareProfile() });

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    const props = lastModalProps();
    expect(props.card.kind).toBe("day");
    expect(props.card.data).toMatchObject({ day: WINDOW_END, focusSeconds: 7 * 600, deltaSeconds: 600 });
    expect(props.storyIds[0]).toBe("R4");
    expect(props.storyIds).not.toContain("X4");
  });

  it("falls back to the weekly card on the monthly board", () => {
    renderView({ isOptedIn: true, activePeriod: "monthly", publicProfile: shareProfile() });

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    expect(lastModalProps().card.kind).toBe("week");
  });

  it("offers no profile link while the public page is off", () => {
    const profile = shareProfile();
    renderView({ isOptedIn: true, publicProfile: { ...profile, draft: { ...profile.draft, isPublic: false } } });

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    expect(lastModalProps().profileLinkUrl).toBeNull();
  });

  it("waits for the daily series before Share can open", () => {
    renderView({ isOptedIn: true, publicProfile: shareProfile({ dailyProductivity: null }) });

    expect((screen.getByRole("button", { name: /^share$/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets a ranked member share the place card when the daily series is unavailable", () => {
    renderView({ isOptedIn: true, activePeriod: "weekly", ownRank: 6, ownParticipantCount: 50, publicProfile: shareProfile({ dailyProductivity: null }) });

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    expect(lastModalProps().storyIds).toEqual(["WR4"]);
  });
});
