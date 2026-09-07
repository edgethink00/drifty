import { useState } from "react";
import type { OAuthCallbackStatus } from "../../../auth/AuthContext";
import { useAuthConnectionStatus } from "../../../auth/AuthContext";
import { GoogleMark } from "../GoogleMark";
import { SpinnerIcon, SuccessIcon } from "./shared";
import { useLocalization } from "../../../localization/LocalizationContext";
import { formatBillingAccessEndDate } from "../../../billing/billingAccessCopy";
import type { OnboardingAccountAccessState } from "../../accountAccessState";

export function AccountStep({
  accountConnected,
  accountAccessState,
  expectsPromotion,
  promotionActive,
  promotionEndsAt,
  authCallbackStatus,
  devAuthSkipEnabled,
  onSkipAuthForDev,
  onStartCloudTrialWithEmail,
  onStartCloudTrialWithGoogle,
  onStartCloudTrialWithWebsite,
  onDeleteAnonymousAccount,
  cloudConnectionStatusOverride,
  onRetryCloudConnection,
}: {
  readonly accountConnected: boolean;
  readonly accountAccessState: OnboardingAccountAccessState;
  readonly expectsPromotion: boolean;
  readonly promotionActive: boolean;
  readonly promotionEndsAt: string | null;
  readonly authCallbackStatus: OAuthCallbackStatus | null;
  readonly devAuthSkipEnabled: boolean;
  readonly onSkipAuthForDev: () => void;
  readonly onStartCloudTrialWithEmail: () => void;
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
  const googleButtonLabel = authCallbackStatus?.googleAction === "reopen"
    ? t("onboarding.account.reopenGoogle")
    : authCallbackStatus?.googleAction === "retry"
      ? t("onboarding.account.retryGoogle")
      : t("onboarding.account.google");
  const callbackNoticeRole = authCallbackStatus?.phase === "failed" ? "alert" : "status";
  const callbackNoticeClassName = [
    "dc-onb-account__callback",
    authCallbackStatus?.phase === "failed" ? "dc-onb-account__callback--failed" : "",
  ].filter(Boolean).join(" ");
  const showPromoEntry = expectsPromotion && !accountConnected && onStartCloudTrialWithWebsite !== undefined;
  const showCheckingState = accountAccessState === "checking";
  const showDeferredState = accountAccessState === "verification-deferred";
  return (
    <div className="dc-onb-account">
      <h2 className="dc-onb-account__title">
        {showPromoEntry ? t("auth.modal.promoTitle") : t("onboarding.title.account")}
      </h2>
      <p className="dc-onb-account__copy">
        {showPromoEntry ? t("auth.modal.promoDescription") : t("onboarding.account.copy")}
      </p>
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
                  ? promotionEndLabel
                    ? t("onboarding.account.promoConnectedUntil", { date: promotionEndLabel })
                    : t("onboarding.account.promoConnectedStatus")
                  : t("onboarding.ready.accountConnected")}
          </span>
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
            </>
          ) : (
            <button
              type="button"
              className="dc-onb-account__google"
              onClick={onStartCloudTrialWithGoogle}
              disabled={isGoogleHandoffBusy || isCloudUnavailable}
            >
              <GoogleMark />
              <span>{googleButtonLabel}</span>
            </button>
          )}
          <div className="dc-onb-divider" aria-hidden="true">
            <span />
            {t("onboarding.account.or")}
            <span />
          </div>
          {showPromoEntry ? (
            <button
              type="button"
              className="dc-onb-account__email promo-auth-screen__provider"
              onClick={onStartCloudTrialWithGoogle}
              disabled={isGoogleHandoffBusy || isCloudUnavailable}
            >
              <GoogleMark />
              <span>{googleButtonLabel}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="dc-onb-account__email"
            onClick={onStartCloudTrialWithEmail}
            disabled={isCloudUnavailable}
          >
            {t("onboarding.account.email")}
          </button>
        </div>
      )}
      {!accountConnected && authCallbackStatus ? (
        <div className={callbackNoticeClassName} role={callbackNoticeRole}>
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
      {!accountConnected && devAuthSkipEnabled ? (
        <div className="dc-onb-account__dev-skip">
          <button type="button" className="dc-onb-account__dev-skip-button" onClick={onSkipAuthForDev}>
            <span className="dc-onb-account__dev-badge" aria-hidden="true">DEV</span>
            <span>{t("onboarding.account.devSkip")}</span>
          </button>
          <p>{t("onboarding.account.devSkipHelper")}</p>
        </div>
      ) : null}
      <p className="dc-onb-account__helper">
        {t("onboarding.account.helper")}
      </p>
      <p className="dc-onb-account__legal">
        {t("onboarding.account.legalPrefix")}{" "}
        <a href="https://drifty.so/terms/" target="_blank" rel="noreferrer">{t("onboarding.account.terms")}</a>{" "}
        &amp; <a href="https://drifty.so/privacy/" target="_blank" rel="noreferrer">{t("onboarding.account.privacy")}</a>.
      </p>
    </div>
  );
}
