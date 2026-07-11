import { useLocalization } from "../../../localization/LocalizationContext";

export const TRIAL_DAYS = 7;

type ToggleButtonProps = {
  readonly label: string;
  readonly on: boolean;
  readonly tone?: "default" | "extreme";
  readonly compact?: boolean;
  readonly onClick: () => void;
};

export function ToggleButton({ compact = false, label, on, onClick, tone = "default" }: ToggleButtonProps) {
  const { t } = useLocalization();
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
      <span className="dc-onb-toggle__label">{on ? t("common.on") : t("common.off")}</span>
    </button>
  );
}

export function SpinnerIcon() {
  return <span className="dc-onb-spinner" aria-hidden="true" />;
}

export function SuccessIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" fill="#1f8a5b" />
      <path d="M8.5 12.2l2.4 2.4 4.6-4.8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
