import { BrowserHistoryBootstrapPreference } from "../BrowserHistoryBootstrapPreference";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { TRIAL_DAYS, ToggleButton } from "./shared";
import { useLocalization, type LocalizationController } from "../../../localization/LocalizationContext";

export function ReadyStep({ flow }: { readonly flow: OnboardingFlow }) {
  const { t } = useLocalization();
  const summaryItems = summaryItemsForFlow(flow, t);

  return (
    <>
      <p className="dc-onb-copy dc-onb-ready-copy">{t("onboarding.ready.intro")}</p>
      <ul className="dc-onb-ready-list">
        {summaryItems.map((item) => (
          <li className="dc-onb-ready-item" key={item.label}>
            <CheckMarkIcon />
            {item.sub ? (
              <span className="dc-onb-ready-item__stack">
                <strong>{item.label}</strong>
                <span>{item.sub}</span>
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
          onClick={() => flow.setOpenAtLoginEnabled((current) => !current)}
        />
      </div>
      <BrowserHistoryBootstrapPreference
        enabled={flow.browserHistoryBootstrapEnabled}
        onChange={flow.setBrowserHistoryBootstrapEnabled}
      />
      <p className="dc-onb-muted-note dc-onb-muted-note--ready">{t("onboarding.ready.pauseNote")}</p>
    </>
  );
}

function summaryItemsForFlow(flow: OnboardingFlow, t: LocalizationController["t"]): ReadonlyArray<{ readonly label: string; readonly sub?: string }> {
  if (flow.setupChoice === "local_ai" || flow.isUserManagedProviderSetup) {
    return [
      { label: flow.setupChoice === "local_ai" ? t("onboarding.ready.localSelected") : flow.isByokSetup ? t("onboarding.ready.byokSelected") : t("onboarding.ready.customSelected") },
      { label: t("onboarding.ready.accountConnected") },
      {
        label: flow.setupChoice === "local_ai"
          ? flow.managedLocalReady ? t("onboarding.ready.localReady") : t("onboarding.ready.localDownloading")
          : flow.isByokSetup ? t("onboarding.ready.openRouterConnected") : t("onboarding.ready.customConnected"),
      },
      { label: t("onboarding.ready.trackingReady") },
    ];
  }
  return [
    { label: t("onboarding.ready.cloudSelected") },
    { label: t("onboarding.ready.accountConnected") },
    { label: t("onboarding.ready.trialStarted", { days: TRIAL_DAYS }), sub: t("onboarding.ready.trialReady") },
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
