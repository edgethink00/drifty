import { useState } from "react";
import { useAuth } from "./AuthContext";

export function AuthModal({ onClose }: { onClose?: () => void }) {
  const { status, callbackStatus, clearCallbackStatus, signInWithWebsite, isEnabled } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isEnabled) {
    return (
      <div className="auth-modal__overlay">
        <div className="auth-modal">
          <div className="auth-modal__header">
            <h2>Cloud sync disabled</h2>
            <p>Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment.</p>
          </div>
          {onClose ? (
            <button className="secondary-button" onClick={onClose}>Close</button>
          ) : null}
        </div>
      </div>
    );
  }

  async function handleWebsiteSignIn() {
    setError(null);
    setIsSubmitting(true);
    try {
      const { error } = await signInWithWebsite();
      if (error) {
        setError(error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-modal__overlay">
      <div className="auth-modal">
        <div className="auth-modal__header">
          <h2>Sign in to Drifty</h2>
          <p>Use drifty.so to sign in or create an account. We'll bring you back here when you're done.</p>
        </div>

        {error ? (
          <div className="auth-modal__error">{error}</div>
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

        <button
          type="button"
          className="secondary-button auth-modal__submit"
          onClick={() => void handleWebsiteSignIn()}
          disabled={isSubmitting || status === "loading"}
        >
          {isSubmitting ? "Opening…" : "Continue on drifty.so"}
        </button>

        <div className="auth-modal__footer auth-modal__footer--centered">
          <span>
            By continuing, you accept
            {" "}<a href="https://drifty.so/terms/" target="_blank" rel="noreferrer">Terms</a>
            {" & "}
            <a href="https://drifty.so/privacy/" target="_blank" rel="noreferrer">Privacy</a>.
          </span>
        </div>

        {onClose ? (
          <button
            type="button"
            className="ghost-button auth-modal__close"
            onClick={onClose}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
