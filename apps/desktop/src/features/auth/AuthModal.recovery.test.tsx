// @vitest-environment jsdom
import { useLayoutEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthCallbackStatus } from "./AuthContext";
import { LocalizationTestProvider } from "../localization/LocalizationContext";

const authState = vi.hoisted(() => ({
  status: "unauthenticated" as "loading" | "authenticated" | "unauthenticated",
  callbackStatus: null as OAuthCallbackStatus | null,
  cloudConnectionStatus: "online" as "disabled" | "checking" | "online" | "offline",
  passwordRecoveryState: { phase: "idle" as "idle" | "email-sent" | "awaiting-new-password" | "completed" | "failed", email: null as string | null },
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

vi.mock("./AuthContext", () => ({
  useAuth: () => authState,
}));

import { AuthModal } from "./AuthModal";

function renderModal(language: "en" | "ko" = "en") {
  return render(
    <LocalizationTestProvider language={language}>
      <AuthModal onClose={vi.fn()} />
    </LocalizationTestProvider>,
  );
}

describe("AuthModal password recovery", () => {
  beforeEach(() => {
    authState.status = "unauthenticated";
    authState.callbackStatus = null;
    authState.cloudConnectionStatus = "online";
    authState.passwordRecoveryState = { phase: "idle", email: null };
    authState.signInWithEmail.mockResolvedValue({ error: null });
    authState.signUpWithEmail.mockResolvedValue({ error: null, needsEmailConfirmation: false });
    authState.requestPasswordReset.mockResolvedValue({ error: null });
    authState.updatePassword.mockResolvedValue({ error: null });
    authState.retryCloudConnection.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("requests a reset link from the sign-in form without revealing account existence", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "person@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => {
      expect(authState.requestPasswordReset).toHaveBeenCalledWith("person@example.com");
    });
    expect(screen.getByRole("status").textContent).toMatch(/if an account exists/i);
  });

  it.each([
    ["Command", { metaKey: true }],
    ["Control", { ctrlKey: true }],
  ])("submits sign-in once with %s+Enter without a visible key chip", async (_name, modifier) => {
    const view = renderModal();
    const email = screen.getByLabelText(/^email$/i);
    const password = screen.getByLabelText(/^password$/i);
    const submit = screen.getByRole("button", { name: "Sign in" });
    expect(view.container.querySelector(".key-hint")).toBeNull();
    expect(submit.getAttribute("aria-keyshortcuts")).toBe("Enter Meta+Enter Control+Enter");
    fireEvent.change(email, { target: { value: "person@example.com" } });
    fireEvent.change(password, { target: { value: "test-password-123" } });

    fireEvent.keyDown(password, { key: "Enter", ...modifier, isComposing: true });
    expect(authState.signInWithEmail).not.toHaveBeenCalled();
    fireEvent.keyDown(password, { key: "Enter", ...modifier });
    await waitFor(() => expect(authState.signInWithEmail).toHaveBeenCalledExactlyOnceWith("person@example.com", "test-password-123"));
    expect(authState.signInWithGoogle).not.toHaveBeenCalled();
    expect(authState.signInWithWebsite).not.toHaveBeenCalled();
  });

  it("keeps validation and blocks shortcut submission while busy or offline", async () => {
    const view = renderModal();
    const email = screen.getByLabelText(/^email$/i);
    fireEvent.keyDown(email, { key: "Enter", metaKey: true });
    expect(screen.getByRole("alert").textContent).toMatch(/enter your email/i);
    expect(authState.signInWithEmail).not.toHaveBeenCalled();

    let finish!: (value: { error: null }) => void;
    authState.signInWithEmail.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.change(email, { target: { value: "person@example.com" } });
    const password = screen.getByLabelText(/^password$/i);
    fireEvent.change(password, { target: { value: "test-password-123" } });
    fireEvent.keyDown(password, { key: "Enter", metaKey: true });
    fireEvent.keyDown(password, { key: "Enter", metaKey: true, repeat: true });
    fireEvent.keyDown(password, { key: "Enter", ctrlKey: true });
    expect(authState.signInWithEmail).toHaveBeenCalledTimes(1);
    finish({ error: null });
    await waitFor(() => expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(false));

    authState.cloudConnectionStatus = "offline";
    view.rerender(<LocalizationTestProvider language="en"><AuthModal onClose={vi.fn()} /></LocalizationTestProvider>);
    fireEvent.keyDown(password, { key: "Enter", metaKey: true });
    expect(authState.signInWithEmail).toHaveBeenCalledTimes(1);
  });

  it("switches the shortcut to the active sign-up and reset-link forms", async () => {
    const view = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "person@example.com" } });
    const password = screen.getByLabelText(/^password$/i);
    fireEvent.change(password, { target: { value: "test-password-123" } });
    fireEvent.keyDown(password, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(authState.signUpWithEmail).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.keyDown(screen.getByLabelText(/^email$/i), { key: "Enter", metaKey: true });
    await waitFor(() => expect(authState.requestPasswordReset).toHaveBeenCalledExactlyOnceWith("person@example.com"));
    expect(authState.signInWithEmail).not.toHaveBeenCalled();
    expect(view.container.querySelector(".key-hint")).toBeNull();
  });

  it("validates matching passwords before shortcut submission in a verified recovery session", async () => {
    authState.passwordRecoveryState = { phase: "awaiting-new-password", email: "person@example.com" };
    renderModal();
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: "test-password-123" } });
    const confirmation = screen.getByLabelText(/confirm new password/i);
    fireEvent.change(confirmation, { target: { value: "different-password-123" } });
    fireEvent.keyDown(confirmation, { key: "Enter", metaKey: true });
    expect(screen.getByRole("alert").textContent).toMatch(/do not match/i);
    expect(authState.updatePassword).not.toHaveBeenCalled();
    fireEvent.change(confirmation, { target: { value: "test-password-123" } });
    fireEvent.keyDown(confirmation, { key: "Enter", metaKey: true });
    await waitFor(() => expect(authState.updatePassword).toHaveBeenCalledExactlyOnceWith("test-password-123"));
  });

  it.each(["inline", "onboarding"] as const)("submits the email form in the %s presentation", async presentation => {
    render(<LocalizationTestProvider language="en"><AuthModal intent="promo" presentation={presentation} onClose={vi.fn()} /></LocalizationTestProvider>);
    if (presentation === "onboarding") fireEvent.click(screen.getByRole("button", { name: /email/i }));
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "person@example.com" } });
    const password = screen.getByLabelText(/^password$/i);
    fireEvent.change(password, { target: { value: "test-password-123" } });
    fireEvent.keyDown(password, { key: "Enter", metaKey: true });
    await waitFor(() => expect(authState.signInWithEmail).toHaveBeenCalledTimes(1));
  });

  it("does not turn a provider button's modifier Enter into an email submission", () => {
    renderModal();
    fireEvent.keyDown(screen.getByRole("button", { name: /continue with google/i }), { key: "Enter", metaKey: true });
    expect(authState.signInWithEmail).not.toHaveBeenCalled();
    expect(authState.signInWithGoogle).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears the prior sign-in password and sent-email notice when the recovery link returns", async () => {
    const committedRecoveryFields: Array<{ value: string; type: string }> = [];
    function ModalWithCommitProbe() {
      useLayoutEffect(() => {
        const input = document.getElementById("auth-new-password") as HTMLInputElement | null;
        if (input) committedRecoveryFields.push({ value: input.value, type: input.type });
      });
      return <LocalizationTestProvider language="en"><AuthModal onClose={vi.fn()} /></LocalizationTestProvider>;
    }
    const view = render(<ModalWithCommitProbe />);
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "old-password-123" } });
    fireEvent.click(screen.getByRole("button", { name: /show password/i }));
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "person@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/if an account exists/i));

    authState.passwordRecoveryState = { phase: "awaiting-new-password", email: "person@example.com" };
    view.rerender(<ModalWithCommitProbe />);

    // Observe the first committed fields before passive cleanup effects run.
    expect(committedRecoveryFields[0]).toEqual({ value: "", type: "password" });
    expect(screen.queryByText(/if an account exists/i)).toBeNull();
    expect((screen.getByLabelText(/^new password$/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/^new password$/i) as HTMLInputElement).type).toBe("password");
    expect((screen.getByLabelText(/confirm new password/i) as HTMLInputElement).value).toBe("");
  });

  it("validates and submits the new password from a verified recovery session", async () => {
    authState.passwordRecoveryState = { phase: "awaiting-new-password", email: "person@example.com" };
    renderModal();
    const dialog = screen.getByRole("dialog", { name: /reset your password/i });
    const newPassword = within(dialog).getByLabelText(/^new password$/i);
    const confirmation = within(dialog).getByLabelText(/confirm new password/i);

    fireEvent.change(newPassword, { target: { value: "new-password-123" } });
    fireEvent.change(confirmation, { target: { value: "different-password-123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save new password/i }));
    expect(within(dialog).getByRole("alert").textContent).toMatch(/do not match/i);
    expect(authState.updatePassword).not.toHaveBeenCalled();

    fireEvent.change(confirmation, { target: { value: "new-password-123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save new password/i }));
    await waitFor(() => expect(authState.updatePassword).toHaveBeenCalledWith("new-password-123"));
  });

  it("localizes secure cancellation failures without exposing an English fallback", () => {
    authState.passwordRecoveryState = { phase: "awaiting-new-password", email: "person@example.com" };
    authState.callbackStatus = { phase: "failed", message: "internal fallback", errorCode: "password-recovery-cancel-failed" };
    renderModal("ko");
    expect(screen.getByRole("alert").textContent).toContain("비밀번호 재설정을 안전하게 취소하지 못했습니다");
    expect(screen.queryByText("internal fallback")).toBeNull();
  });

  it("localizes offline recovery and does not launch a browser provider", async () => {
    authState.cloudConnectionStatus = "offline";
    renderModal("ko");
    const dialog = screen.getByRole("dialog", { name: /drifty에 로그인/i });
    expect(within(dialog).getByRole("alert").textContent).toMatch(/오프라인/);
    expect((within(dialog).getByRole("button", { name: /google로 계속/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: /연결 다시 확인/i }));
    await waitFor(() => expect(authState.retryCloudConnection).toHaveBeenCalledTimes(1));
    expect(authState.signInWithGoogle).not.toHaveBeenCalled();
    expect(authState.signInWithWebsite).not.toHaveBeenCalled();
  });
});
