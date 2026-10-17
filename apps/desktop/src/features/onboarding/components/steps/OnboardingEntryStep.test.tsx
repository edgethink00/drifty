// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthCallbackStatus } from "../../../auth/AuthContext";
import {
  DISPLAY_LANGUAGE_STORAGE_KEY,
  LocalizationProvider,
  useLocalizationController,
} from "../../../localization/LocalizationContext";
import type { OnboardingFlow } from "../../useOnboardingFlow";

const authState = vi.hoisted(() => ({
  status: "unauthenticated" as const,
  callbackStatus: null as OAuthCallbackStatus | null,
  cloudConnectionStatus: "online" as const,
  passwordRecoveryState: { phase: "idle" as const, email: null },
  clearCallbackStatus: vi.fn(),
  signInWithEmail: vi.fn().mockResolvedValue({ error: null }),
  signUpWithEmail: vi.fn().mockResolvedValue({ error: null, needsEmailConfirmation: false }),
  signInWithGoogle: vi.fn().mockResolvedValue({ error: null }),
  signInWithWebsite: vi.fn().mockResolvedValue({ error: null }),
  requestPasswordReset: vi.fn().mockResolvedValue({ error: null }),
  updatePassword: vi.fn().mockResolvedValue({ error: null }),
  cancelPasswordRecovery: vi.fn().mockResolvedValue(undefined),
  retryCloudConnection: vi.fn().mockResolvedValue({ error: null }),
  isEnabled: true,
}));

vi.mock("../../../auth/AuthContext", () => ({
  useAuth: () => authState,
  useAuthConnectionStatus: () => ({
    cloudConnectionStatus: authState.cloudConnectionStatus,
    retryCloudConnection: authState.retryCloudConnection,
  }),
}));

import { OnboardingEntryStep } from "./OnboardingEntryStep";

function entryFlow(overrides: Partial<OnboardingFlow> = {}): OnboardingFlow {
  return {
    step: "account",
    title: "Connect your account",
    titleRef: { current: null },
    accountConnected: false,
    accountAccessState: "disconnected",
    entryAwaitsContinue: false,
    expectsPromotion: false,
    promotionActive: false,
    promotionEndsAt: null,
    skipAccountForDev: vi.fn(),
    continueFromEntry: vi.fn(),
    ...overrides,
  } as unknown as OnboardingFlow;
}

function EntryHarness({ flow = entryFlow(), websiteSignIn }: { readonly flow?: OnboardingFlow; readonly websiteSignIn?: () => void }) {
  const controller = useLocalizationController();
  return (
    <LocalizationProvider controller={controller}>
      <OnboardingEntryStep
        flow={flow}
        authCallbackStatus={null}
        onStartCloudTrialWithGoogle={vi.fn()}
        onStartCloudTrialWithWebsite={websiteSignIn}
      />
    </LocalizationProvider>
  );
}

function mockReducedMotion(reduce: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList);
}

beforeEach(() => {
  window.localStorage.clear();
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: () => ({ matches: false }) });
  }
  mockReducedMotion(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OnboardingEntryStep language policy", () => {
  it("renders the first screen in Korean for a fresh Korean-system user", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["ko-KR", "en-US"]);

    render(<EntryHarness />);

    expect(screen.getByText("drifty에 오신 것을 환영합니다.")).toBeTruthy();
    expect(screen.getByText(/일하는 동안 앱과 웹사이트 사용 시간을 자동으로 기록하고/)).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("ko");
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it("keeps every supported language visible on non-Korean systems", () => {
    render(<EntryHarness />);

    expect(screen.getByText("Welcome to drifty.")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Language" })).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("en");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "es" } });
    expect(screen.getByText("Te damos la bienvenida a drifty.")).toBeTruthy();
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBe("es");
  });

  it("starts Spanish when it is the first preferred language without storing an automatic choice", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["es-US", "en-US"]);
    render(<EntryHarness />);
    expect(screen.getByText("Te damos la bienvenida a drifty.")).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("es");
    expect(document.querySelector(".onb-entry-demo")?.textContent).toContain("8 h");
    expect(document.querySelector(".onb-entry-demo")?.textContent).not.toMatch(/(?:8|11)am/);
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it("lets Korean-system users correct a stored English preference", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["ko-KR", "en-US"]);
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");

    render(<EntryHarness />);

    expect(screen.getByText("Welcome to drifty.")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ko" } });

    expect(screen.getByText("drifty에 오신 것을 환영합니다.")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "언어" })).toBeTruthy();
    expect(window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY)).toBe("ko");
  });

  it("keeps all languages reachable without losing keyboard focus", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["ko-KR", "en-US"]);
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");

    render(<EntryHarness />);

    const picker = screen.getByRole("combobox") as HTMLSelectElement;
    picker.focus();
    expect(screen.getAllByRole("option")).toHaveLength(8);
    fireEvent.change(picker, { target: { value: "ja" } });
    expect(picker.value).toBe("ja");
    expect(document.activeElement).toBe(picker);
    fireEvent.change(picker, { target: { value: "en" } });
    expect(picker.value).toBe("en");
    expect(document.activeElement).toBe(picker);
  });
});

describe("OnboardingEntryStep sign-in", () => {
  it("leads a Pro pass handoff with the pass instead of the product headline", () => {
    render(<EntryHarness flow={entryFlow({ expectsPromotion: true })} websiteSignIn={vi.fn()} />);

    expect(screen.getByText("Connect your Pro pass")).toBeTruthy();
    expect(screen.getByText(/same account that claimed the pass/i)).toBeTruthy();
    expect(screen.queryByText("Welcome to drifty.")).toBeNull();
    expect(screen.getByRole("button", { name: /continue with my drifty\.so account/i })).toBeTruthy();
  });

  it("swaps the column to the email form in place, beside the same product picture", () => {
    const { container } = render(<EntryHarness />);
    const picture = container.querySelector(".onb-entry-demo");

    fireEvent.click(screen.getByRole("button", { name: /continue with email/i }));

    expect(screen.getByRole("heading", { name: /sign in to drifty/i, level: 2 })).toBeTruthy();
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
    expect(screen.getByLabelText(/^password$/i)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /continue with google/i })).toBeNull();
    expect(container.querySelector(".onb-entry-demo")).toBe(picture);

    fireEvent.click(screen.getByRole("button", { name: /other sign-in options/i }));
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /continue with email/i }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
  });

  it("closes the email form once the account connects", () => {
    const { rerender } = render(<EntryHarness />);
    fireEvent.click(screen.getByRole("button", { name: /continue with email/i }));

    rerender(<EntryHarness flow={entryFlow({ accountConnected: true, accountAccessState: "standard-confirmed" })} />);

    expect(screen.queryByLabelText(/^password$/i)).toBeNull();
    expect(within(screen.getByRole("status")).getByText(/account connected/i)).toBeTruthy();
  });
});

describe("OnboardingEntryStep product picture", () => {
  it("stays decorative: hidden from assistive technology and inert", () => {
    const { container } = render(<EntryHarness />);
    const picture = container.querySelector(".onb-entry-demo");

    expect(picture?.getAttribute("aria-hidden")).toBe("true");
    expect(picture?.hasAttribute("inert")).toBe(true);
    expect(picture?.querySelector(".dashboard-page-head__title")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /focused for/i })).toBeNull();
  });

  it("shows the finished sample day without running the clock when motion is reduced", () => {
    const frame = vi.spyOn(window, "requestAnimationFrame");
    const { container } = render(<EntryHarness />);
    const title = () => container.querySelector(".dashboard-page-head__title")?.getAttribute("aria-label") ?? "";
    const finished = title();

    act(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });

    expect(finished).toMatch(/^Focused for \d+h \d+m$/);
    expect(title()).toBe(finished);
    expect(frame).not.toHaveBeenCalled();
  });

  it("starts the sample day from an empty morning when motion is allowed", () => {
    mockReducedMotion(false);
    const { container } = render(<EntryHarness />);

    expect(container.querySelector(".dashboard-page-head__title")?.getAttribute("aria-label")).toBe("Focused for 0m");
  });
});
