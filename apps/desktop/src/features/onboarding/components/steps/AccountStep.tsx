import { localeCopy } from "../../../localization/localeCopy";
import { useState } from "react";
import type { OAuthCallbackStatus } from "../../../auth/AuthContext";
import { useAuthConnectionStatus } from "../../../auth/AuthContext";
import { GoogleMark } from "../GoogleMark";
import { SpinnerIcon, SuccessIcon } from "./shared";
import { useLocalization } from "../../../localization/LocalizationContext";
import { formatBillingAccessEndDate } from "../../../billing/billingAccessCopy";
import type { OnboardingAccountAccessState } from "../../accountAccessState";

/**
 * The sign-in half of the onboarding entry screen: provider buttons, the connected state and
 * its Continue, connection recovery and the legal line. The screen's headline and product
 * picture live in OnboardingEntryStep.
 */
export function AccountStep({
  accountConnected,
  accountAccessState,
  awaitsContinue,
  expectsPromotion,
  promotionActive,
  promotionEndsAt,
  authCallbackStatus,
  devAuthSkipEnabled,
  onSkipAuthForDev,
  onContinue,
  onOpenEmail,
  onStartCloudTrialWithGoogle,
  onStartCloudTrialWithWebsite,
  onDeleteAnonymousAccount,
  cloudConnectionStatusOverride,
  onRetryCloudConnection,
}: {
  readonly accountConnected: boolean;
  readonly accountAccessState: OnboardingAccountAccessState;
  /** Sign-in is settled and the screen waits for the person to move on. */
  readonly awaitsContinue: boolean;
  readonly expectsPromotion: boolean;
  readonly promotionActive: boolean;
  readonly promotionEndsAt: string | null;
  readonly authCallbackStatus: OAuthCallbackStatus | null;
  readonly devAuthSkipEnabled: boolean;
  readonly onSkipAuthForDev: () => void;
  readonly onContinue: () => void;
  readonly onOpenEmail: () => void;
  readonly onStartCloudTrialWithGoogle: () => void;
  readonly onStartCloudTrialWithWebsite?: () => void;
  readonly onDeleteAnonymousAccount?: () => void;
  readonly cloudConnectionStatusOverride?: "disabled" | "checking" | "online" | "offline";
  readonly onRetryCloudConnection?: () => Promise<{ error: Error | null }>;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const authConnection = useAuthConnectionStatus();
  const cloudConnectionStatus = cloudConnectionStatusOverride ?? authConnection.cloudConnectionStatus;
  const retryCloudConnection = onRetryCloudConnection ?? authConnection.retryCloudConnection;
  const [isConnectionRetrying, setIsConnectionRetrying] = useState(false);
  const isCloudUnavailable = cloudConnectionStatus === "offline" || cloudConnectionStatus === "checking";
  const promotionEndLabel = formatBillingAccessEndDate(promotionEndsAt, effectiveLanguage);
  const isGoogleHandoffBusy = authCallbackStatus?.googleAction === "opening"
    || authCallbackStatus?.phase === "received"
    || authCallbackStatus?.phase === "exchanging"
    || authCallbackStatus?.phase === "completed";
  // Progress lives inside the button (spinner + label) so the layout never
  // shifts; the notice box below the buttons is reserved for failures, where
  // the message carries a recovery action.
  const isGoogleOpening = authCallbackStatus?.googleAction === "opening"
    || authCallbackStatus?.phase === "received"
    || authCallbackStatus?.phase === "exchanging";
  const googleButtonLabel = isGoogleOpening
    ? t("onboarding.account.opening")
    : authCallbackStatus?.googleAction === "reopen"
      ? t("onboarding.account.reopenGoogle")
      : authCallbackStatus?.googleAction === "retry"
        ? t("onboarding.account.retryGoogle")
        : t("onboarding.account.google");
  const showCallbackNotice = authCallbackStatus?.phase === "failed";
  const showPromoEntry = expectsPromotion && !accountConnected && onStartCloudTrialWithWebsite !== undefined;
  const showCheckingState = accountAccessState === "checking";
  const showDeferredState = accountAccessState === "verification-deferred";
  const signInSettled = accountConnected || awaitsContinue;
  return (
    <div className="dc-onb-account onb-entry-account">
      {signInSettled ? (
        <div className="onb-entry-account__settled">
          {accountConnected ? (
            <div
              className={`dc-onb-account__connected${showCheckingState || showDeferredState ? " dc-onb-account__connected--neutral" : ""}`}
              role="status"
              aria-live="polite"
              aria-busy={showCheckingState}
            >
              {showCheckingState ? <SpinnerIcon /> : showDeferredState ? null : <SuccessIcon />}
              <span>
                {showCheckingState
                  ? t("onboarding.account.checkingAccess")
                  : showDeferredState
                    ? t("onboarding.account.verificationDeferred")
                    : promotionActive
                      ? t("onboarding.account.promoConnectedStatus")
                      : t("onboarding.ready.accountConnected")}
              </span>
            </div>
          ) : null}
          {promotionActive && promotionEndLabel ? (
            <p className="onb-entry-account__note">
              {t("onboarding.promo.activeThrough", { date: promotionEndLabel })}
            </p>
          ) : null}
          {awaitsContinue ? (
            <button type="button" className="dc-onb-account__google onb-entry-account__continue" onClick={onContinue}>
              {t("common.continue")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="dc-onb-account__buttons">
          {cloudConnectionStatus === "offline" ? (
            <div className="dc-onb-account__offline" role="alert">
              <span>{t("onboarding.account.offlineDescription")}</span>
              <button
                type="button"
                onClick={() => {
                  setIsConnectionRetrying(true);
                  void (retryCloudConnection?.() ?? Promise.resolve({ error: null }))
                    .finally(() => setIsConnectionRetrying(false));
                }}
                disabled={isConnectionRetrying}
              >
                {isConnectionRetrying
                  ? t("onboarding.account.checkingConnection")
                  : t("onboarding.account.retryConnection")}
              </button>
            </div>
          ) : null}
          {showPromoEntry ? (
            <>
              <button
                type="button"
                className="dc-onb-account__google"
                onClick={onStartCloudTrialWithWebsite}
                disabled={isCloudUnavailable}
              >
                {t("auth.modal.promoContinueBrowser")}
              </button>
              <p className="promo-auth-screen__browser-hint">
                {t("auth.modal.promoContinueBrowserHint")}
              </p>
              <div className="dc-onb-divider" aria-hidden="true">
                <span />
                {t("onboarding.account.or")}
                <span />
              </div>
              <button
                type="button"
                className="dc-onb-account__email promo-auth-screen__provider"
                onClick={onStartCloudTrialWithGoogle}
                disabled={isGoogleHandoffBusy || isCloudUnavailable}
              >
                {isGoogleOpening ? <SpinnerIcon /> : <GoogleMark />}
                <span>{googleButtonLabel}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="dc-onb-account__google"
              onClick={onStartCloudTrialWithGoogle}
              disabled={isGoogleHandoffBusy || isCloudUnavailable}
            >
              {isGoogleOpening ? <SpinnerIcon /> : <GoogleMark />}
              <span>{googleButtonLabel}</span>
            </button>
          )}
          <button
            type="button"
            className="dc-onb-account__email"
            onClick={onOpenEmail}
            disabled={isCloudUnavailable}
          >
            {t("onboarding.account.email")}
          </button>
        </div>
      )}
      {!accountConnected && showCallbackNotice && authCallbackStatus ? (
        <div className="dc-onb-account__callback dc-onb-account__callback--failed" role="alert">
          {authCallbackStatus.message}
        </div>
      ) : null}
      {!accountConnected && onDeleteAnonymousAccount ? (
        <div className="dc-onb-account__delete-guest">
          <button type="button" onClick={onDeleteAnonymousAccount}>
            {t("onboarding.account.deleteGuest")}
          </button>
          <p>{t("onboarding.account.deleteGuestHelper")}</p>
        </div>
      ) : null}
      {!signInSettled && devAuthSkipEnabled ? (
        <div className="dc-onb-account__dev-skip">
          <button type="button" className="dc-onb-account__dev-skip-button" onClick={onSkipAuthForDev}>
            <span className="dc-onb-account__dev-badge" aria-hidden="true">DEV</span>
            <span>{t("onboarding.account.devSkip")}</span>
          </button>
          <p>{t("onboarding.account.devSkipHelper")}</p>
        </div>
      ) : null}
      {signInSettled ? null : (
        <p className="dc-onb-account__legal">
          {t("onboarding.account.legalPrefix")}{" "}
          <a href="https://drifty.so/terms/" target="_blank" rel="noreferrer">{t("onboarding.account.terms")}</a>{" "}
          {effectiveLanguage === "en" ? "&" : localeCopy(effectiveLanguage, "and")} <a href="https://drifty.so/privacy/" target="_blank" rel="noreferrer">{t("onboarding.account.privacy")}</a>
          {/* Korean puts the verb after the documents: "계속하면 이용약관 및 개인정보 처리방침에 동의하게 됩니다." */}
          {effectiveLanguage === "ko" ? "에 동의하게 됩니다." : effectiveLanguage === "ja" || effectiveLanguage === "zh-Hans" ? "。" : "."}
        </p>
      )}
    </div>
  );
}
