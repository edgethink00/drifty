import type { OnboardingFlow } from "../../useOnboardingFlow";
import { SpinnerIcon } from "./shared";

export function TestConnectionStep({ flow }: { readonly flow: OnboardingFlow }) {
  return (
    <>
      <p className="dc-onb-copy">
        {flow.connectionPhase === "success"
          ? flow.isByokSetup
            ? "Your OpenRouter key is connected and ready for AI classification."
            : "Your custom endpoint is connected and ready for AI classification."
          : flow.connectionPhase === "failed"
            ? `Drifty could not connect: ${flow.connectionFailureLabel ?? "Connection test failed."}`
          : flow.isByokSetup
            ? "Checking that Drifty can use your masked OpenRouter key."
            : "Checking that Drifty can use your custom endpoint."}
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

function SuccessIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" fill="#1f8a5b" />
      <path d="M8.5 12.2l2.4 2.4 4.6-4.8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
