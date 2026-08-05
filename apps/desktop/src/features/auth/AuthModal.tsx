import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthContext";
import { AUTH_PASSWORD_POLICY, validateAuthPasswordForSignUp } from "./authPasswordPolicy";
import { GoogleMark } from "../onboarding/components/GoogleMark";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useLocalization } from "../localization/LocalizationContext";

type AuthMode = "sign-in" | "sign-up";

export function AuthModal({
  onClose,
  showGoogleSignIn = true,
}: {
  onClose?: () => void;
  showGoogleSignIn?: boolean;
}) {
  const { t } = useLocalization();
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
        <div className="auth-modal modal-shell" data-modal-variant="standard">
          {onClose ? <ModalCloseButton label={t("auth.modal.close")} onClick={onClose} /> : null}
          <div className="modal-head">
            <div className="modal-head__copy">
              <h2>{t("auth.modal.disabledTitle")}</h2>
              <p>{t("auth.modal.disabledDescription")}</p>
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
      setError(t("auth.modal.emailRequired"));
      return;
    }

    if (!password) {
      setError(t("auth.modal.passwordRequired"));
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
        setNotice(t("auth.modal.confirmation"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.modal.unexpectedError"));
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
      setError(err instanceof Error ? err.message : t("auth.modal.googleStartError"));
    } finally {
      setIsGoogleSubmitting(false);
    }
  }

  const isSignUp = authMode === "sign-up";
  const submitLabel = isSignUp ? t("auth.modal.createAccount") : t("auth.modal.signIn");
  const isBusy = isSubmitting || isGoogleSubmitting || status === "loading";

  return (
    <div className="auth-modal__overlay">
      <div className="auth-modal modal-shell" data-modal-variant="standard" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        {onClose ? <ModalCloseButton label={t("auth.modal.close")} onClick={onClose} /> : null}
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="auth-modal-title">{isSignUp ? t("auth.modal.signUpTitle") : t("auth.modal.signInTitle")}</h2>
            <p>{isSignUp ? t("auth.modal.signUpDescription") : t("auth.modal.signInDescription")}</p>
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
                aria-label={t("auth.modal.dismissCallback")}
              >
                {t("auth.modal.dismiss")}
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
            <span>{t("auth.modal.email")}</span>
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
            <span>{t("auth.modal.password")}</span>
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
            {isSubmitting ? (isSignUp ? t("auth.modal.creating") : t("auth.modal.signingIn")) : submitLabel}
          </button>
        </form>

        <p className="auth-modal__mode-switch">
          <span>{isSignUp ? t("auth.modal.haveAccount") : t("auth.modal.needAccount")}</span>
          <button
            type="button"
            onClick={() => {
              setAuthMode(isSignUp ? "sign-in" : "sign-up");
              setError(null);
              setNotice(null);
            }}
            disabled={isBusy}
          >
            {isSignUp ? t("auth.modal.signIn") : t("auth.modal.createAccount")}
          </button>
        </p>

        {showGoogleSignIn ? (
          <>
            <div className="auth-modal__separator"><span>{t("auth.modal.or")}</span></div>

            <button
              type="button"
              className="secondary-button auth-modal__google"
              onClick={() => void handleGoogleSignIn()}
              disabled={isBusy}
            >
              <GoogleMark />
              {isGoogleSubmitting ? t("auth.modal.opening") : t("auth.modal.continueGoogle")}
            </button>
          </>
        ) : null}

        <div className="auth-modal__footer auth-modal__footer--centered">
          <span>
            {t("auth.modal.byContinuing")}
            {" "}<a href="https://drifty.so/terms/" target="_blank" rel="noreferrer">{t("auth.modal.terms")}</a>
            {" & "}
            <a href="https://drifty.so/privacy/" target="_blank" rel="noreferrer">{t("auth.modal.privacy")}</a>.
          </span>
        </div>

      </div>
    </div>
  );
}
