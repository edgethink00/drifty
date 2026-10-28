import driftyIcon from "../../../assets/drifty-icon.png";
import { useLocalization } from "../../localization/LocalizationContext";
import { useAccessibilityPaneIsDeviceControl } from "../../../lib/api/accessibilityPaneName";

/**
 * A picture of the macOS Accessibility settings list with drifty's switch turning on, shown
 * beside the Permissions step so people know what they are looking for once System Settings
 * opens. The other rows are placeholders; nothing here reads the real settings. Decorative:
 * hidden from assistive technology, the step's own copy carries the instructions.
 */
export function AccessibilitySettingsPreview({ granted }: { readonly granted: boolean }) {
  const { t } = useLocalization();
  const deviceControl = useAccessibilityPaneIsDeviceControl();
  return (
    <div className="onb-ax-preview" aria-hidden="true" data-granted={granted ? "true" : "false"}>
      <div className="onb-ax-preview__window">
        <div className="onb-ax-preview__toolbar">
          <span className="onb-ax-preview__nav">
            <svg viewBox="0 0 24 24"><path d="m14.5 6-6 6 6 6" /></svg>
            <i />
            <svg viewBox="0 0 24 24"><path d="m9.5 6 6 6-6 6" /></svg>
          </span>
          <span className="onb-ax-preview__title">{t(deviceControl ? "settings.permissions.deviceControl" : "settings.permissions.accessibility")}</span>
        </div>
        <div className="onb-ax-preview__list">
          <div className="onb-ax-preview__row onb-ax-preview__row--app">
            <img className="onb-ax-preview__icon" src={driftyIcon} alt="" />
            <span className="onb-ax-preview__name">drifty</span>
            <span className="onb-ax-preview__switch"><i /></span>
          </div>
          <div className="onb-ax-preview__row onb-ax-preview__row--other">
            <span className="onb-ax-preview__icon" />
            <span className="onb-ax-preview__bar" style={{ width: "34%" }} />
            <span className="onb-ax-preview__switch onb-ax-preview__switch--on"><i /></span>
          </div>
          <div className="onb-ax-preview__row onb-ax-preview__row--other">
            <span className="onb-ax-preview__icon" />
            <span className="onb-ax-preview__bar" style={{ width: "24%" }} />
            <span className="onb-ax-preview__switch onb-ax-preview__switch--on"><i /></span>
          </div>
          <div className="onb-ax-preview__footer"><span>+</span><span>−</span></div>
        </div>
      </div>
    </div>
  );
}
