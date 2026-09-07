import { useId, type ReactNode } from "react";
import { Toggle } from "../../components/Toggle";
import { useLocalization } from "../localization/LocalizationContext";

export function AutomaticCloseSettingsRow({
  checked,
  prerequisiteMissing,
  onChange,
  availableDescription,
  prerequisiteDescription,
  toggleAriaLabel,
  className,
  label,
  children,
}: {
  readonly checked: boolean;
  readonly prerequisiteMissing: boolean;
  readonly onChange: (enabled: boolean) => void;
  readonly availableDescription: string;
  readonly prerequisiteDescription: string;
  readonly toggleAriaLabel: string;
  readonly className?: string;
  readonly label?: string;
  readonly children?: ReactNode;
}) {
  const { t } = useLocalization();
  const reactId = useId().replace(/:/g, "");
  const labelId = `automatic-close-label-${reactId}`;
  const descriptionId = `automatic-close-desc-${reactId}`;
  const rowClassName = ["settings-row", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div data-setting-id="settings.notifications.extreme" className={rowClassName}>
      <div>
        <div className="lbl settings-label-with-badge" id={labelId}>{label ?? t("settings.notifications.extreme")} <span className="status-badge status-badge--beta">{t("common.beta")}</span></div>
        <div className="desc" id={descriptionId}>{prerequisiteMissing ? prerequisiteDescription : availableDescription}</div>
        {children}
      </div>
      <div className="ctrl">
        <Toggle
          checked={checked}
          onChange={onChange}
          ariaLabel={toggleAriaLabel}
          ariaDescribedBy={`${labelId} ${descriptionId}`}
        />
      </div>
    </div>
  );
}
