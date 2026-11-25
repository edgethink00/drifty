import { BrowserHistoryBootstrapPreference } from "../BrowserHistoryBootstrapPreference";
import { OnboardingCloudDeviceList } from "../OnboardingCloudDeviceList";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { ToggleButton } from "./shared";
import { useLocalization, type LocalizationController } from "../../../localization/LocalizationContext";
import { formatBillingAccessEndDate } from "../../../billing/billingAccessCopy";
import { canStartCloudTrial } from "../../../billing/billingEligibility";
import { accessibilityClient } from "../../../../lib/api/accessibilityClient";

export function ReadyStep({ flow }: { readonly flow: OnboardingFlow }) {
  const { effectiveLanguage, t } = useLocalization();
  const cloudSetup = flow.setupChoice === "simple";
  // While the access check runs nothing is known yet, so no unavailable notice (2026-11-10).
  const cloudChecking = cloudSetup && !flow.accountSkippedForDev && flow.billingEntitlementLoading;
  const cloudUnavailable = cloudSetup && !flow.accountSkippedForDev && !cloudChecking
    && !flow.billingEntitlement?.canUseApp && !canStartCloudTrial(flow.billingEntitlement);
  const readyItems = readyItemsForFlow(flow, t, effectiveLanguage, cloudUnavailable, cloudChecking);
  const deviceLimited = cloudUnavailable && flow.billingEntitlement?.lockedReason === "device_limit_reached";
  // Only devices holding a slot: removing an aged-out or revoked one frees nothing.
  const otherDevices = (flow.billingEntitlement?.cloudDevices ?? [])
    .filter((device) => !device.isCurrent && device.isActive && device.revokedAt === null);
  const revokeCloudDevice = typeof flow.revokeCloudDevice === "function" ? flow.revokeCloudDevice : null;
  const canFreeDeviceHere = deviceLimited && revokeCloudDevice !== null && otherDevices.length > 0;
  // Windows has no menu bar; tracking is paused from the taskbar icon there.
  const pauseNote = t(accessibilityClient.detectHostPlatform() === "macos"
    ? "onboarding.ready.pauseNote"
    : "onboarding.ready.pauseNoteWindows");

  if (flow.readyCloudBlocked) {
    const options: readonly { readonly id: "local_ai" | "byok"; readonly label: string; readonly description: string; readonly badge?: string }[] = [
      ...(flow.localAlternativeUnsupported ? [] : [{ id: "local_ai" as const, label: t("onboarding.setup.local"), description: t("onboarding.ready.altLocalDescription"), badge: t("onboarding.ready.altFree") }]),
      { id: "byok" as const, label: t("onboarding.setup.ownProvider"), description: t("onboarding.ready.altProviderDescription") },
    ];
    return (
      <>
        <p className="dc-onb-copy dc-onb-ready-copy">{t(flow.readyCloudCheckFailed ? "onboarding.ready.cloudUncheckableIntro" : "onboarding.ready.cloudUnavailableIntro")}</p>
        <div className="dc-onb-ready-alternatives" role="radiogroup" aria-label={t("onboarding.title.chooseSetup")}>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={flow.readyAlternative === option.id}
              className={"dc-onb-ready-alternative" + (flow.readyAlternative === option.id ? " dc-onb-ready-alternative--selected" : "")}
              disabled={flow.isCompleting}
              onClick={() => flow.setReadyAlternative(option.id)}
            >
              <span className="dc-onb-ready-alternative__head">
                <strong>{option.label}</strong>
                {option.badge ? <span className="dc-onb-ready-alternative__badge">{option.badge}</span> : null}
              </span>
              <span className="dc-onb-ready-alternative__desc">{option.description}</span>
            </button>
          ))}
        </div>
        {flow.refreshBillingEntitlement ? (
          <p className="dc-onb-ready-recheck">
            {t("onboarding.ready.havePlan")}{" "}
            <button type="button" className="dc-onb-ready-recheck__link" disabled={flow.isCompleting} onClick={() => { void flow.refreshBillingEntitlement?.(); }}>
              {t("onboarding.ready.checkAgain")}
            </button>
          </p>
        ) : null}
      </>
    );
  }

  return (
    <>
      <p className="dc-onb-copy dc-onb-ready-copy">{t("onboarding.ready.intro")}</p>
      {cloudUnavailable ? (
        <div className={canFreeDeviceHere ? "dc-onb-inline-status dc-onb-inline-status--devices" : "dc-onb-inline-status"} role="status">
          <p>{t(canFreeDeviceHere
            ? "onboarding.ready.cloudDeviceLimitInline"
            : deviceLimited
              ? "onboarding.ready.cloudDeviceLimit"
              : "billing.trialActivation.unavailable")}</p>
          {canFreeDeviceHere && revokeCloudDevice ? (
            <OnboardingCloudDeviceList
              devices={otherDevices}
              revokingId={flow.cloudDeviceRevokingId ?? null}
              actionError={flow.cloudDeviceActionError ?? null}
              disabled={flow.isCompleting}
              onRevoke={revokeCloudDevice}
            />
          ) : null}
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
      {flow.githubStarAccount ? <GitHubStarChoice flow={flow} account={flow.githubStarAccount} /> : null}
    </>
  );
}

/** On by default for a signed-in gh: Start tracking also stars Drifty as this account. */
function GitHubStarChoice({ flow, account }: { readonly flow: OnboardingFlow; readonly account: string }) {
  const { t } = useLocalization();
  const before = t("onboarding.ready.githubStarBefore");
  const after = t("onboarding.ready.githubStarAfter");
  return (
    <label className="dc-onb-github-star">
      <input
        type="checkbox"
        checked={flow.githubStarOnStart}
        disabled={flow.isCompleting}
        onChange={(event) => flow.setGithubStarOnStart(event.currentTarget.checked)}
      />
      <span>
        {before ? before + " " : null}
        <strong>@{account}</strong>
        {after ? " " + after : null}
      </span>
    </label>
  );
}

type ReadyItem = { readonly label: string; readonly state?: string; readonly tone?: "warn" };

function readyItemsForFlow(
  flow: OnboardingFlow,
  t: LocalizationController["t"],
  language: LocalizationController["effectiveLanguage"],
  cloudUnavailable: boolean,
  cloudChecking: boolean,
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
      { label: flow.isCliSetup ? t("onboarding.cli.ready", { provider: flow.cliName }) : t(flow.isByokSetup ? "onboarding.ready.openRouterConnected" : "onboarding.ready.customConnected") },
      account,
      tracking,
    ];
  }
  return [
    { label: t("onboarding.setup.cloud"), ...(cloudChecking ? { state: t("onboarding.ready.cloudChecking") } : cloudState(flow, t, language, cloudUnavailable)) },
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

