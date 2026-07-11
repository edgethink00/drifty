import type { OnboardingFlow } from "../../useOnboardingFlow";
import { SpinnerIcon, SuccessIcon } from "./shared";
import { useLocalization } from "../../../localization/LocalizationContext";

export function TestConnectionStep({ flow }: { readonly flow: OnboardingFlow }) {
  const { t } = useLocalization();
  return (
    <>
      <p className="dc-onb-copy">
        {flow.connectionPhase === "success"
          ? flow.isByokSetup
            ? t("onboarding.test.openRouterSuccess")
            : t("onboarding.test.customSuccess")
          : flow.connectionPhase === "failed"
            ? t("onboarding.test.failed", { reason: flow.connectionFailureLabel ?? t("onboarding.test.defaultFailure") })
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
                {check.label}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function PendingIcon({ failed }: { readonly failed: boolean }) {
  return <span className={failed ? "dc-onb-pending-dot dc-onb-pending-dot--failed" : "dc-onb-pending-dot"} />;
}
