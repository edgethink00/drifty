import { useCallback, useEffect, useState } from "react";

import { Toggle } from "../../components/Toggle";
import { openSystemSettingsPane } from "../../lib/api/systemSettingsClient";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import {
  getMacCalendarAuthorization,
  isMacCalendarEnabled,
  requestMacCalendarAccess,
  setMacCalendarEnabled,
  type MacCalendarAuthorization,
} from "../calendar/macCalendarClient";
import { SettingsRowDescription } from "./SettingsRowDescription";

export const MAC_CALENDAR_SETTING_ID = "settings.macCalendar.enabled";

const BLOCKED_NOTICE: Partial<Record<MacCalendarAuthorization, TranslationKey>> = {
  denied: "settings.macCalendar.denied",
  restricted: "settings.macCalendar.restricted",
  writeOnly: "settings.macCalendar.writeOnly",
};

/**
 * Turns the Mac Calendar overlay on or off. macOS asks for access only when
 * the person turns it on; a later refusal leaves the setting off and points
 * to System Settings, where access is granted or revoked.
 */
export function MacCalendarSettings() {
  const { t } = useLocalization();
  const [authorization, setAuthorization] = useState<MacCalendarAuthorization | null>(null);
  const [enabled, setEnabled] = useState(isMacCalendarEnabled);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setAuthorization(await getMacCalendarAuthorization());
    } catch {
      setAuthorization("unsupported");
    }
    setEnabled(isMacCalendarEnabled());
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  if (authorization === null || authorization === "unsupported") return null;

  const blockedNotice = BLOCKED_NOTICE[authorization];
  const checked = enabled && authorization === "granted";

  const change = async (next: boolean) => {
    setFailed(false);
    if (!next) {
      setMacCalendarEnabled(false);
      setEnabled(false);
      return;
    }
    setBusy(true);
    try {
      const result = await requestMacCalendarAccess();
      setAuthorization(result);
      const granted = result === "granted";
      setMacCalendarEnabled(granted);
      setEnabled(granted);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const notice = failed
    ? t("settings.macCalendar.failed")
    : blockedNotice
      ? t(blockedNotice)
      : null;

  return (
    <div className="settings-block">
      <h3>{t("settings.macCalendar.section")}</h3>
      <div data-setting-id={MAC_CALENDAR_SETTING_ID} className="settings-row settings-row--stacked-action">
        <div>
          <div className="lbl">{t("settings.macCalendar.title")}</div>
          <SettingsRowDescription description={t("settings.macCalendar.description")} notice={notice} />
          {blockedNotice ? (
            <button
              type="button"
              className="settings-inline-link"
              onClick={() => void openSystemSettingsPane("calendars")}
            >
              {t("settings.macCalendar.openSettings")}
            </button>
          ) : null}
        </div>
        <div className="ctrl">
          <Toggle
            checked={checked}
            disabled={busy || Boolean(blockedNotice)}
            onChange={(next) => void change(next)}
            ariaLabel={t("settings.macCalendar.title")}
          />
        </div>
      </div>
    </div>
  );
}
