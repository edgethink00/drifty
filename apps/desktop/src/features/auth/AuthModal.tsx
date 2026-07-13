import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthContext";
import { AUTH_PASSWORD_POLICY, validateAuthPasswordForSignUp } from "./authPasswordPolicy";
import { GoogleMark } from "../onboarding/components/GoogleMark";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";

type AuthMode = "sign-in" | "sign-up";

export function AuthModal({ onClose }: { onClose?: () => void }) {
  const {
    status,
    callbackStatus,
    clearCallbackStatus,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    isEnabled,
  } = useAuth();
  const [authMode, setAuthMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  useModalDismiss(() => onClose?.(), { disabled: !onClose || isSubmitting || isGoogleSubmitting });

  if (!isEnabled) {
    return (
      <div className="auth-modal__overlay">
        <div className="auth-modal">
          {onClose ? <ModalCloseButton label="Close" onClick={onClose} /> : null}
          <div className="modal-head">
            <div className="modal-head__copy">
              <h2>Cloud sync disabled</h2>
              <p>Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const nextEmail = email.trim();
    if (!nextEmail) {
      setError("Enter your email address to continue.");
      return;
    }

    if (!password) {
      setError("Enter your password to continue.");
      return;
    }

    if (authMode === "sign-up") {
      const passwordError = validateAuthPasswordForSignUp(password);
      if (passwordError) {
        setError(passwordError.message);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const result = authMode === "sign-up"
        ? await signUpWithEmail(nextEmail, password)
        : await signInWithEmail(nextEmail, password);
      const { error } = result;
      if (error) {
        setError(error.message);
        return;
      }
      if ("needsEmailConfirmation" in result && result.needsEmailConfirmation) {
        setNotice("Account created. Check your email to confirm your address.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setNotice(null);
    setIsGoogleSubmitting(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        setError(error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start Google sign-in.");
    } finally {
      setIsGoogleSubmitting(false);
    }
  }

  const isSignUp = authMode === "sign-up";
  const submitLabel = isSignUp ? "Create account" : "Sign in";
  const isBusy = isSubmitting || isGoogleSubmitting || status === "loading";

  return (
    <div className="auth-modal__overlay">
      <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        {onClose ? <ModalCloseButton label="Close" onClick={onClose} /> : null}
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="auth-modal-title">{isSignUp ? "Create your account" : "Sign in to Drifty"}</h2>
            <p>{isSignUp ? "Create a drifty account with email and password." : "Use your drifty account to sync and publish."}</p>
          </div>
        </div>

        {error ? (
          <div className="auth-modal__error" role="alert">{error}</div>
        ) : null}

        {notice ? (
          <div className="auth-modal__success" role="status">{notice}</div>
        ) : null}

        {callbackStatus ? (
          callbackStatus.phase === "failed" ? (
            <div className="auth-modal__callback-notice" role="status">
              <span>{callbackStatus.message}</span>
              <button
                type="button"
                className="auth-modal__callback-dismiss"
                onClick={clearCallbackStatus}
                aria-label="Dismiss callback notice"
              >
                Dismiss
              </button>
            </div>
          ) : (
            <div className="auth-modal__success" role="status">
              {callbackStatus.message}
            </div>
          )
        ) : null}

        <form className="auth-modal__form" onSubmit={(event) => void handleEmailSubmit(event)} noValidate>
          <label className="auth-modal__field" htmlFor="auth-email">
            <span>Email</span>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              disabled={isBusy}
              required
            />
          </label>
          <label className="auth-modal__field" htmlFor="auth-password">
            <span>Password</span>
            <input
              id="auth-password"
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              minLength={isSignUp ? AUTH_PASSWORD_POLICY.minLength : undefined}
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              disabled={isBusy}
              required
            />
          </label>
          <button
            type="submit"
            className="modal-btn modal-btn--primary modal-btn--block auth-modal__submit"
            disabled={isBusy}
          >
            {isSubmitting ? (isSignUp ? "Creating…" : "Signing in…") : submitLabel}
          </button>
        </form>

        <p className="auth-modal__mode-switch">
          <span>{isSignUp ? "Have an account?" : "Need an account?"}</span>
          <button
            type="button"
            onClick={() => {
              setAuthMode(isSignUp ? "sign-in" : "sign-up");
              setError(null);
              setNotice(null);
            }}
            disabled={isBusy}
          >
            {isSignUp ? "Sign in" : "Create account"}
          </button>
        </p>

        <div className="auth-modal__separator"><span>or</span></div>

        <button
          type="button"
          className="secondary-button auth-modal__google"
          onClick={() => void handleGoogleSignIn()}
          disabled={isBusy}
        >
          <GoogleMark />
          {isGoogleSubmitting ? "Opening…" : "Continue with Google"}
        </button>

        <div className="auth-modal__footer auth-modal__footer--centered">
          <span>
            By continuing, you accept
            {" "}<a href="https://drifty.so/terms/" target="_blank" rel="noreferrer">Terms</a>
            {" & "}
            <a href="https://drifty.so/privacy/" target="_blank" rel="noreferrer">Privacy</a>.
          </span>
        </div>

      </div>
    </div>
  );
}
