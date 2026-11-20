import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ModalPresence } from "../../components/ModalPresence";
import type { HostPlatform } from "../../lib/api/accessibilityClient";
import type { AutoCloseMode } from "../focus-session/focusSession";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import { AutomaticCloseConfirmDialog } from "../onboarding/AutomaticCloseConfirmDialog";
import { SettingsSelect } from "./SettingsSelect";

export const AUTO_CLOSE_MODE_OPTIONS: readonly { readonly value: AutoCloseMode; readonly label: TranslationKey; readonly description: TranslationKey }[] = [
  { value: "off", label: "autoClose.mode.off", description: "autoClose.mode.offDescription" },
  { value: "session", label: "autoClose.mode.session", description: "autoClose.mode.sessionDescription" },
  { value: "always", label: "autoClose.mode.always", description: "autoClose.mode.alwaysDescription" },
];

/**
 * Automatic close as one choice: Off, During focus sessions or Always. Turning it on from Off asks
 * first, with the same consent the post-setup intro uses; moving between the two on choices or to
 * Off applies at once.
 */
export function AutomaticCloseSettingsRow({
  mode,
  onModeChange,
  className,
  label,
  children,
  petEnabled = false,
  hostPlatform = "macos",
}: {
  readonly mode: AutoCloseMode;
  readonly onModeChange: (mode: AutoCloseMode) => void;
  readonly className?: string;
  readonly label?: string;
  readonly children?: ReactNode;
  /** The desktop cat's switch: with the cat on, the consent preview shows the cat closing the tab. */
  readonly petEnabled?: boolean;
  readonly hostPlatform?: HostPlatform;
}) {
  const { t } = useLocalization();
  const [confirming, setConfirming] = useState<AutoCloseMode | null>(null);
  const reactId = useId().replace(/:/g, "");
  const labelId = `automatic-close-label-${reactId}`;
  const descriptionId = `automatic-close-desc-${reactId}`;
  const rowClassName = ["settings-row", className].filter(Boolean).join(" ");
  const current = AUTO_CLOSE_MODE_OPTIONS.find((option) => option.value === mode) ?? AUTO_CLOSE_MODE_OPTIONS[0];
  const title = label ?? t("settings.notifications.extreme");
  return (
    <div data-setting-id="settings.notifications.extreme" className={rowClassName}>
      <div>
        <div className="lbl settings-label-with-badge" id={labelId}>{title} <span className="status-badge status-badge--beta">{t("common.beta")}</span></div>
        <div className="desc" id={descriptionId}>{t(current.description)}</div>
        {children}
      </div>
      <div className="ctrl">
        <SettingsSelect
          ariaLabel={title}
          value={mode}
          options={AUTO_CLOSE_MODE_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
          onChange={(next) => {
            const value = next as AutoCloseMode;
            if (value !== "off" && mode === "off") setConfirming(value);
            else onModeChange(value);
          }}
        />
      </div>
      {typeof document === "undefined" ? null : createPortal(
        <ModalPresence>
          {confirming ? (
            <AutomaticCloseConfirmDialog layer="app" petEnabled={petEnabled} windows={hostPlatform === "windows"}
              sessionOnly={confirming === "session"}
              onCancel={() => setConfirming(null)}
              onConfirm={() => { onModeChange(confirming); setConfirming(null); }} />
          ) : null}
        </ModalPresence>,
        document.body,
      )}
    </div>
  );
}
