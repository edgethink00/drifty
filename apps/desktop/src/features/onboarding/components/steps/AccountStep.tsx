import type { OAuthCallbackStatus } from "../../../auth/AuthContext";
import { GoogleMark } from "../GoogleMark";
import { SuccessIcon } from "./shared";
import { useLocalization } from "../../../localization/LocalizationContext";

export function AccountStep({
  accountConnected,
  authCallbackStatus,
  onStartCloudTrialWithEmail,
  onStartCloudTrialWithGoogle,
}: {
  readonly accountConnected: boolean;
  readonly authCallbackStatus: OAuthCallbackStatus | null;
  readonly onStartCloudTrialWithEmail: () => void;
  readonly onStartCloudTrialWithGoogle: () => void;
}) {
  const { t } = useLocalization();
  const isGoogleHandoffBusy = authCallbackStatus ? authCallbackStatus.phase !== "failed" : false;
  const callbackNoticeRole = authCallbackStatus?.phase === "failed" ? "alert" : "status";
  const callbackNoticeClassName = [
    "dc-onb-account__callback",
    authCallbackStatus?.phase === "failed" ? "dc-onb-account__callback--failed" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className="dc-onb-account">
      <h2 className="dc-onb-account__title">{t("onboarding.title.account")}</h2>
      <p className="dc-onb-account__copy">{t("onboarding.account.copy")}</p>
      {accountConnected ? (
        <div className="dc-onb-account__connected" role="status">
          <SuccessIcon />
          <span>{t("onboarding.ready.accountConnected")}</span>
        </div>
      ) : (
        <div className="dc-onb-account__buttons">
          <button
            type="button"
            className="dc-onb-account__google"
            onClick={onStartCloudTrialWithGoogle}
            disabled={isGoogleHandoffBusy}
          >
            <GoogleMark />
            <span>{t("onboarding.account.google")}</span>
          </button>
          <div className="dc-onb-divider" aria-hidden="true">
            <span />
            {t("onboarding.account.or")}
            <span />
          </div>
          <button
            type="button"
            className="dc-onb-account__email"
            onClick={onStartCloudTrialWithEmail}
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
