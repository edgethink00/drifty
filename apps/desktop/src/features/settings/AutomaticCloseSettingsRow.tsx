import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Toggle } from "../../components/Toggle";
import { ModalPresence } from "../../components/ModalPresence";
import type { HostPlatform } from "../../lib/api/accessibilityClient";
import { useLocalization } from "../localization/LocalizationContext";
import { AutomaticCloseConfirmDialog } from "../onboarding/AutomaticCloseConfirmDialog";

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
  petEnabled = false,
  hostPlatform = "macos",
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
  /** The desktop cat's switch: with the cat on, the consent preview shows the cat closing the tab. */
  readonly petEnabled?: boolean;
  readonly hostPlatform?: HostPlatform;
}) {
  const { t } = useLocalization();
  // Turning Automatic close on asks first, with the same consent the post-setup intro uses; turning it
  // off applies at once.
  const [confirming, setConfirming] = useState(false);
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
          onChange={(enabled) => (enabled ? setConfirming(true) : onChange(false))}
          ariaLabel={toggleAriaLabel}
          ariaDescribedBy={`${labelId} ${descriptionId}`}
        />
      </div>
      {typeof document === "undefined" ? null : createPortal(
        <ModalPresence>
          {confirming ? (
            <AutomaticCloseConfirmDialog layer="app" petEnabled={petEnabled} windows={hostPlatform === "windows"}
              onCancel={() => setConfirming(false)}
              onConfirm={() => { setConfirming(false); onChange(true); }} />
          ) : null}
        </ModalPresence>,
        document.body,
      )}
    </div>
  );
}
