import type { OnboardingFlow } from "../../useOnboardingFlow";
import { SpinnerIcon, SuccessIcon } from "./shared";
import { useLocalization, type LocalizationController } from "../../../localization/LocalizationContext";
import { localizeAiConnectionTestMessage } from "../../../localization/aiStatusTranslations";
import type { ConnectionFailure } from "../../onboardingFlow";

export function TestConnectionStep({ flow }: { readonly flow: OnboardingFlow }) {
  const { t } = useLocalization();
  const failed = flow.connectionPhase === "failed";
  return (
    <>
      <p className="dc-onb-copy">
        {flow.connectionPhase === "success"
          ? flow.isByokSetup
            ? t("onboarding.test.openRouterSuccess")
            : t("onboarding.test.customSuccess")
          : failed
            ? connectionFailureText(flow.connectionFailure, t)
          : flow.isByokSetup
            ? t("onboarding.test.openRouterChecking")
            : t("onboarding.test.customChecking")}
      </p>
      <ul className="dc-onb-check-list">
        {flow.connectionChecks.map((check, index) => {
          const status = flow.checkStatuses[index] ?? "pending";
          return (
            <li className="dc-onb-check-row" key={check.id}>
              <span className="dc-onb-check-row__mark" aria-hidden="true">
                {status === "success" ? <SuccessIcon /> : status === "loading" ? <SpinnerIcon /> : <PendingIcon failed={status === "error"} />}
              </span>
              <span className={status === "success" ? "dc-onb-check-row__label" : "dc-onb-check-row__label dc-onb-check-row__label--pending"}>
                {t(check.labelKey)}
              </span>
            </li>
          );
        })}
      </ul>
      {failed ? (
        <div className="dc-onb-test-retry">
          <button type="button" className="dc-onb-secondary-button" onClick={flow.retryConnectionTest}>
            {t("onboarding.test.retry")}
          </button>
          <span>{t("onboarding.test.retryHint")}</span>
        </div>
      ) : null}
    </>
  );
}

function connectionFailureText(
  failure: ConnectionFailure | null,
  t: LocalizationController["t"],
): string {
  if (!failure) return t("onboarding.test.defaultFailure");
  if (failure.kind === "local") return t(failure.key);
  // Known provider messages have translations of their own. Anything else is
  // a raw exception string, so lead with what to check and keep the raw text
  // only as a detail. Passing "ko" routes English through the same key lookup
  // instead of the English pass-through, so unknown text is detected the same
  // way in every language; the result still comes from the active `t`.
  const unknownFallback = t("settings.ai.connection.errorDetail", { detail: failure.message });
  const localized = localizeAiConnectionTestMessage(failure.message, "error", "ko", t);
  return localized === unknownFallback
    ? t("onboarding.test.unknownFailure", { detail: failure.message })
    : localized;
}

function PendingIcon({ failed }: { readonly failed: boolean }) {
  return <span className={failed ? "dc-onb-pending-dot dc-onb-pending-dot--failed" : "dc-onb-pending-dot"} />;
}
