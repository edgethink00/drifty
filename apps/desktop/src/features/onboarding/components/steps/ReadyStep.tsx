import { BrowserHistoryBootstrapPreference } from "../BrowserHistoryBootstrapPreference";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { ToggleButton } from "./shared";
import { useLocalization, type LocalizationController } from "../../../localization/LocalizationContext";
import { formatBillingAccessEndDate } from "../../../billing/billingAccessCopy";
import { canStartCloudTrial } from "../../../billing/billingEligibility";
import { accessibilityClient } from "../../../../lib/api/accessibilityClient";

export function ReadyStep({ flow }: { readonly flow: OnboardingFlow }) {
  const { effectiveLanguage, t } = useLocalization();
  const cloudSetup = flow.setupChoice === "simple";
  const cloudUnavailable = cloudSetup && !flow.accountSkippedForDev
    && !flow.billingEntitlement?.canUseApp && !canStartCloudTrial(flow.billingEntitlement);
  const readyItems = readyItemsForFlow(flow, t, effectiveLanguage, cloudUnavailable);
  // Windows has no menu bar; tracking is paused from the taskbar icon there.
  const pauseNote = t(accessibilityClient.detectHostPlatform() === "macos"
    ? "onboarding.ready.pauseNote"
    : "onboarding.ready.pauseNoteWindows");

  return (
    <>
      <p className="dc-onb-copy dc-onb-ready-copy">{t("onboarding.ready.intro")}</p>
      {cloudUnavailable ? (
        <div className="dc-onb-inline-status" role="status">
          <p>{t(flow.billingEntitlement?.lockedReason === "device_limit_reached"
            ? "onboarding.ready.cloudDeviceLimit"
            : "billing.trialActivation.unavailable")}</p>
          <button type="button" className="dc-onb-back" disabled={flow.isCompleting} onClick={flow.returnToSetupChoice}>
            {t("onboarding.title.chooseSetup")}
          </button>
        </div>
      ) : null}
      {/* What is ready, in one line: the AI choice with its state emphasized, then account and tracking. */}
      <p className="dc-onb-ready-line">
        {readyItems.map((item) => (
          <span className="dc-onb-ready-line__item" key={item.label}>
            {item.label}
            {item.state ? <> <strong data-tone={item.tone}>{item.state}</strong></> : null}
          </span>
        ))}
      </p>
      <div className="dc-onb-ready-options">
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
      </div>
      <p className="dc-onb-muted-note dc-onb-muted-note--ready">
        {cloudSetup ? `${t("onboarding.ready.cloudData")} ${pauseNote}` : pauseNote}
      </p>
    </>
  );
}

type ReadyItem = { readonly label: string; readonly state?: string; readonly tone?: "warn" };

function readyItemsForFlow(
  flow: OnboardingFlow,
  t: LocalizationController["t"],
  language: LocalizationController["effectiveLanguage"],
  cloudUnavailable: boolean,
): readonly ReadyItem[] {
  const account: ReadyItem = {
    label: flow.accountSkippedForDev
      ? t("onboarding.ready.accountSkippedForDev")
      : t("onboarding.ready.accountConnected"),
  };
  const tracking: ReadyItem = { label: t("onboarding.ready.trackingReady") };
  if (flow.setupChoice === "local_ai") {
    return [
      { label: t(flow.managedLocalReady ? "onboarding.ready.localReady" : "onboarding.ready.localDownloading") },
      account,
      tracking,
    ];
  }
  if (flow.isUserManagedProviderSetup) {
    return [
      { label: t(flow.isByokSetup ? "onboarding.ready.openRouterConnected" : "onboarding.ready.customConnected") },
      account,
      tracking,
    ];
  }
  return [
    { label: t("onboarding.setup.cloud"), ...cloudState(flow, t, language, cloudUnavailable) },
    account,
    tracking,
  ];
}

function cloudState(
  flow: OnboardingFlow,
  t: LocalizationController["t"],
  language: LocalizationController["effectiveLanguage"],
  cloudUnavailable: boolean,
): Pick<ReadyItem, "state" | "tone"> {
  if (cloudUnavailable) return { state: t("onboarding.ready.cloudUnavailable"), tone: "warn" };
  if (canStartCloudTrial(flow.billingEntitlement)) return { state: t("billing.trialActivation.available") };
  if (flow.promotionActive) {
    return {
      state: t("onboarding.ready.promoAccessUntil", {
        date: formatBillingAccessEndDate(flow.promotionEndsAt, language) ?? t("onboarding.promo.activePeriod"),
      }),
    };
  }
  if (flow.cloudTrialStartedNotice) return { state: t("onboarding.ready.cloudTrialActive") };
  return { state: t("onboarding.ready.cloudAccountReady") };
}

