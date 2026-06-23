import type { CustomEndpointDraft } from "../../OnboardingCustomEndpointSetup";

type SelfDataReviewStepProps = {
  readonly customEndpointDraft: CustomEndpointDraft;
  readonly isByokSetup: boolean;
  readonly isCustomEndpointSetup: boolean;
  readonly maskedApiKey: string | null;
};

export function SelfDataReviewStep({
  customEndpointDraft,
  isByokSetup,
  isCustomEndpointSetup,
  maskedApiKey,
}: SelfDataReviewStepProps) {
  return (
    <>
      <p className="onb-step-desc">
        {isByokSetup
          ? "With BYOK, Drifty sends minimized activity context to your chosen AI provider through OpenRouter using your masked key."
          : isCustomEndpointSetup
            ? "With a custom endpoint, Drifty sends minimized activity context to the endpoint and model you entered."
            : "With Local AI, minimized activity context stays on this Mac and is classified by the selected local model."}
      </p>
      <div className="onb-data-cards" aria-label="Self-hosted data handling summary">
        <div className="onb-data-card">
          <h2 className="onb-data-card__title">Where data goes</h2>
          <p className="onb-data-card__desc">
            {isByokSetup
              ? "Minimized classification context goes to OpenRouter for the model call."
              : isCustomEndpointSetup
                ? "Minimized classification context goes to your custom endpoint for the model call."
                : "Activity goes to the selected local model managed by Drifty, not to Drifty Cloud."}
          </p>
        </div>
        <div className="onb-data-card">
          <h2 className="onb-data-card__title">Who manages it</h2>
          <p className="onb-data-card__desc">
            {isByokSetup
              ? "You manage the provider key, model access, and provider billing."
              : isCustomEndpointSetup
                ? "You manage the endpoint, model access, uptime, and billing if it is hosted."
                : "Drifty manages the local runtime files; you control whether the local model is installed."}
          </p>
        </div>
        <div className="onb-data-card">
          <h2 className="onb-data-card__title">What Drifty needs</h2>
          <p className="onb-data-card__desc">
            {isByokSetup
              ? `A masked OpenRouter key${maskedApiKey ? ` (${maskedApiKey})` : ""} plus local permissions for activity context.`
              : isCustomEndpointSetup
                ? `Local permissions plus ${customEndpointDraft.model.trim()} at ${customEndpointDraft.baseUrl.trim()}.`
                : "Local permissions to read activity context and a downloaded managed local model."}
          </p>
        </div>
      </div>
      <p className="onb-account__helper">You can change these settings later.</p>
    </>
  );
}
