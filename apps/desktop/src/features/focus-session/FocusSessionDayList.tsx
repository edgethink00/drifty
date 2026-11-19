import { formatLocalizedCalendarMinuteLabel, formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { compactClockRange } from "../dashboard/YourDayCardLane";
import { useLocalization } from "../localization/LocalizationContext";
import { useFocusSessionBands } from "./focusSessionBands";
import "./focusSessionDayList.css";

type DaySession = {
  readonly id: string;
  readonly pomodoro: boolean;
  readonly rounds: number;
  readonly range: string;
  readonly spanSeconds: number;
  readonly focusSeconds: number;
};

/**
 * The day's focus sessions at the bottom of the Day Breakdown (owner choice
 * 2026-11-18): a record that a session happened, after the apps list. The
 * head carries the focus time inside sessions; each row names the session and
 * its clock range. Nothing shows on a day without a session.
 */
export function FocusSessionDayList({ day, startOfDayMinutes }: { readonly day: string; readonly startOfDayMinutes: number }) {
  const { effectiveLanguage, t } = useLocalization();
  const bands = useFocusSessionBands(day, startOfDayMinutes);
  if (bands.length === 0) return null;
  const clock = (minute: number) => formatLocalizedCalendarMinuteLabel(day, minute, effectiveLanguage, startOfDayMinutes);
  const compact = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, effectiveLanguage);
  const byId = new Map<string, DaySession>();
  for (const band of bands) {
    const seconds = (band.bottom - band.top) * 60;
    const previous = byId.get(band.sessionId);
    byId.set(band.sessionId, previous
      ? { ...previous, rounds: previous.rounds + 1, focusSeconds: previous.focusSeconds + seconds }
      : {
        id: band.sessionId,
        pomodoro: band.mode === "pomodoro",
        rounds: 1,
        range: compactClockRange(clock(band.sessionStart), clock(band.sessionEnd)),
        spanSeconds: (band.sessionEnd - band.sessionStart) * 60,
        focusSeconds: seconds,
      });
  }
  const sessions = [...byId.values()];
  const focusSeconds = sessions.reduce((sum, session) => sum + session.focusSeconds, 0);
  return (
    <section className="week-v2-side-card your-day-usage focus-session-day-list" aria-label={t("dashboard.today.focusSessionsTitle")}>
      <div className="flow-compact-split-chart__head">
        <span className="label-mono">{t("dashboard.today.focusSessionsTitle")}</span>
        <strong>{compact(focusSeconds)}</strong>
      </div>
      <ol className="your-day-usage__list focus-session-day-list__rows">
        {sessions.map((session) => (
          <li key={session.id}>
            <span className="your-day-usage__name">
              {session.pomodoro
                ? t("dashboard.today.focusSessionRounds", { count: session.rounds })
                : t("dashboard.today.focusSessionSingle", { duration: compact(session.spanSeconds) })}
            </span>
            <span className="focus-session-day-list__range">{session.range}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
