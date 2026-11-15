import { useLocalization } from "../localization/LocalizationContext";
import { ExternalLinkIcon } from "../../components/ExternalLinkIcon";
import { currentTimeZone, isPhoneAppSettingsShown, openAndroidWaitlist } from "../sidebar/phoneAppCtaSlot";
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
 * Settings > Sync > Phone: the lasting home of the iPhone app's QR code,
 * shown as one settings row with the minimum: name, price and the code, and
 * an Android row that points to the waitlist until that app exists. It
 * appears on the release date (nothing about the pre-order) and, unlike the
 * sidebar card, has no close button and does not retire.
 */
export function PhoneAppSettingsBlock({ now = new Date(), timeZone = currentTimeZone() }: PhoneAppSettingsBlockProps) {
  const { effectiveLanguage, t } = useLocalization();
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
      <div className="settings-row phone-app-settings phone-app-settings--android">
        <div>
          <div className="lbl">{t("settings.phoneApp.androidTitle")}</div>
          <div className="desc">{t("settings.phoneApp.androidStatus")}</div>
        </div>
        <div className="ctrl">
          <button
            type="button"
            className="settings-btn phone-app-settings__android-action"
            onClick={() => { void openAndroidWaitlist(effectiveLanguage, "settings").catch(() => undefined); }}
          >
            {t("settings.phoneApp.androidAction")}
            <ExternalLinkIcon className="phone-app-settings__external" />
          </button>
        </div>
      </div>
    </div>
  );
}
