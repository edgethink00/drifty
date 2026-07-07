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
    refresh: vi.fn().mockResolvedValue(undefined),
    enable: vi.fn().mockResolvedValue(true),
    disable: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderPage(overrides: Partial<Parameters<typeof ProfilePage>[0]> = {}) {
  const props: Parameters<typeof ProfilePage>[0] = {
    isSupabaseEnabled: true,
    isSignedIn: true,
    displayName: "Alex",
    avatarUrl: "",
    bio: "Building quiet tools.",
    websiteUrl: "https://drifty.so",
    githubUrl: "",
    linkedinUrl: "",
    publicId: PUBLIC_ID,
    focusSeconds7d: 20 * 3600 + 59 * 60,
    card: mockCard(),
    isLeaderboardOptedIn: true,
    leaderboardRank: 3,
    shareMessage: null,
    profileMessage: null,
    profileError: null,
    onEditProfile: vi.fn(),
    onCopyProfileLink: vi.fn(),
    onOpenLeaderboard: vi.fn(),
    onSignIn: vi.fn(),
    ...overrides,
  };
  return { ...render(<ProfilePage {...props} />), props };
}

describe("ProfilePage", () => {
  it("prompts sign-in when signed out", () => {
    const onSignIn = vi.fn();
    renderPage({ isSignedIn: false, onSignIn });

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("shows identity, loads card state on mount, and renders embed snippets when the card is on", () => {
    const card = mockCard({ enabled: true });
    renderPage({ card });

    expect(screen.getByRole("heading", { name: "Alex" })).toBeTruthy();
    expect(screen.getByText("Building quiet tools.")).toBeTruthy();
    expect(card.refresh).toHaveBeenCalled();

    const values = (screen.getAllByRole("textbox") as HTMLInputElement[]).map((input) => input.value);
    expect(values.some((v) => v.includes(`badge?id=${PUBLIC_ID}`))).toBe(true);
    expect(values.some((v) => v.includes(`drifty.so/embed/?id=${PUBLIC_ID}`))).toBe(true);
    expect(values.some((v) => v.includes(`drifty.so/profile/?id=${PUBLIC_ID}`))).toBe(true);
    expect(values.some((v) => v.includes("&format=json"))).toBe(true);

    const preview = screen.getByAltText("Focus badge preview") as HTMLImageElement;
    expect(preview.getAttribute("src")?.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("locks embeds while the card is private: previews visible, snippets unavailable", () => {
    renderPage({ card: mockCard({ enabled: false }) });

    expect(screen.getByText(/private — these go live/i)).toBeTruthy();
    // Visuals stay visible…
    expect(screen.getByAltText("Focus badge preview")).toBeTruthy();
    // …but the snippet inputs and copy buttons are disabled.
    const inputs = document.querySelectorAll<HTMLInputElement>(".profile-embed-stack input");
    expect(inputs.length).toBeGreaterThan(0);
    inputs.forEach((input) => expect(input.disabled).toBe(true));
    const copyButtons = document.querySelectorAll<HTMLButtonElement>(".profile-embed-stack button");
    copyButtons.forEach((button) => expect(button.disabled).toBe(true));
    // The identity-block profile link stays active.
    const profileLinkInput = (screen.getAllByRole("textbox") as HTMLInputElement[]).find((input) => input.value.includes("drifty.so/profile/?id="));
    expect(profileLinkInput?.disabled ?? true).toBe(false);
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
    fireEvent.click(screen.getAllByRole("button", { name: /^copy$/i })[0]);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: /copied/i })).toBeTruthy();
  });

  it("guides profile setup when there is no public id yet", () => {
    const onEditProfile = vi.fn();
    renderPage({ publicId: null, onEditProfile });

    expect(screen.getByText(/save your profile once to mint your public link/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /set up profile/i }));
    expect(onEditProfile).toHaveBeenCalledTimes(1);
  });

  it("summarizes leaderboard participation and links to the board", () => {
    const onOpenLeaderboard = vi.fn();
    renderPage({ isLeaderboardOptedIn: true, leaderboardRank: 3, onOpenLeaderboard });

    expect(screen.getByText(/on the board · #3/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /open leaderboard/i }));
    expect(onOpenLeaderboard).toHaveBeenCalledTimes(1);
  });
});
