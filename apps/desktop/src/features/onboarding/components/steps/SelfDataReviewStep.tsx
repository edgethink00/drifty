import type { OnboardingFlow } from "../../useOnboardingFlow";

export function SelfDataReviewStep({ flow }: { readonly flow: OnboardingFlow }) {
  const maskedApiKey = flow.maskedApiKey?.replace("••••••", "......") ?? null;
  const isByok = flow.isByokSetup;
  const isCustom = flow.isCustomEndpointSetup;
  const reviewIntro = isByok
    ? "With BYOK, Drifty sends minimized activity context to your chosen provider through OpenRouter using your masked key."
    : isCustom
      ? "With a custom endpoint, Drifty sends minimized activity context to the endpoint and model you entered."
      : "With Local AI, minimized activity context stays on this Mac and is classified by the model you picked.";
  const whereDesc = isByok
    ? "Minimized classification context goes to OpenRouter for the model call."
    : isCustom
      ? "Minimized classification context goes to your custom endpoint for the model call."
      : "Activity goes to the selected local model on this Mac, not to Drifty Cloud.";
  const whoDesc = isByok
    ? "You manage the provider key, model access, and provider billing."
    : isCustom
      ? "You manage the endpoint, model access, uptime, and billing if it is hosted."
      : "Drifty manages the local runtime files; you control whether the model is installed.";
  const whatDesc = isByok
    ? `A masked OpenRouter key${maskedApiKey ? ` (${maskedApiKey})` : ""} plus local permissions for activity context.`
    : isCustom
      ? `Local permissions plus ${flow.customEndpointDraft.model.trim() || "your model"} at ${flow.customEndpointDraft.baseUrl.trim()}.`
      : "Local permissions to read activity context and a downloaded managed local model.";

  return (
    <>
      <p className="dc-onb-copy dc-onb-copy--wide">{reviewIntro}</p>
      <div className="dc-onb-data-grid">
        <DataCard title="Where data goes" description={whereDesc} />
        <DataCard title="Who manages it" description={whoDesc} />
        <DataCard title="What Drifty needs" description={whatDesc} />
      </div>
      <p className="dc-onb-muted-note">You can change these settings later.</p>
    </>
  );
}

function DataCard({ description, title }: { readonly description: string; readonly title: string }) {
  return (
    <div className="dc-onb-data-card">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
