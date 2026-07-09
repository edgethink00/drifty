// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProfilePage } from "./ProfilePage";
import type { FocusCardControls } from "../share/useFocusCard";

const PUBLIC_ID = "9f3a1b2c-0000-4d5e-8f6a-1b2c3d4e5f60";

function mockCard(overrides: Partial<FocusCardControls> = {}): FocusCardControls {
  return {
    enabled: false,
    busy: false,
    error: null,
    detailFlags: { shareCategoryBreakdown: false, shareHourlyPattern: false, shareTopApps: false },
    refresh: vi.fn().mockResolvedValue(undefined),
    enable: vi.fn().mockResolvedValue(true),
    disable: vi.fn().mockResolvedValue(undefined),
    setDetailFlag: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function expandEmbeds() {
  fireEvent.click(screen.getByRole("button", { name: /^show$/i }));
}

// The Dev-gated redesign preserves every test hook of the classic layout, so the
// whole suite runs against both branches — proving toggle-off (classic) and
// toggle-on (redesign) stay behaviourally identical.
describe.each([{ redesign: false }, { redesign: true }])("ProfilePage (redesign=$redesign)", ({ redesign }) => {
  function renderPage(overrides: Partial<Parameters<typeof ProfilePage>[0]> = {}) {
    const props: Parameters<typeof ProfilePage>[0] = {
      isSupabaseEnabled: true,
      isSignedIn: true,
      displayName: "Alex",
      avatarUrl: "",
      draft: {
        displayName: "Alex",
        bio: "Building quiet tools.",
        avatarUrl: "",
        websiteUrl: "https://drifty.so",
        githubUrl: "",
        linkedinUrl: "",
        isPublic: true,
      },
      onDraftChange: vi.fn(),
      onSaveProfile: vi.fn(),
      isSavingProfile: false,
      publicId: PUBLIC_ID,
      focusSeconds7d: 20 * 3600 + 59 * 60,
      dailyProductivity: null,
      card: mockCard(),
      isLeaderboardOptedIn: true,
      leaderboardRank: 3,
      shareMessage: null,
      profileMessage: null,
      profileError: null,
      redesign,
      onEditProfile: vi.fn(),
      onCopyProfileLink: vi.fn(),
      onOpenLeaderboard: vi.fn(),
      onSignIn: vi.fn(),
      ...overrides,
    };
    return { ...render(<ProfilePage {...props} />), props };
  }

  it("prompts sign-in when signed out", () => {
    const onSignIn = vi.fn();
    renderPage({ isSignedIn: false, onSignIn });

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("edits profile fields inline and saves", () => {
    const onDraftChange = vi.fn();
    const onSaveProfile = vi.fn();
    renderPage({ onDraftChange, onSaveProfile });

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Alex D" } });
    expect(onDraftChange).toHaveBeenCalledWith({ displayName: "Alex D" });
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "https://ex.io" } });
    expect(onDraftChange).toHaveBeenCalledWith({ websiteUrl: "https://ex.io" });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSaveProfile).toHaveBeenCalledTimes(1);
  });

  it("shows identity, loads card state on mount, and renders embed snippets when the card is on", () => {
    const card = mockCard({ enabled: true });
    renderPage({ card });
    expandEmbeds();

    expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("Alex");
    expect((screen.getByLabelText("Bio") as HTMLTextAreaElement).value).toBe("Building quiet tools.");
    expect(card.refresh).toHaveBeenCalled();

    const values = (screen.getAllByRole("textbox") as HTMLInputElement[]).map((input) => input.value);
    expect(values.some((v) => v.includes(`badge?id=${PUBLIC_ID}`))).toBe(true);
    expect(values.some((v) => v.includes(`drifty.so/embed/?id=${PUBLIC_ID}`))).toBe(true);
    expect(values.some((v) => v.includes(`drifty.so/profile/?id=${PUBLIC_ID}`))).toBe(true);
    expect(values.some((v) => v.includes("&format=json"))).toBe(true);
    expect(values.some((v) => v.includes("view=chart"))).toBe(true);

    const previews = screen.getAllByAltText(/focus badge preview/i) as HTMLImageElement[];
    expect(previews).toHaveLength(2); // light + dark, both live-rendered
    expect(previews.every((img) => img.getAttribute("src")?.startsWith("data:image/svg+xml"))).toBe(true);
  });

  it("locks embeds while the card is private: previews visible, snippets unavailable", () => {
    renderPage({ card: mockCard({ enabled: false }) });
    expandEmbeds();

    expect(document.querySelectorAll(".profile-embed-stack--locked").length).toBe(1);
    // Visuals stay visible…
    expect(screen.getAllByAltText(/focus badge preview/i).length).toBeGreaterThan(0);
    // …but the snippet inputs and copy buttons are disabled.
    const inputs = document.querySelectorAll<HTMLInputElement>(".profile-embed-stack input");
    expect(inputs.length).toBeGreaterThan(0);
    inputs.forEach((input) => expect(input.disabled).toBe(true));
    const copyButtons = document.querySelectorAll<HTMLButtonElement>(".profile-embed-stack button");
    copyButtons.forEach((button) => expect(button.disabled).toBe(true));
    // The public-page link row only exists while the card is on.
    expect(document.querySelector('[aria-label="Public profile link"]')).toBeNull();
  });

  it("toggles the public focus card on and off", () => {
    const offCard = mockCard({ enabled: false });
    const { unmount } = renderPage({ card: offCard });
    fireEvent.click(screen.getByRole("button", { name: /make public/i }));
    expect(offCard.enable).toHaveBeenCalledTimes(1);
    unmount();

    const onCard = mockCard({ enabled: true });
    renderPage({ card: onCard });
    fireEvent.click(screen.getByRole("button", { name: /make private/i }));
    expect(onCard.disable).toHaveBeenCalledTimes(1);
  });

  it("copies a snippet and shows feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderPage({ card: mockCard({ enabled: true }) });
    expandEmbeds();
    fireEvent.click(screen.getAllByRole("button", { name: /^copy$/i })[0]);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: /copied/i })).toBeTruthy();
  });

  it("guides profile setup when there is no public id yet", () => {
    const onEditProfile = vi.fn();
    renderPage({ publicId: null, onEditProfile });
    expandEmbeds();

    expect(screen.getByText(/save your profile once to mint your public link/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /set up profile/i }));
    expect(onEditProfile).toHaveBeenCalledTimes(1);
  });

  it("keeps embeds collapsed by default and expands on Show", () => {
    renderPage({ card: mockCard({ enabled: true }) });

    expect(document.querySelectorAll(".profile-embed-stack").length).toBe(0);
    expandEmbeds();
    expect(document.querySelectorAll(".profile-embed-stack").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /^hide$/i }));
    expect(document.querySelectorAll(".profile-embed-stack").length).toBe(0);
  });

  it("updates snippets and preview together when theme/range options change", () => {
    renderPage({ card: mockCard({ enabled: true }) });
    expandEmbeds();

    const values = () => (screen.getAllByRole("textbox") as HTMLInputElement[]).map((input) => input.value);
    expect(values().some((v) => v.includes("theme=dark"))).toBe(false);

    fireEvent.click(screen.getByRole("radio", { name: /focus badge preview \(dark\)/i }));
    expect(values().some((v) => v.includes("badge?id=") && v.includes("&theme=dark"))).toBe(true);
    expect(values().some((v) => v.includes("drifty.so/embed") && v.includes("&theme=dark"))).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "30d" }));
    expect(values().some((v) => v.includes("&range=30"))).toBe(true);
  });

  it("renders the 30-day focus/drift chart with summary stats", () => {
    const series = Array.from({ length: 30 }, (_, index) => ({
      day: `2026-06-${String(index + 1).padStart(2, "0")}`,
      focus: index === 29 ? 7200 : 3600,
      drift: 600,
      neutral: 300,
    }));
    renderPage({ dailyProductivity: series });
    expandEmbeds();

    expect(screen.getByRole("img", { name: /daily focus and drift, last 30 days/i })).toBeTruthy();
    expect(screen.getByText(/focus chart · last 30 days/i)).toBeTruthy();
    expect(screen.getByText("06-30 · 2h 0m")).toBeTruthy(); // best day chip
  });

  it("summarizes leaderboard participation and links to the board", () => {
    const onOpenLeaderboard = vi.fn();
    renderPage({ isLeaderboardOptedIn: true, leaderboardRank: 3, onOpenLeaderboard });

    expect(screen.getByText(/on the board · #3/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /open leaderboard/i }));
    expect(onOpenLeaderboard).toHaveBeenCalledTimes(1);
  });

  // The detail-share toggles are Dev-gated behind the web account preview flag, so these
  // tests opt in explicitly; the gate itself is covered by the dedicated suite below.
  it("renders the three detail opt-ins off by default with per-toggle privacy copy", () => {
    renderPage({ card: mockCard({ enabled: true }), webAccountPreview: true });

    const categoryToggle = screen.getByRole("switch", { name: "Category breakdown" }) as HTMLInputElement;
    const hourlyToggle = screen.getByRole("switch", { name: "Hourly focus rhythm" }) as HTMLInputElement;
    const topAppsToggle = screen.getByRole("switch", { name: "Top apps" }) as HTMLInputElement;
    expect(categoryToggle.checked).toBe(false);
    expect(hourlyToggle.checked).toBe(false);
    expect(topAppsToggle.checked).toBe(false);

    // Per-toggle privacy copy; top apps carries the explicit app-name warning.
    expect(screen.getByText(/no app names, titles, or urls/i)).toBeTruthy();
    expect(screen.getByText(/not a timeline of your sessions/i)).toBeTruthy();
    expect(screen.getByText(/makes those app names public/i)).toBeTruthy();
  });

  it("flips a detail opt-in through the card controls", () => {
    const card = mockCard({ enabled: true });
    renderPage({ card, webAccountPreview: true });

    fireEvent.click(screen.getByRole("switch", { name: "Top apps" }));
    expect(card.setDetailFlag).toHaveBeenCalledWith("shareTopApps", true);

    fireEvent.click(screen.getByRole("switch", { name: "Category breakdown" }));
    expect(card.setDetailFlag).toHaveBeenCalledWith("shareCategoryBreakdown", true);
  });

  it("reflects server-side detail flags and disables the toggles until they load", () => {
    const { unmount } = renderPage({
      card: mockCard({
        enabled: true,
        detailFlags: { shareCategoryBreakdown: true, shareHourlyPattern: false, shareTopApps: true },
      }),
      webAccountPreview: true,
    });
    expect((screen.getByRole("switch", { name: "Category breakdown" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("switch", { name: "Hourly focus rhythm" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("switch", { name: "Top apps" }) as HTMLInputElement).checked).toBe(true);
    unmount();

    renderPage({ card: mockCard({ detailFlags: null }), webAccountPreview: true });
    expect((screen.getByRole("switch", { name: "Category breakdown" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("switch", { name: "Top apps" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("hides the detail-share toggles unless the web account preview flag is on", () => {
    const card = mockCard({ enabled: true });
    const { unmount } = renderPage({ card }); // default: webAccountPreview off
    expect(screen.queryByRole("switch", { name: "Category breakdown" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Hourly focus rhythm" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Top apps" })).toBeNull();
    expect(document.querySelector(".profile-detail-shares")).toBeNull();
    // The already-shipped Embeds section stays visible regardless of the flag.
    expect(document.querySelector('[aria-label="Embeds"]')).not.toBeNull();
    unmount();

    renderPage({ card: mockCard({ enabled: true }), webAccountPreview: true });
    expect(screen.getByRole("switch", { name: "Category breakdown" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Hourly focus rhythm" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Top apps" })).toBeTruthy();
  });

  it("edits the public profile visibility through the draft", () => {
    const onDraftChange = vi.fn();
    renderPage({ onDraftChange });

    const toggle = screen.getByRole("switch", { name: "Public profile" }) as HTMLInputElement;
    expect(toggle.checked).toBe(true); // draft.isPublic
    fireEvent.click(toggle);
    expect(onDraftChange).toHaveBeenCalledWith({ isPublic: false });
  });
});

// The redesign root class is applied only when the flag is on, so the classic CSS
// (base) governs the default and the --v2 overrides never leak into it.
describe("ProfilePage redesign gating", () => {
  const base: Parameters<typeof ProfilePage>[0] = {
    isSupabaseEnabled: true,
    isSignedIn: true,
    displayName: "Alex",
    avatarUrl: "",
    draft: { displayName: "Alex", bio: "", avatarUrl: "", websiteUrl: "", githubUrl: "", linkedinUrl: "", isPublic: false },
    onDraftChange: vi.fn(),
    onSaveProfile: vi.fn(),
    isSavingProfile: false,
    publicId: PUBLIC_ID,
    focusSeconds7d: 3600,
    dailyProductivity: null,
    card: mockCard(),
    isLeaderboardOptedIn: false,
    leaderboardRank: null,
    shareMessage: null,
    profileMessage: null,
    profileError: null,
    onEditProfile: vi.fn(),
    onCopyProfileLink: vi.fn(),
    onOpenLeaderboard: vi.fn(),
    onSignIn: vi.fn(),
  };

  it("adds the --v2 root class only when redesign is on", () => {
    const { container, rerender } = render(<ProfilePage {...base} redesign={false} />);
    expect(container.querySelector(".profile-page")).not.toBeNull();
    expect(container.querySelector(".profile-page--v2")).toBeNull();
    expect(container.querySelector(".profile-identity__main")).not.toBeNull(); // classic markup

    rerender(<ProfilePage {...base} redesign />);
    expect(container.querySelector(".profile-page--v2")).not.toBeNull();
    expect(container.querySelector(".profile-share")).not.toBeNull(); // redesign markup
    expect(container.querySelector(".profile-identity__main")).toBeNull();
  });
});
