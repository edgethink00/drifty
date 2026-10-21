import { useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { ActionLabel } from "../../components/ActionLabel";
import { useLocalization } from "../localization/LocalizationContext";
import { SettingsRowDescription } from "./SettingsRowDescription";
import {
  authorizeGoogleCalendar,
  disconnectGoogleCalendar,
  discardPendingGoogleCalendarConnection,
  finalizeGoogleCalendarConnection,
  getGoogleCalendarCapability,
  getGoogleCalendarStatus,
  isGoogleCalendarAuthorizationCancelled,
  isGoogleCalendarOnboardingEnabled,
  notifyGoogleCalendarConnectionChanged,
  type GoogleCalendarStatus,
} from "../calendar/googleCalendarClient";

export function GoogleCalendarSettings() {
  const { hasRequiredAccountAuth, user } = useAuth();
  const userId = user?.id;
  const { t } = useLocalization();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!isGoogleCalendarOnboardingEnabled() || !hasRequiredAccountAuth || !userId) {
      setAvailable(false);
      setStatus(null);
      return () => {
        active = false;
      };
    }

    void getGoogleCalendarCapability()
      .then(async (capability) => {
        if (!active) return;
        setAvailable(capability.configured);
        if (!capability.configured) return;
        const nextStatus = await getGoogleCalendarStatus(userId);
        if (active) setStatus(nextStatus);
      })
      .catch(() => {
        if (active) {
          setAvailable(false);
          setStatus(null);
        }
      });
    return () => {
      active = false;
    };
  }, [hasRequiredAccountAuth, userId]);

  if (available !== true || !hasRequiredAccountAuth || !user) return null;

  const connect = async () => {
    if (busy || !userId) return;
    setBusy(true);
    setError(null);
    let attemptId: string | null = null;
    try {
      const authorization = await authorizeGoogleCalendar("connect");
      attemptId = authorization.attemptId;
      const nextStatus = await finalizeGoogleCalendarConnection(
        userId,
        authorization.attemptId,
        "connect",
      );
      attemptId = null;
      setStatus(nextStatus);
      notifyGoogleCalendarConnectionChanged();
      if (!nextStatus.connected) {
        setError(t("settings.account.calendarSkipped"));
      }
    } catch (connectError) {
      if (attemptId) {
        try {
          await discardPendingGoogleCalendarConnection(attemptId);
        } catch {
        }
      }
      setError(isGoogleCalendarAuthorizationCancelled(connectError)
        ? t("settings.account.calendarCancelled")
        : t("settings.account.calendarConnectFailed"));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy || !userId) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await disconnectGoogleCalendar(userId));
      notifyGoogleCalendarConnectionChanged();
    } catch {
      setError(t("settings.account.calendarDisconnectFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-row settings-row--stacked-action google-calendar-settings">
      <div>
        <div className="lbl">{t("settings.account.googleCalendar")}</div>
        <SettingsRowDescription
          description={status?.connected
            ? t("settings.account.calendarConnected", {
              email: status.connectedEmail ?? t("settings.account.calendarConnectedAccount"),
            })
            : t("settings.account.calendarDescription")}
          notice={error}
        />
      </div>
      <div className="ctrl">
        <button
          type="button"
          className="settings-btn"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void (status?.connected ? disconnect() : connect())}
        >
          <ActionLabel
            busy={busy}
            busyLabel={t("settings.account.calendarWorking")}
            reserve={[t(status?.connected ? "settings.account.calendarConnect" : "settings.account.calendarDisconnect")]}
          >
            {status?.connected ? t("settings.account.calendarDisconnect") : t("settings.account.calendarConnect")}
          </ActionLabel>
        </button>
      </div>
    </div>
  );
}
