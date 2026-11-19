import { localeCopy } from "../localization/localeCopy";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useModalSubmitShortcut } from "../../lib/useModalSubmitShortcut";
import { capturePostHogEvent } from "../../lib/analytics/posthogClient";
import { useAuth } from "./AuthContext";
import { AUTH_PASSWORD_POLICY, validateAuthPasswordForSignUp } from "./authPasswordPolicy";
import { describeAuthError } from "./authErrorMessages";
import { GoogleMark } from "../onboarding/components/GoogleMark";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useLocalization } from "../localization/LocalizationContext";
import "./AuthModal.css";
import { ActionLabel } from "../../components/ActionLabel";

type AuthMode = "sign-in" | "sign-up";
type AuthView = "credentials" | "forgot-password";
/** The control whose request produced the message; the line renders right under it. */
type AuthFeedbackSource = "email" | "google" | "website" | "recovery" | "reset";
type AuthFeedback = {
  readonly tone: "error" | "notice";
  readonly source: AuthFeedbackSource;
  readonly message: string;
  readonly detail?: string | null;
};

/* The reveal control sits inside the field, so it is drawn rather than
   labelled: a text button there reads as content typed into an empty box, and
   next to the forgot link it produced two identical underlined actions on
   different levels. The accessible name still carries the wording. */
const EYE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EYE_OFF_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c5.18 0 8.77 3.62 9.94 6.35a1 1 0 0 1 0 .7 15.9 15.9 0 0 1-2.4 3.56" />
    <path d="M6.61 6.61A16 16 0 0 0 2.06 11.65a1 1 0 0 0 0 .7C3.23 15.08 6.82 19 12 19a10.9 10.9 0 0 0 5.39-1.39" />
    <path d="m14.12 14.12a3 3 0 0 1-4.24-4.24" />
    <path d="m2 2 20 20" />
  </svg>
);

export function AuthModal({
  onClose,
  showGoogleSignIn = true,
  intent = "default",
  presentation = "modal",
}: {
  onClose?: () => void;
  showGoogleSignIn?: boolean;
  intent?: "default" | "promo";
  /**
   * "modal" is the standard dialog. "onboarding" is the full-window promotion screen.
   * "inline" renders only the email form and its notices inside the onboarding entry screen,
   * which keeps its own product picture beside it; Escape returns to the provider choice.
   */
  presentation?: "modal" | "onboarding" | "inline";
}) {
  const { effectiveLanguage, t } = useLocalization();
  const {
    status,
    callbackStatus,
    clearCallbackStatus,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signInWithWebsite,
    cloudConnectionStatus,
    passwordRecoveryState,
    requestPasswordReset,
    updatePassword,
    cancelPasswordRecovery,
    retryCloudConnection,
    isEnabled,
  } = useAuth();
  const [authMode, setAuthMode] = useState<AuthMode>("sign-in");
  const [authView, setAuthView] = useState<AuthView>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryPasswordVisible, setRecoveryPasswordVisible] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [feedback, setFeedback] = useState<AuthFeedback | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [isWebsiteSubmitting, setIsWebsiteSubmitting] = useState(false);
  const [isRecoverySubmitting, setIsRecoverySubmitting] = useState(false);
  const [isConnectionRetrying, setIsConnectionRetrying] = useState(false);
  const [promoEmailOpen, setPromoEmailOpen] = useState(false);
  const promoOnboardingDialogRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inlineRef = useRef<HTMLElement>(null);
  const emailFormRef = useRef<HTMLFormElement>(null);
  const isRecoveryAwaiting = passwordRecoveryState?.phase === "awaiting-new-password";
  const isRecoveryView = authView === "forgot-password" || isRecoveryAwaiting;
  const isCloudUnavailable = cloudConnectionStatus === "offline" || cloudConnectionStatus === "checking";
  const requestPending = isSubmitting || isGoogleSubmitting || isWebsiteSubmitting || isRecoverySubmitting;
  const isBusy = requestPending || status === "loading";
  const credentialsDisabled = presentation === "inline" && !isRecoveryView
    ? requestPending
    : isBusy || isCloudUnavailable;
  // Auth forms keep their uncluttered button design while using the same
  // explicit submit chord as other forms. requestSubmit preserves validation
  // and the active form's handler; plain Enter stays with native submission.
  useModalSubmitShortcut(emailFormRef, "modEnter", () => emailFormRef.current?.requestSubmit(), {
    disabled: !isEnabled || isBusy || isCloudUnavailable,
  });
  useEffect(() => {
    if (!isRecoveryAwaiting) return;
    setFeedback(null);
    setPassword("");
    setConfirmPassword("");
    setPasswordVisible(false);
    setRecoveryPassword("");
    setRecoveryPasswordVisible(false);
  }, [isRecoveryAwaiting]);
  const requestClose = () => {
    if (isRecoveryAwaiting) void cancelPasswordRecovery?.();
    onClose?.();
  };
  useModalDismiss(requestClose, { disabled: !onClose || isSubmitting || isGoogleSubmitting || isWebsiteSubmitting || isRecoverySubmitting });
  useModalFocusTrap(promoOnboardingDialogRef, { initialFocusSelector: ".dc-onb-account__google" });
  // A failure line under the pressed button grows the dialog downward only.
  useAnchoredDialog(dialogRef);
  const fail = (source: AuthFeedbackSource, message: string, detail: string | null = null) => {
    setFeedback({ tone: "error", source, message, detail });
  };
  useEffect(() => {
    if (presentation !== "inline") return;
    inlineRef.current?.querySelector<HTMLInputElement>("input:not([disabled])")?.focus();
  }, [presentation]);

  if (!isEnabled) {
    if (presentation === "inline") {
      return (
        <section ref={inlineRef} className="auth-inline" aria-labelledby="auth-inline-title" data-auth-presentation="inline">
          <h2 id="auth-inline-title" className="auth-inline__title">{t("auth.modal.disabledTitle")}</h2>
          <p className="auth-inline__description">{t("auth.modal.disabledDescription")}</p>
        </section>
      );
    }
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
    if (isBusy || isCloudUnavailable || !isEnabled) return;
    setFeedback(null);

    const nextEmail = email.trim();
    if (!nextEmail) {
      fail("email", t("auth.modal.emailRequired"));
      return;
    }

    if (!password) {
      fail("email", t("auth.modal.passwordRequired"));
      return;
    }

    if (authMode === "sign-up") {
      const passwordError = validateAuthPasswordForSignUp(password);
      if (passwordError) {
        fail("email", t("auth.modal.error.weakPassword", { count: AUTH_PASSWORD_POLICY.minLength }));
        return;
      }
    }

    if (presentation === "inline") capturePostHogEvent("onboarding_entry_action", { action: "email_submitted" });
    setIsSubmitting(true);
    const emailFallback = t(authMode === "sign-up" ? "auth.modal.error.signUpFailed" : "auth.modal.error.signInFailed");
    try {
      const result = authMode === "sign-up"
        ? await signUpWithEmail(nextEmail, password)
        : await signInWithEmail(nextEmail, password);
      const { error } = result;
      if (error) {
        const described = describeAuthError(error, t, emailFallback);
        fail("email", described.message, described.detail);
        return;
      }
      if ("needsEmailConfirmation" in result && result.needsEmailConfirmation) {
        setFeedback({ tone: "notice", source: "email", message: t("auth.modal.confirmation") });
      }
    } catch (err) {
      const described = describeAuthError(err, t, emailFallback);
      fail("email", described.message, described.detail);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setFeedback(null);
    setIsGoogleSubmitting(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        const described = describeAuthError(error, t, t("auth.modal.googleStartError"));
        fail("google", described.message, described.detail);
      }
    } catch (err) {
      const described = describeAuthError(err, t, t("auth.modal.googleStartError"));
      fail("google", described.message, described.detail);
    } finally {
      setIsGoogleSubmitting(false);
    }
  }

  async function handleWebsiteSignIn() {
    setFeedback(null);
    setIsWebsiteSubmitting(true);
    try {
      const { error } = await signInWithWebsite();
      if (error) {
        const described = describeAuthError(error, t, t("auth.modal.unexpectedError"));
        fail("website", described.message, described.detail);
      }
    } catch (err) {
      const described = describeAuthError(err, t, t("auth.modal.unexpectedError"));
      fail("website", described.message, described.detail);
    } finally {
      setIsWebsiteSubmitting(false);
    }
  }

  async function handlePasswordRecoveryRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const nextEmail = email.trim();
    if (!nextEmail) {
      fail("recovery", t("auth.modal.emailRequired"));
      return;
    }
    if (!requestPasswordReset) {
      fail("recovery", t("auth.modal.recoverySendError"));
      return;
    }

    setIsRecoverySubmitting(true);
    try {
      const { error: recoveryError } = await requestPasswordReset(nextEmail);
      if (recoveryError) {
        fail("recovery", t("auth.modal.recoverySendError"));
        return;
      }
      setFeedback({ tone: "notice", source: "recovery", message: t("auth.modal.recoveryEmailSent") });
    } catch {
      fail("recovery", t("auth.modal.recoverySendError"));
    } finally {
      setIsRecoverySubmitting(false);
    }
  }

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (!recoveryPassword) {
      fail("reset", t("auth.modal.passwordRequired"));
      return;
    }
    if (!confirmPassword) {
      fail("reset", t("auth.modal.confirmPasswordRequired"));
      return;
    }
    if (recoveryPassword !== confirmPassword) {
      fail("reset", t("auth.modal.passwordMismatch"));
      return;
    }
    const passwordError = validateAuthPasswordForSignUp(recoveryPassword);
    if (passwordError) {
      fail("reset", t("auth.modal.error.weakPassword", { count: AUTH_PASSWORD_POLICY.minLength }));
      return;
    }
    if (!updatePassword) {
      fail("reset", t("auth.modal.resetPasswordError"));
      return;
    }

    setIsRecoverySubmitting(true);
    try {
      const { error: updateError } = await updatePassword(recoveryPassword);
      if (updateError) {
        fail("reset", t("auth.modal.resetPasswordError"));
      }
    } catch {
      fail("reset", t("auth.modal.resetPasswordError"));
    } finally {
      setIsRecoverySubmitting(false);
    }
  }

  async function handleConnectionRetry() {
    setFeedback(null);
    setIsConnectionRetrying(true);
    try {
      await retryCloudConnection?.();
    } finally {
      setIsConnectionRetrying(false);
    }
  }

  const isSignUp = authMode === "sign-up";
  const submitLabel = isSignUp ? t("auth.modal.createAccount") : t("auth.modal.signIn");
  const isGoogleCallbackBusy = callbackStatus?.googleAction === "opening"
    || callbackStatus?.phase === "received"
    || callbackStatus?.phase === "exchanging"
    || callbackStatus?.phase === "completed";
  // While the OAuth handoff is in flight the button carries the progress
  // itself; the notice is kept for failures only, so a normal sign-in never
  // pushes the form down.
  const isGoogleHandoffInFlight = isGoogleSubmitting
    || callbackStatus?.googleAction === "opening"
    || callbackStatus?.phase === "received"
    || callbackStatus?.phase === "exchanging";
  const googleButtonLabel = isGoogleHandoffInFlight
    ? t("auth.modal.opening")
    : callbackStatus?.googleAction === "reopen"
      ? t("auth.modal.reopenGoogle")
      : callbackStatus?.googleAction === "retry"
        ? t("auth.modal.retryGoogle")
        : t("auth.modal.continueGoogle");
  const title = isRecoveryView
    ? t("auth.modal.recoveryTitle")
    : intent === "promo"
    ? t("auth.modal.promoTitle")
    : isSignUp ? t("auth.modal.signUpTitle") : t("auth.modal.signInTitle");
  const description = isRecoveryView
    ? null
    : intent === "promo"
    ? t("auth.modal.promoDescription")
    : isSignUp ? t("auth.modal.signUpDescription") : null;

  const activeFormSource: AuthFeedbackSource = isRecoveryAwaiting ? "reset" : authView === "forgot-password" ? "recovery" : "email";
  const recoveryStateMessage = passwordRecoveryState?.errorKind === "identity-mismatch"
    ? t("auth.modal.recoveryIdentityMismatch")
    : isRecoveryView && callbackStatus?.errorCode === "password-recovery-cancel-failed"
      ? t("auth.modal.recoveryCancelCleanupError")
      : null;
  const displayedFeedback: AuthFeedback | null = recoveryStateMessage
    ? { tone: "error", source: activeFormSource, message: recoveryStateMessage }
    : feedback && !(feedback.tone === "notice" && isRecoveryAwaiting) ? feedback : null;
  // Results read beside the button that asked for them, so nothing above that
  // button moves when a request settles.
  const feedbackLine = (source: AuthFeedbackSource) => {
    if (displayedFeedback?.source !== source) return null;
    const { tone, message, detail } = displayedFeedback;
    return (
      <p
        className={`auth-modal__feedback auth-modal__feedback--${tone}`}
        role={tone === "error" ? "alert" : "status"}
        title={detail ?? undefined}
      >
        {message}
        {detail ? <span className="sr-only"> {detail}</span> : null}
      </p>
    );
  };
  const callbackNotice = callbackStatus?.phase === "failed" ? (
    <div className="auth-modal__callback-notice" role="status">
      <span>{callbackStatus.errorCode === "password-recovery-cancel-failed"
        ? t("auth.modal.recoveryCancelCleanupError")
        : callbackStatus.message}</span>
      <button
        type="button"
        className="auth-modal__callback-dismiss"
        onClick={clearCallbackStatus}
        aria-label={t("auth.modal.dismissCallback")}
      >
        {t("auth.modal.dismiss")}
      </button>
    </div>
  ) : null;
  const activePasswordVisible = isRecoveryAwaiting ? recoveryPasswordVisible : passwordVisible;
  const passwordToggleLabel = activePasswordVisible
    ? t("auth.modal.hidePassword")
    : t("auth.modal.showPassword");
  const passwordInput = ({
    id,
    label,
    value,
    onChange,
    autoComplete,
  }: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    autoComplete: "current-password" | "new-password";
  }) => (
    <div className="auth-modal__field">
      <span id={`${id}-label`}>{label}</span>
      <div className="auth-modal__password-control">
        <input
          id={id}
          type={activePasswordVisible ? "text" : "password"}
          aria-labelledby={`${id}-label`}
          autoComplete={autoComplete}
          minLength={autoComplete === "new-password" ? AUTH_PASSWORD_POLICY.minLength : undefined}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          disabled={credentialsDisabled}
          required
        />
        <button
          type="button"
          className="auth-modal__password-toggle"
          aria-label={passwordToggleLabel}
          aria-pressed={activePasswordVisible}
          onClick={() => {
            if (isRecoveryAwaiting) setRecoveryPasswordVisible((visible) => !visible);
            else setPasswordVisible((visible) => !visible);
          }}
          disabled={isBusy}
        >
          {activePasswordVisible ? EYE_OFF_ICON : EYE_ICON}
        </button>
      </div>
    </div>
  );
  const offlineNotice = cloudConnectionStatus === "offline" ? (
    <div className="auth-modal__offline" role="alert">
      <strong>{t("auth.modal.offlineTitle")}</strong>
      <span>{t("auth.modal.offlineDescription")}</span>
      <button
        type="button"
        className="auth-modal__connection-retry"
        onClick={() => void handleConnectionRetry()}
        disabled={isConnectionRetrying}
        aria-busy={isConnectionRetrying}
      >
        <ActionLabel busy={isConnectionRetrying} busyLabel={t("auth.modal.checkingConnection")}>{t("auth.modal.retryConnection")}</ActionLabel>
      </button>
    </div>
  ) : null;
  const emailAuthForm = (
    <>
      <form ref={emailFormRef} className="auth-modal__form" onSubmit={(event) => void handleEmailSubmit(event)} noValidate>
        <label className="auth-modal__field" htmlFor="auth-email">
          <span>{t("auth.modal.email")}</span>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            disabled={credentialsDisabled}
            required
          />
        </label>
        {passwordInput({
          id: "auth-password",
          label: t("auth.modal.password"),
          value: password,
          onChange: setPassword,
          autoComplete: isSignUp ? "new-password" : "current-password",
        })}
        {!isSignUp ? (
          <div className="auth-modal__forgot-row">
            <button
              type="button"
              className="auth-modal__text-action"
              onClick={() => {
                setAuthView("forgot-password");
                setFeedback(null);
              }}
              disabled={isBusy}
            >
              {t("auth.modal.forgotPassword")}
            </button>
          </div>
        ) : null}
        <button
          type="submit"
          className="modal-btn modal-btn--primary modal-btn--block auth-modal__submit"
          disabled={isBusy || isCloudUnavailable}
          aria-busy={isSubmitting || undefined}
          aria-keyshortcuts="Enter Meta+Enter Control+Enter"
        >
          <ActionLabel busy={isSubmitting} busyLabel={isSignUp ? t("auth.modal.creating") : t("auth.modal.signingIn")}>{presentation === "inline" && cloudConnectionStatus === "checking" ? t("auth.modal.checkingConnection") : submitLabel}</ActionLabel>
        </button>
        {feedbackLine("email")}
      </form>

      <p className="auth-modal__mode-switch">
        <span>{isSignUp ? t("auth.modal.haveAccount") : t("auth.modal.needAccount")}</span>
        <button
          type="button"
          onClick={() => {
            setAuthMode(isSignUp ? "sign-in" : "sign-up");
            setFeedback(null);
          }}
          disabled={isBusy}
        >
          {isSignUp ? t("auth.modal.signIn") : t("auth.modal.createAccount")}
        </button>
      </p>
    </>
  );
  const passwordRecoveryRequestForm = (
    <>
      <p className="auth-modal__recovery-copy">{t("auth.modal.recoveryDescription")}</p>
      <form ref={emailFormRef} className="auth-modal__form" onSubmit={(event) => void handlePasswordRecoveryRequest(event)} noValidate>
        <label className="auth-modal__field" htmlFor="auth-recovery-email">
          <span>{t("auth.modal.email")}</span>
          <input
            id="auth-recovery-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            disabled={isBusy || isCloudUnavailable}
            required
          />
        </label>
        <button
          type="submit"
          className="modal-btn modal-btn--primary modal-btn--block auth-modal__submit"
          disabled={isBusy || isCloudUnavailable}
          aria-busy={isRecoverySubmitting || undefined}
          aria-keyshortcuts="Enter Meta+Enter Control+Enter"
        >
          <ActionLabel busy={isRecoverySubmitting} busyLabel={t("auth.modal.recoverySending")}>{t("auth.modal.recoverySend")}</ActionLabel>
        </button>
        {feedbackLine("recovery")}
      </form>
      <p className="auth-modal__mode-switch">
        <button
          type="button"
          onClick={() => {
            setAuthView("credentials");
            setFeedback(null);
          }}
          disabled={isBusy}
        >
          {t("auth.modal.backToSignIn")}
        </button>
      </p>
    </>
  );
  const passwordResetForm = (
    <form ref={emailFormRef} className="auth-modal__form" onSubmit={(event) => void handlePasswordUpdate(event)} noValidate>
      {passwordInput({
        id: "auth-new-password",
        label: t("auth.modal.newPassword"),
        value: recoveryPassword,
        onChange: setRecoveryPassword,
        autoComplete: "new-password",
      })}
      {passwordInput({
        id: "auth-confirm-password",
        label: t("auth.modal.confirmPassword"),
        value: confirmPassword,
        onChange: setConfirmPassword,
        autoComplete: "new-password",
      })}
      <button
        type="submit"
        className="modal-btn modal-btn--primary modal-btn--block auth-modal__submit"
        disabled={isBusy || isCloudUnavailable}
        aria-busy={isRecoverySubmitting || undefined}
        aria-keyshortcuts="Enter Meta+Enter Control+Enter"
      >
        <ActionLabel busy={isRecoverySubmitting} busyLabel={t("auth.modal.resettingPassword")}>{t("auth.modal.resetPassword")}</ActionLabel>
      </button>
      {feedbackLine("reset")}
    </form>
  );
  const activeEmailForm = isRecoveryAwaiting
    ? passwordResetForm
    : authView === "forgot-password"
      ? passwordRecoveryRequestForm
      : emailAuthForm;
  const legal = (
    <span>
      {t("auth.modal.byContinuing")}
      {" "}<a href="https://drifty.so/terms/" target="_blank" rel="noreferrer">{t("auth.modal.terms")}</a>
      {!["en", "ko", "es"].includes(effectiveLanguage) ? ` ${localeCopy(effectiveLanguage, "and")} ` : effectiveLanguage === "es" ? " y " : " & "}
      <a href="https://drifty.so/privacy/" target="_blank" rel="noreferrer">{t("auth.modal.privacy")}</a>.
    </span>
  );
  if (presentation === "inline") {
    return (
      <section ref={inlineRef} className="auth-inline" aria-labelledby="auth-inline-title" data-auth-presentation="inline">
        <h2 id="auth-inline-title" className="auth-inline__title">{title}</h2>
        {description ? <p className="auth-inline__description">{description}</p> : null}
        {isRecoveryView ? null : callbackNotice}
        {offlineNotice}
        {activeEmailForm}
        <p className="auth-inline__legal">{legal}</p>
      </section>
    );
  }

  if (presentation === "onboarding" && intent === "promo") {
    return (
      <section
        ref={promoOnboardingDialogRef}
        className="onboarding-screen dc-onboarding-screen promo-auth-screen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="promo-auth-title"
        data-auth-presentation="onboarding"
        tabIndex={-1}
      >
        <div className="onboarding-window-drag-strip" data-tauri-drag-region aria-hidden="true" />
        <div className="onboarding-content-area">
          <div className="onboarding-card dc-onb-card">
            <div className="dc-onb-scroll">
              <div className="dc-onb-content dc-onb-content--account">
                <div className="dc-onb-account promo-auth-screen__account">
                  <h1 className="dc-onb-account__title" id="promo-auth-title">{title}</h1>
                  <p className="dc-onb-account__copy">{description}</p>

                  {isRecoveryView ? null : callbackNotice}
                  {offlineNotice}

                  {!isRecoveryView ? <div className="dc-onb-account__buttons">
                    <button
                      type="button"
                      className="dc-onb-account__google"
                      onClick={() => void handleWebsiteSignIn()}
                      disabled={isBusy || isGoogleCallbackBusy || isCloudUnavailable}
                    >
                      {isWebsiteSubmitting ? t("auth.modal.opening") : t("auth.modal.promoContinueBrowser")}
                    </button>
                    {feedbackLine("website")}
                    <p className="promo-auth-screen__browser-hint">{t("auth.modal.promoContinueBrowserHint")}</p>

                    <div className="dc-onb-divider" aria-hidden="true">
                      <span />{t("onboarding.account.or")}<span />
                    </div>

                    {showGoogleSignIn ? (
                      <button
                        type="button"
                        className="dc-onb-account__email promo-auth-screen__provider"
                        onClick={() => void handleGoogleSignIn()}
                        disabled={isBusy || isGoogleCallbackBusy || isCloudUnavailable}
                      >
                        {isGoogleHandoffInFlight ? <span className="dc-onb-spinner" aria-hidden="true" /> : <GoogleMark />}
                        {googleButtonLabel}
                      </button>
                    ) : null}
                    {feedbackLine("google")}

                    <button
                      type="button"
                      className="dc-onb-account__email"
                      aria-expanded={promoEmailOpen}
                      aria-controls="promo-auth-email-form"
                      onClick={() => setPromoEmailOpen((open) => !open)}
                      disabled={isBusy || isCloudUnavailable}
                    >
                      {t("onboarding.account.email")}
                    </button>
                  </div> : null}

                  {isRecoveryView || promoEmailOpen ? (
                    <div className="promo-auth-screen__email-form" id="promo-auth-email-form">
                      {activeEmailForm}
                    </div>
                  ) : null}

                  {onClose ? (
                    <button className="promo-auth-screen__later" type="button" onClick={requestClose} disabled={isBusy}>
                      {t("auth.modal.promoLater")}
                    </button>
                  ) : null}
                  <p className="dc-onb-account__helper">{t("onboarding.account.helper")}</p>
                  <p className="dc-onb-account__legal">
                    {t("onboarding.account.legalPrefix")}{" "}
                    <a href="https://drifty.so/terms/" target="_blank" rel="noreferrer">{t("onboarding.account.terms")}</a>{" "}
                    {!["en", "ko", "es"].includes(effectiveLanguage) ? localeCopy(effectiveLanguage, "and") : effectiveLanguage === "es" ? "y" : "&"} <a href="https://drifty.so/privacy/" target="_blank" rel="noreferrer">{t("onboarding.account.privacy")}</a>.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="auth-modal__overlay">
      <div ref={dialogRef} className="auth-modal modal-shell" data-modal-variant="standard" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        {onClose ? <ModalCloseButton label={t("auth.modal.close")} onClick={requestClose} /> : null}
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="auth-modal-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
        </div>

        {isRecoveryView ? null : callbackNotice}
        {offlineNotice}

        {intent === "promo" && !isRecoveryView ? (
          <>
            <button
              type="button"
              className="modal-btn modal-btn--primary modal-btn--block"
              onClick={() => void handleWebsiteSignIn()}
              disabled={isBusy || isGoogleCallbackBusy || isCloudUnavailable}
            >
              {isWebsiteSubmitting ? t("auth.modal.opening") : t("auth.modal.promoContinueBrowser")}
            </button>
            {feedbackLine("website")}
            <p className="auth-modal__mode-switch auth-modal__promo-browser-hint">
              <span>{t("auth.modal.promoContinueBrowserHint")}</span>
            </p>
            <div className="auth-modal__separator"><span>{t("auth.modal.or")}</span></div>
          </>
        ) : null}

        {activeEmailForm}

        {showGoogleSignIn && !isRecoveryView ? (
          <>
            <div className="auth-modal__separator"><span>{t("auth.modal.or")}</span></div>

            <button
              type="button"
              className="modal-btn modal-btn--secondary modal-btn--block auth-modal__google"
              onClick={() => void handleGoogleSignIn()}
              disabled={isBusy || isGoogleCallbackBusy || isCloudUnavailable}
            >
              {isGoogleHandoffInFlight ? <span className="dc-onb-spinner" aria-hidden="true" /> : <GoogleMark />}
              {googleButtonLabel}
            </button>
            {feedbackLine("google")}
          </>
        ) : null}

        <div className="auth-modal__footer auth-modal__footer--centered">{legal}</div>

      </div>
    </div>
  );
}
