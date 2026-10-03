import { useEffect, useId, useState } from "react";
import { Toggle } from "../../components/Toggle";
import { useLocalization } from "../localization/LocalizationContext";

type BlurMaterial = "active" | "opaque" | "pending";

function readBlurMaterial(): BlurMaterial {
  const { windowMaterial, windowsNativeBlur } = document.documentElement.dataset;
  if (windowMaterial === "translucent" && windowsNativeBlur === "active") return "active";
  if (windowMaterial === "solid") return "opaque";
  return "pending";
}

export function WindowsBlurPreviewRow({
  enabled,
  onEnabledChange,
}: {
  readonly enabled: boolean;
  readonly onEnabledChange: (enabled: boolean) => void;
}) {
  const { t } = useLocalization();
  const descriptionId = useId();
  const statusId = useId();
  const [material, setMaterial] = useState(readBlurMaterial);

  useEffect(() => {
    // The native health monitor changes these attributes directly when blur
    // fails. React props only record the user's preference, not native health.
    const root = document.documentElement;
    const refresh = () => setMaterial(readBlurMaterial());
    const observer = new MutationObserver(refresh);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-window-material", "data-windows-native-blur"],
    });
    refresh();
    return () => observer.disconnect();
  }, []);

  const statusKey = !enabled
    ? "settings.windowsBlur.off"
    : material === "active"
      ? "settings.windowsBlur.active"
      : material === "opaque"
        ? "settings.windowsBlur.opaque"
        : "settings.windowsBlur.pending";

  return (
    <div className="settings-row">
      <div>
        <div className="lbl">{t("settings.windowsBlur.title")}</div>
        <div className="desc" id={descriptionId}>{t("settings.windowsBlur.description")}</div>
        <div className="desc" id={statusId} role="status" aria-live="polite" aria-atomic="true">
          {t(statusKey)}
        </div>
      </div>
      <div className="ctrl">
        <Toggle
          checked={enabled}
          onChange={onEnabledChange}
          ariaLabel={t("settings.windowsBlur.toggle")}
          ariaDescribedBy={`${descriptionId} ${statusId}`}
        />
      </div>
    </div>
  );
}
