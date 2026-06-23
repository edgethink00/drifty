import type { SetupChoice } from "../../onboardingFlow";

type SetupChoiceStepProps = {
  readonly setupChoice: SetupChoice | null;
  readonly onSetupChoice: (choice: SetupChoice) => void;
};

export function SetupChoiceStep({ setupChoice, onSetupChoice }: SetupChoiceStepProps) {
  return (
    <div className="onb-setup-choice">
      <SetupChoiceCard
        choice="simple"
        selected={setupChoice === "simple"}
        title="Drifty Cloud"
        description="Start fast with hosted AI. Includes a 7-day trial."
        icon={<CloudIcon />}
        onSelect={onSetupChoice}
      />
      <SetupChoiceCard
        choice="local_ai"
        selected={setupChoice === "local_ai"}
        title="Local AI"
        description="Download a Drifty-managed model and run classification locally."
        icon={<LocalAiIcon />}
        onSelect={onSetupChoice}
      />
      <SetupChoiceCard
        choice="byok"
        selected={setupChoice === "byok"}
        title="BYOK (Bring Your Own Key)"
        description="Use your own OpenRouter API key. Estimated $2-4/month with DeepSeek v4 flash."
        icon={<KeyIcon />}
        onSelect={onSetupChoice}
      />
      <SetupChoiceCard
        choice="custom_endpoint"
        selected={setupChoice === "custom_endpoint"}
        title="Custom endpoint"
        description="Use any OpenAI-compatible local or hosted endpoint with your own model."
        icon={<EndpointIcon />}
        onSelect={onSetupChoice}
      />
    </div>
  );
}

function SetupChoiceCard({
  choice,
  description,
  icon,
  selected,
  title,
  onSelect,
}: {
  readonly choice: SetupChoice;
  readonly description: string;
  readonly icon: React.ReactNode;
  readonly selected: boolean;
  readonly title: string;
  readonly onSelect: (choice: SetupChoice) => void;
}) {
  return (
    <button
      type="button"
      className={`onb-setup-choice__card${selected ? " onb-setup-choice__card--selected" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(choice)}
    >
      <span className="onb-setup-choice__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="onb-setup-choice__copy">
        <span className="onb-setup-choice__title">{title}</span>
        <span className="onb-setup-choice__desc">{description}</span>
      </span>
    </button>
  );
}

function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M7.2 17.2h9.2a4 4 0 0 0 .4-8 5.8 5.8 0 0 0-11 1.8 3.2 3.2 0 0 0 1.4 6.2Z" />
      <path d="M9.3 13.8h5.9" />
    </svg>
  );
}

function LocalAiIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M6 6.8h12v8.4H6Z" />
      <path d="M8.4 18h7.2M9.2 9.8h5.6M9.2 12.2h5.6" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <circle cx="8.1" cy="15.9" r="2.45" />
      <path d="M9.85 14.15 16.9 7.1" />
      <path d="M15.35 8.65 17.15 10.45" />
      <path d="M13.95 10.05 15.2 11.3" />
    </svg>
  );
}

function EndpointIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M5.4 8.2h7.9a3.8 3.8 0 1 1 0 7.6H9.6" />
      <path d="M9.6 12h9" />
      <path d="M9.6 15.8a3.8 3.8 0 1 1 0-7.6h3.7" />
    </svg>
  );
}
