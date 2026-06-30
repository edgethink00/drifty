import { useEffect, useState } from "react";
import type { SetupChoice } from "../../onboardingFlow";

const TRIAL_DAYS = 7;

type SetupChoiceStepProps = {
  readonly setupChoice: SetupChoice | null;
  readonly onSetupChoice: (choice: SetupChoice) => void;
};

export function SetupChoiceStep({ setupChoice, onSetupChoice }: SetupChoiceStepProps) {
  const isUserManaged = setupChoice === "byok" || setupChoice === "custom_endpoint";
  const [advancedOpen, setAdvancedOpen] = useState(isUserManaged);

  // Keep the advanced section open whenever a provider inside it is selected.
  useEffect(() => {
    if (isUserManaged) setAdvancedOpen(true);
  }, [isUserManaged]);

  return (
    <div className="onb-setup-choice">
      <SetupChoiceCard
        choice="simple"
        selected={setupChoice === "simple"}
        title="Drifty Cloud"
        badge="Recommended"
        description={`We host the AI for you — nothing to install. Includes a ${TRIAL_DAYS}-day free trial.`}
        icon={<CloudIcon />}
        onSelect={onSetupChoice}
      />
      <SetupChoiceCard
        choice="local_ai"
        selected={setupChoice === "local_ai"}
        title="Local AI"
        description="Runs on this Mac — your activity never leaves your device. One-time model download."
        icon={<LocalAiIcon />}
        onSelect={onSetupChoice}
      />

      <button
        type="button"
        className="onb-setup-choice__advanced-toggle"
        aria-expanded={advancedOpen}
        onClick={() => setAdvancedOpen((open) => !open)}
      >
        <span
          className={`onb-setup-choice__chevron${advancedOpen ? " onb-setup-choice__chevron--open" : ""}`}
          aria-hidden="true"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M5.25 3.5L8.75 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        Connect your own AI provider
      </button>

      {advancedOpen ? (
        <div className="onb-setup-choice__advanced">
          <SetupChoiceCard
            choice="byok"
            selected={setupChoice === "byok"}
            title="Bring your own key"
            description="Use your own OpenRouter API key. Roughly $2–4/month, depending on usage."
            icon={<KeyIcon />}
            onSelect={onSetupChoice}
          />
          <SetupChoiceCard
            choice="custom_endpoint"
            selected={setupChoice === "custom_endpoint"}
            title="Custom endpoint"
            description="Point Drifty at any OpenAI-compatible endpoint and model you run."
            icon={<EndpointIcon />}
            onSelect={onSetupChoice}
          />
        </div>
      ) : null}
    </div>
  );
}

function SetupChoiceCard({
  badge,
  choice,
  description,
  icon,
  selected,
  title,
  onSelect,
}: {
  readonly badge?: string;
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
        <span className="onb-setup-choice__heading">
          <span className="onb-setup-choice__title">{title}</span>
          {badge ? <span className="onb-setup-choice__badge">{badge}</span> : null}
        </span>
        <span className="onb-setup-choice__desc">{description}</span>
      </span>
      {selected ? <SelectedCheck /> : null}
    </button>
  );
}

function SelectedCheck() {
  return (
    <span className="onb-setup-choice__check" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" fill="currentColor" />
        <path d="M8.5 12.2l2.4 2.4 4.6-4.8" stroke="var(--onb-surface)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M7.2 17.2h9.2a4 4 0 0 0 .4-8 5.8 5.8 0 0 0-11 1.8 3.2 3.2 0 0 0 1.4 6.2Z" />
    </svg>
  );
}

function LocalAiIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <rect x="6" y="6.8" width="12" height="8.4" rx="1.4" />
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
