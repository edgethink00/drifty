// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { classifyAuthError, describeAuthError } from "./authErrorMessages";

const authState = vi.hoisted(() => ({
  status: "unauthenticated" as const,
  callbackStatus: null,
  cloudConnectionStatus: "online" as const,
  passwordRecoveryState: { phase: "idle" as const, email: null },
  clearCallbackStatus: vi.fn(),
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn().mockResolvedValue({ error: null, needsEmailConfirmation: false }),
  signInWithGoogle: vi.fn().mockResolvedValue({ error: null }),
  signInWithWebsite: vi.fn().mockResolvedValue({ error: null }),
  requestPasswordReset: vi.fn().mockResolvedValue({ error: null }),
  updatePassword: vi.fn().mockResolvedValue({ error: null }),
  cancelPasswordRecovery: vi.fn().mockResolvedValue(undefined),
  retryCloudConnection: vi.fn().mockResolvedValue({ error: null }),
  isEnabled: true,
}));

vi.mock("./AuthContext", () => ({
  useAuth: () => authState,
}));

import { AuthModal } from "./AuthModal";

const t = (key: string, params?: Record<string, string | number>) => key + (params ? JSON.stringify(params) : "");

describe("classifyAuthError", () => {
  it("recognizes the failures a person can act on", () => {
    expect(classifyAuthError(Object.assign(new Error("Invalid login credentials"), { status: 400 }))).toBe("invalidCredentials");
    expect(classifyAuthError(Object.assign(new Error("whatever"), { code: "email_not_confirmed" }))).toBe("emailNotConfirmed");
    expect(classifyAuthError(new Error("User already registered"))).toBe("userExists");
    expect(classifyAuthError(Object.assign(new Error("slow down"), { status: 429 }))).toBe("rateLimited");
    expect(classifyAuthError(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyAuthError(Object.assign(new Error("x"), { name: "AuthRetryableFetchError" }))).toBe("network");
    expect(classifyAuthError(new Error("Drifty is offline. Connect to the internet and try again."))).toBe("network");
    expect(classifyAuthError(new Error("Supabase is not configured"))).toBe("unavailable");
    expect(classifyAuthError(new Error("Google sign-in expired after 5 minutes. Try again."))).toBe("expired");
    expect(classifyAuthError(new Error("Database error saving new user"))).toBeNull();
  });

  it("keeps an unrecognized message as detail behind a translated line", () => {
    expect(describeAuthError(new Error("Database error saving new user"), t as never, "fallback")).toEqual({
      message: "fallback",
      detail: "Database error saving new user",
    });
    expect(describeAuthError(new TypeError("Failed to fetch"), t as never, "fallback")).toEqual({
      message: "auth.modal.error.network",
      detail: null,
    });
  });
});

describe("AuthModal sign-in failure", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("reads a translated failure directly under the sign-in button", async () => {
    authState.signInWithEmail.mockResolvedValue({ error: Object.assign(new Error("Invalid login credentials"), { status: 400 }) });
    render(
      <LocalizationTestProvider language="ko">
        <AuthModal onClose={vi.fn()} />
      </LocalizationTestProvider>,
    );
    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "person@example.com" } });
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "wrong-password-1" } });
    const submit = screen.getByRole("button", { name: "로그인" });
    fireEvent.click(submit);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("이메일 또는 비밀번호가 맞지 않아요.");
    // The line belongs to the button that sent the request; nothing is inserted above the form.
    expect(submit.nextElementSibling).toBe(alert);
    await waitFor(() => expect(authState.signInWithEmail).toHaveBeenCalledTimes(1));
  });
});

