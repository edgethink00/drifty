export const TRIAL_DAYS = 7;

type ToggleButtonProps = {
  readonly label: string;
  readonly on: boolean;
  readonly tone?: "default" | "extreme";
  readonly compact?: boolean;
  readonly onClick: () => void;
};

export function ToggleButton({ compact = false, label, on, onClick, tone = "default" }: ToggleButtonProps) {
  return (
    <button
      type="button"
      className={`dc-onb-toggle${compact ? " dc-onb-toggle--compact" : ""}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
    >
      <span className={`dc-onb-toggle__track${on ? ` dc-onb-toggle__track--on dc-onb-toggle__track--${tone}` : ""}`}>
        <span className="dc-onb-toggle__thumb" />
      </span>
      <span className="dc-onb-toggle__label">{on ? "On" : "Off"}</span>
    </button>
  );
}

export function SpinnerIcon() {
  return <span className="dc-onb-spinner" aria-hidden="true" />;
}
