import { useLocalization } from "../localization/LocalizationContext";
import { currentTimeZone, isPhoneAppSettingsShown } from "../sidebar/phoneAppCtaSlot";
/*
 * Encodes phoneAppStoreUrl("drifty_desktop_settings"). Regenerate with
 *   npx qrcode@1.5.4 -t svg -e M -q 2 -d "#111111" -l "#ffffff" -o iphone-app-store-qr-settings.svg "<url>"
 * when that link changes, then scan the result before committing it. The code
 * is 45 modules with its quiet zone, so 90px keeps every module on whole pixels.
 */
import settingsQrUrl from "../../assets/iphone-app-store-qr-settings.svg";
import "./PhoneAppSettingsBlock.css";

export const PHONE_APP_SETTING_ID = "settings.phoneApp.section";

type PhoneAppSettingsBlockProps = {
  readonly now?: Date;
  readonly timeZone?: string | null;
};

/**
 * Settings > Sync > iPhone: the lasting home of the iPhone app's QR code,
 * shown as one settings row with the minimum: name, price and the code. It
 * appears on the release date (nothing about the pre-order) and, unlike the
 * sidebar card, has no close button and does not retire.
 */
export function PhoneAppSettingsBlock({ now = new Date(), timeZone = currentTimeZone() }: PhoneAppSettingsBlockProps) {
  const { t } = useLocalization();
  if (!isPhoneAppSettingsShown(now, timeZone)) return null;

  return (
    <div data-setting-id={PHONE_APP_SETTING_ID} className="settings-block settings-block--phone-app">
      <h3>{t("settings.phoneApp.section")}</h3>
      <div className="settings-row phone-app-settings">
        <div>
          <div className="lbl">{t("settings.phoneApp.title")}</div>
          <div className="desc">{t("settings.phoneApp.releasedStatus")}</div>
        </div>
        <div className="ctrl">
          <img
            className="phone-app-settings__qr"
            src={settingsQrUrl}
            alt={t("phoneApp.qr.imageLabel")}
            width={90}
            height={90}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
