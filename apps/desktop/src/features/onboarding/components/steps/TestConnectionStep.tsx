import type { ConnectionCheck, ConnectionCheckStatus, ConnectionPhase } from "../../onboardingFlow";

type TestConnectionStepProps = {
  readonly checkStatuses: readonly ConnectionCheckStatus[];
  readonly connectionChecks: readonly ConnectionCheck[];
  readonly connectionFailureLabel: string | null;
  readonly connectionPhase: ConnectionPhase;
  readonly isByokSetup: boolean;
  readonly isCustomEndpointSetup: boolean;
  readonly onEditConnection: () => void;
  readonly onRetry: () => void;
};

export function TestConnectionStep({
  checkStatuses,
  connectionChecks,
  connectionFailureLabel,
  connectionPhase,
  isByokSetup,
  isCustomEndpointSetup,
  onEditConnection,
  onRetry,
}: TestConnectionStepProps) {
  return (
    <>
      <p className="onb-step-desc">
        {connectionPhase === "success"
          ? isByokSetup
            ? "Your OpenRouter key is connected and ready for AI classification."
            : isCustomEndpointSetup
              ? "Your custom endpoint is connected and ready for AI classification."
              : "Your Local AI server is connected and ready for classification."
          : connectionPhase === "failed"
            ? `Drifty could not connect: ${connectionFailureLabel ?? "Connection test failed."}`
            : isByokSetup
              ? "Checking that Drifty can use your masked OpenRouter key."
              : isCustomEndpointSetup
                ? "Checking that Drifty can use your custom endpoint."
                : "Checking that Drifty can reach your Local AI server."}
      </p>
      <ul className="onb-checklist" aria-label="Connection checks">
        {connectionChecks.map((check, index) => {
          const status = checkStatuses[index] ?? "pending";
          return (
            <li className={`onb-checklist__row onb-checklist__row--${status}`} key={check.id}>
              <span className="onb-checklist__icon" aria-hidden="true" />
              <span className="onb-checklist__label">{check.label}</span>
            </li>
          );
        })}
      </ul>
      {connectionPhase === "failed" ? (
        <>
          <ul className="onb-checklist__fixes" aria-label="Possible fixes">
            {isByokSetup ? (
              <>
                <li>Confirm the key starts with sk-or- and is active in OpenRouter.</li>
                <li>Check your provider billing and model access.</li>
              </>
            ) : (
              <>
                <li>Confirm the endpoint URL is correct and the server is running.</li>
                <li>Make sure your Mac can reach the endpoint address.</li>
              </>
            )}
          </ul>
          <div className="onb-setup-card__actions">
            <button type="button" className="onb-button onb-button--primary" onClick={onRetry}>
              Try again
            </button>
            <button type="button" className="onb-button onb-button--ghost" onClick={onEditConnection}>
              Edit connection details
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
