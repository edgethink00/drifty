import { BrowserHistoryBootstrapPreference } from "../BrowserHistoryBootstrapPreference";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { ToggleButton } from "./shared";
import { useLocalization, type LocalizationController } from "../../../localization/LocalizationContext";
import { formatBillingAccessEndDate } from "../../../billing/billingAccessCopy";
import { canStartCloudTrial } from "../../../billing/billingEligibility";

export function ReadyStep({ flow }: { readonly flow: OnboardingFlow }) {
  const { effectiveLanguage, t } = useLocalization();
  const summaryItems = summaryItemsForFlow(flow, t, effectiveLanguage);

  return (
    <>
      <p className="dc-onb-copy dc-onb-ready-copy">{t("onboarding.ready.intro")}</p>
      {flow.setupChoice === "simple" && !flow.accountSkippedForDev
        && !flow.billingEntitlement?.canUseApp && !canStartCloudTrial(flow.billingEntitlement) ? (
          <div className="dc-onb-inline-status" role="status">
            <p>{t("billing.trialActivation.unavailable")}</p>
            <button type="button" className="dc-onb-back" disabled={flow.isCompleting} onClick={flow.returnToSetupChoice}>
              {t("onboarding.title.chooseSetup")}
            </button>
          </div>
        ) : null}
      <ul className="dc-onb-ready-list">
        {summaryItems.map((item) => (
          <li className="dc-onb-ready-item" key={item.label}>
            <CheckMarkIcon />
            {item.sub ? (
              <span className="dc-onb-ready-item__stack">
                <strong>{item.label}</strong>
                <span>{item.sub}</span>
                {item.details?.map((detail) => <span key={detail}>{detail}</span>)}
              </span>
            ) : (
              <span className="dc-onb-ready-item__label">{item.label}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="dc-onb-login-row">
        <h2>{t("onboarding.ready.startAtLogin")}</h2>
        <ToggleButton
          label={t("onboarding.ready.startAtLogin")}
          on={flow.openAtLoginEnabled}
          compact
          disabled={flow.isCompleting}
          onClick={() => flow.setOpenAtLoginEnabled((current) => !current)}
        />
      </div>
      <BrowserHistoryBootstrapPreference
        enabled={flow.browserHistoryBootstrapEnabled}
        disabled={flow.isCompleting}
        onChange={flow.setBrowserHistoryBootstrapEnabled}
      />
      <p className="dc-onb-muted-note dc-onb-muted-note--ready">{t("onboarding.ready.pauseNote")}</p>
    </>
  );
}

function summaryItemsForFlow(
  flow: OnboardingFlow,
  t: LocalizationController["t"],
  language: LocalizationController["effectiveLanguage"],
): ReadonlyArray<{ readonly label: string; readonly sub?: string; readonly details?: readonly string[] }> {
  const accountSummary = flow.accountSkippedForDev
    ? t("onboarding.ready.accountSkippedForDev")
    : t("onboarding.ready.accountConnected");
  if (flow.setupChoice === "local_ai" || flow.isUserManagedProviderSetup) {
    return [
      {
        label: flow.setupChoice === "local_ai" ? t("onboarding.ready.localSelected") : flow.isByokSetup ? t("onboarding.ready.byokSelected") : t("onboarding.ready.customSelected"),
        sub: flow.setupChoice === "local_ai"
          ? flow.managedLocalReady ? t("onboarding.ready.localReady") : t("onboarding.ready.localDownloading")
          : flow.isByokSetup ? t("onboarding.ready.openRouterConnected") : t("onboarding.ready.customConnected"),
      },
      { label: accountSummary },
      { label: t("onboarding.ready.trackingReady") },
    ];
  }
  return [
    {
      label: t("onboarding.ready.cloudSelected"),
      sub: canStartCloudTrial(flow.billingEntitlement)
        ? t("billing.trialActivation.available")
        : flow.promotionActive
        ? t("onboarding.ready.promoAccessUntil", {
          date: formatBillingAccessEndDate(flow.promotionEndsAt, language)
            ?? t("onboarding.promo.activePeriod"),
        })
        : flow.cloudTrialStartedNotice
          ? t("onboarding.ready.cloudTrialActive")
          : t("onboarding.ready.cloudAccountReady"),
    },
    { label: accountSummary },
    { label: t("onboarding.ready.trackingReady") },
  ];
}

function CheckMarkIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path d="M4 12.5l4.5 4.5L20 6" stroke="#1c1c19" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
