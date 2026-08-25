import { useId } from "react";
import { Toggle } from "../../components/Toggle";
import { useLocalization } from "../localization/LocalizationContext";

export function AutomaticCloseSettingsRow({
  checked,
  disabled,
  onChange,
  onDescription,
  offDescription,
  toggleAriaLabel,
  className,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (enabled: boolean) => void;
  readonly onDescription: string;
  readonly offDescription: string;
  readonly toggleAriaLabel: string;
  readonly className?: string;
}) {
  const { t } = useLocalization();
  const reactId = useId().replace(/:/g, "");
  const labelId = `automatic-close-label-${reactId}`;
  const descriptionId = `automatic-close-desc-${reactId}`;
  const rowClassName = ["settings-row", disabled ? "settings-row--disabled" : null, className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={rowClassName}>
      <div>
        <div className="lbl settings-label-with-badge" id={labelId}>{t("settings.notifications.extreme")} <span className="status-badge status-badge--beta">{t("common.beta")}</span></div>
        <div className="desc" id={descriptionId}>{disabled ? offDescription : onDescription}</div>
      </div>
      <div className="ctrl">
        <Toggle
          checked={!disabled && checked}
          disabled={disabled}
          onChange={onChange}
          ariaLabel={toggleAriaLabel}
          ariaDescribedBy={`${labelId} ${descriptionId}`}
        />
      </div>
    </div>
  );
}
