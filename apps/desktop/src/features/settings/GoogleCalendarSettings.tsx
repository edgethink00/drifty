import { useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { useLocalization } from "../localization/LocalizationContext";
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
        <div className="desc">
          {status?.connected
            ? t("settings.account.calendarConnected", {
              email: status.connectedEmail ?? t("settings.account.calendarConnectedAccount"),
            })
            : t("settings.account.calendarDescription")}
        </div>
        {error ? <p className="capture-recency capture-recency--error" role="alert">{error}</p> : null}
      </div>
      <div className="ctrl">
        <button
          type="button"
          className="settings-btn"
          disabled={busy}
          onClick={() => void (status?.connected ? disconnect() : connect())}
        >
          {busy
            ? t("settings.account.calendarWorking")
            : status?.connected
              ? t("settings.account.calendarDisconnect")
              : t("settings.account.calendarConnect")}
        </button>
      </div>
    </div>
  );
}
