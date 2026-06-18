// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserOnboardingStorageKey } from "./features/onboarding/OnboardingModal";

const {
  authState,
  trackerClient,
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
  publishOwnFocusTotal,
  optOutLeaderboard,
  fetchOwnProfile,
  saveOwnProfile,
  fetchPublicProfile,
  submitFeedback,
  billingMocks,
} = vi.hoisted(() => {
  return {
    authState: {
    user: null as { id: string; email: string | null; is_anonymous?: boolean } | null,
    session: null,
    status: "unauthenticated" as "loading" | "authenticated" | "unauthenticated",
    callbackStatus: null as { phase: "waiting" | "received" | "exchanging" | "completed" | "failed"; message: string } | null,
    isEnabled: true,
    authMode: "optional" as "optional" | "required",
    isAuthRequired: false,
    allowsAnonymousAuth: true,
    hasRequiredAccountAuth: false,
    hasBlockingAuthConfigurationError: false,
    signInAnonymously: vi.fn(),
    signInWithWebsite: vi.fn(),
    signInWithGoogle: vi.fn(),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    clearCallbackStatus: vi.fn(),
    signOut: vi.fn(),
  },
  trackerClient: {
    getStatus: vi.fn().mockResolvedValue({
      running: false,
      accessibilityGranted: false,
      lastEventAt: null,
      databasePath: null,
      trackerMode: "unavailable",
      message: "Tracker not available in this environment",
    }),
    getTimeline: vi.fn().mockResolvedValue([]),
    getDashboardWeekTimeline: vi.fn().mockResolvedValue([]),
    getLiveTail: vi.fn().mockResolvedValue({
      running: false,
      trackerMode: "tracking",
      lastEventAt: null,
      segments: [],
    }),
    getCurrentSnapshot: vi.fn().mockResolvedValue(null),
    getHourlySummary: vi.fn().mockResolvedValue([]),
    getTopSites: vi.fn().mockResolvedValue([]),
    getAppIcons: vi.fn().mockResolvedValue({}),
    start: vi.fn(),
    stop: vi.fn(),
    updateTrayProductivityIcon: vi.fn().mockResolvedValue(undefined),
  },
  fetchGlobalLeaderboard: vi.fn(),
  fetchOwnLeaderboardEntry: vi.fn(),
  publishOwnFocusTotal: vi.fn(),
  optOutLeaderboard: vi.fn(),
  fetchOwnProfile: vi.fn(),
  saveOwnProfile: vi.fn(),
  fetchPublicProfile: vi.fn(),
    submitFeedback: vi.fn(),
    billingMocks: {
      fetchBillingEntitlement: vi.fn().mockResolvedValue({ success: true, data: { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null } }),
      createIndividualCheckout: vi.fn().mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } }),
    },
  };
});

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

vi.mock("./features/feedback/feedbackService", () => ({
  FEEDBACK_CATEGORY_OPTIONS: [
    { id: "idea", label: "Idea" },
    { id: "bug", label: "Bug" },
    { id: "other", label: "Other" },
  ],
  submitFeedback,
}));

vi.mock("./features/billing/billingService", () => ({
  fetchBillingEntitlement: billingMocks.fetchBillingEntitlement,
  createIndividualCheckout: billingMocks.createIndividualCheckout,
}));

vi.mock("./lib/api/trackerClient", () => ({
  trackerClient,
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

async function openAccountMenu() {
  fireEvent.click(await screen.findByRole("button", { name: /account/i }));
  return screen.findByRole("menu", { name: /account menu/i });
}

async function openAuthModalFromAccountMenu() {
  const menu = await openAccountMenu();
  fireEvent.click(within(menu).getByRole("menuitem", { name: /sign in/i }));
}


describe("App auth modal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    markOnboardingCompleted("local");
    markOnboardingCompleted("user-1");
    authState.user = null;
    authState.status = "unauthenticated";
    authState.callbackStatus = null;
    authState.isEnabled = true;
    authState.authMode = "optional";
    authState.isAuthRequired = false;
    authState.allowsAnonymousAuth = true;
    authState.hasRequiredAccountAuth = false;
    authState.hasBlockingAuthConfigurationError = false;
    authState.clearCallbackStatus.mockImplementation(() => {
      authState.callbackStatus = null;
    });
    authState.signInWithWebsite.mockResolvedValue({ error: null });
    authState.signInWithGoogle.mockResolvedValue({ error: null });
    authState.signInWithEmail.mockResolvedValue({ error: null });
    authState.signUpWithEmail.mockResolvedValue({ error: null, needsEmailConfirmation: false });
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: null });
    fetchOwnProfile.mockResolvedValue({ success: true, error: null, data: null });
    fetchPublicProfile.mockResolvedValue({ success: true, error: null, data: null });
    saveOwnProfile.mockResolvedValue({ success: true, error: null, data: null });
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null, data: null });
    optOutLeaderboard.mockResolvedValue({ success: true, error: null });
    submitFeedback.mockResolvedValue({ success: true });
  });

  it("renders the workspace for signed-out individual users without a login gate", async () => {
    render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /sign in to drifty/i })).toBeNull();
    expect(screen.getByRole("button", { name: /account/i })).toBeTruthy();
  });

  it("keeps the local workspace available when required auth mode has no signed-in user", async () => {
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    expect(screen.queryByRole("main", { name: /sign in required/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /sign in to use drifty/i })).toBeNull();
    await waitFor(() => expect(trackerClient.getStatus).toHaveBeenCalled());
    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalled());
    expect(trackerClient.start).not.toHaveBeenCalled();
  });

  it("uses Drifty and drifty.so copy in the required auth gate", async () => {
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    expect(screen.queryByRole("main", { name: /sign in required/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /sign in to use drifty/i })).toBeNull();
    expect(screen.queryByText(/beta deploys/i)).toBeNull();
    expect(screen.queryByText(/before the app opens/i)).toBeNull();
    expect(screen.queryByText(/legacy-auth-domain\.example/i)).toBeNull();
  });

  it("uses a centered required auth layout without body copy", async () => {
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    expect(screen.queryByRole("main", { name: /sign in required/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /sign in to use drifty/i })).toBeNull();
  });

  it("keeps the local workspace available when required auth mode restores an anonymous Supabase user", async () => {
    authState.user = { id: "anon-1", email: null, is_anonymous: true };
    authState.status = "authenticated";
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    expect(screen.queryByRole("main", { name: /sign in required/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /sign in to use drifty/i })).toBeNull();
  });

  it("keeps the local workspace available when required auth mode lacks Supabase config", async () => {
    authState.isEnabled = false;
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = false;
    authState.hasBlockingAuthConfigurationError = true;

    render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    expect(screen.queryByRole("main", { name: /authentication configuration required/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /authentication setup required/i })).toBeNull();
  });

  it("opens sign-in directly from the local account menu", async () => {
    render(<App />);

    await openAuthModalFromAccountMenu();

    expect(await screen.findByRole("heading", { name: /sign in to drifty/i })).toBeTruthy();
    expect(screen.getByLabelText(/^email$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^password$/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
  });

  it("uses Drifty copy and direct email auth in the visible auth modal", async () => {
    render(<App />);

    await openAuthModalFromAccountMenu();

    expect(await screen.findByRole("heading", { name: /sign in to drifty/i })).toBeTruthy();
    expect(screen.getByText(/use your drifty account to sync and publish/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeTruthy();
    expect(screen.getByText(/by continuing, you accept/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /terms/i }).getAttribute("href")).toBe("https://drifty.so/terms/");
    expect(screen.getByRole("link", { name: /privacy/i }).getAttribute("href")).toBe("https://drifty.so/privacy/");
    expect(screen.queryByText(/legacy-auth-domain\.example/i)).toBeNull();
  });

  it("signs in with email directly from the auth modal", async () => {
    render(<App />);
    await openAuthModalFromAccountMenu();

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: " alex@example.com " } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(authState.signInWithEmail).toHaveBeenCalledWith("alex@example.com", "correct horse");
    });
    expect(authState.signInWithWebsite).not.toHaveBeenCalled();
  });

  it("validates signup password length before calling auth", async () => {
    render(<App />);
    await openAuthModalFromAccountMenu();

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "alex@example.com" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: /^create account$/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/at least 12 characters/i);
    expect(authState.signUpWithEmail).not.toHaveBeenCalled();
  });

  it("opens feedback from the account menu and sends explicit feedback with selected images", async () => {
    render(<App />);

    const menu = await openAccountMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /send feedback/i }));

    const dialog = await screen.findByRole("dialog", { name: /send feedback/i });
    expect(within(dialog).queryByText(/product feedback/i)).toBeNull();
    expect(dialog.textContent).not.toMatch(/start with the note|a feature or improvement|something broken|anything else/i);
    expect(dialog.textContent).not.toMatch(/does not attach app, site, window, or session history/i);
    expect(
      Array.from(dialog.querySelectorAll(".feedback-modal__field > span, .feedback-modal__categories legend")).map(
        (node) => node.textContent,
      ),
    ).toEqual(["Message", "Category", "Email"]);

    fireEvent.click(within(dialog).getByRole("button", { name: /^send feedback$/i }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/write a short note/i);

    fireEvent.change(within(dialog).getByLabelText(/message/i), { target: { value: "  The timer froze after wake.  " } });
    fireEvent.change(within(dialog).getByLabelText(/add images/i), {
      target: { files: [new File(["not-image"], "tracker.log", { type: "text/plain" })] },
    });
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/supported image type/i);
    expect(within(dialog).queryByText("tracker.log")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/add images/i), {
      target: { files: [new File(["image-bytes"], "wake-bug.png", { type: "image/png" })] },
    });
    expect(within(dialog).getByText("wake-bug.png")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("radio", { name: /^bug$/i }));
    fireEvent.change(within(dialog).getByLabelText(/email/i), { target: { value: " alex@example.com " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^send feedback$/i }));

    await waitFor(() => {
      expect(submitFeedback).toHaveBeenCalledTimes(1);
    });
    const payload = submitFeedback.mock.calls[0]?.[0];
    expect(payload).toEqual({
      email: "alex@example.com",
      category: "bug",
      message: "The timer froze after wake.",
      attachments: [{ filename: "wake-bug.png", contentType: "image/png", content: "aW1hZ2UtYnl0ZXM=", size: 11 }],
    });
    expect(Object.keys(payload).sort()).toEqual(["attachments", "category", "email", "message"]);
    expect((await within(dialog).findByRole("status")).textContent).toMatch(/we got your feedback/i);
    expect(within(dialog).queryByRole("button", { name: /^sent$/i })).toBeNull();
    expect((within(dialog).getByRole("button", { name: /^close$/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("closes sign-in when authentication completes", async () => {
    const { rerender } = render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    await openAuthModalFromAccountMenu();
    expect(await screen.findByRole("heading", { name: /sign in to drifty/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeTruthy();

    authState.user = { id: "user-1", email: "alex@example.com" };
    authState.status = "authenticated";
    authState.hasRequiredAccountAuth = true;
    authState.callbackStatus = { phase: "completed", message: "OAuth callback completed." };

    rerender(<App />);

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /sign in to drifty/i })).toBeNull();
    });
    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
  });

  it("renders failed callback status as a dismissible secondary notice", async () => {
    authState.callbackStatus = {
      phase: "failed",
      message: "That sign-in link was incomplete or expired. Please sign in again on drifty.so.",
    };
    const { rerender } = render(<App />);
    await openAuthModalFromAccountMenu();

    expect(await screen.findByRole("heading", { name: /sign in to drifty/i })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/sign-in link was incomplete or expired/i);
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /dismiss callback notice/i }));
    expect(authState.clearCallbackStatus).toHaveBeenCalledTimes(1);

    rerender(<App />);
    expect(screen.queryByText(/sign-in link was incomplete or expired/i)).toBeNull();
  });

  it("renders callback recovery messages with drifty.so", async () => {
    authState.callbackStatus = {
      phase: "failed",
      message: "That sign-in link was incomplete or expired. Please sign in again on drifty.so.",
    };

    render(<App />);
    await openAuthModalFromAccountMenu();

    expect(await screen.findByRole("heading", { name: /sign in to drifty/i })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/sign in again on drifty\.so/i);
    expect(screen.queryByText(/legacy-auth-domain\.example/i)).toBeNull();
  });

  it("replaces a failed callback notice with waiting status when starting Google sign-in", async () => {
    authState.callbackStatus = {
      phase: "failed",
      message: "That sign-in link was incomplete or expired. Please sign in again on drifty.so.",
    };
    authState.signInWithGoogle.mockImplementation(() => {
      authState.callbackStatus = {
        phase: "waiting",
        message: "Browser opened.",
      };
      return Promise.resolve({ error: null });
    });
    const { rerender } = render(<App />);
    await openAuthModalFromAccountMenu();

    fireEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(authState.signInWithGoogle).toHaveBeenCalledTimes(1);
    });
    rerender(<App />);

    expect(screen.queryByText(/sign-in link was incomplete or expired/i)).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/browser opened/i);
    expect(screen.queryByRole("button", { name: /dismiss callback notice/i })).toBeNull();
  });
});
