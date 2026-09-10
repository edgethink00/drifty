import { useLocalization } from "../localization/LocalizationContext";
import {
  COACH_MEANINGFUL_DAY_HOURS,
  COACH_REQUIRED_DAYS,
  COACH_REQUIRED_HOURS,
  type InsightsCoachReadiness,
} from "./insightsReadiness";

type InsightsCoachPanelProps = {
  readonly readiness: InsightsCoachReadiness;
};

/**
 * The coach tab before any coaching exists. It shows the two gates and the
 * user's real distance from them, and nothing else. No sample memo, no
 * placeholder sentence: a locked surface that pretends to have an opinion is
 * exactly the failure the earlier coach work was trying to avoid.
 */
export function InsightsCoachPanel({ readiness }: InsightsCoachPanelProps) {
  const { t } = useLocalization();
  const trackedHoursLabel = readiness.trackedHours >= 10
    ? String(Math.floor(readiness.trackedHours))
    : readiness.trackedHours.toFixed(1).replace(/\.0$/, "");

  return (
    <section
      className={`insights-coach-lock${readiness.isReady ? " is-ready" : ""}`}
      aria-label={t("trends.coach.lockedAria")}
    >
      <div className="insights-coach-lock__body">
        <h2 className="insights-coach-lock__title">
          {readiness.isReady ? t("trends.coach.readyTitle") : t("trends.coach.lockedTitle")}
        </h2>
        <p className="insights-coach-lock__lead">
          {readiness.isReady ? t("trends.coach.readyLead") : t("trends.coach.lockedLead")}
        </p>

        <div className="insights-coach-lock__gates">
          <CoachGate
            label={t("trends.coach.gateHours")}
            value={t("trends.coach.gateHoursValue", { tracked: trackedHoursLabel })}
            requirement={t("trends.coach.gateHoursNeeded", { required: String(COACH_REQUIRED_HOURS) })}
            progress={readiness.hoursProgress}
            done={readiness.hoursProgress >= 1}
            doneLabel={t("trends.coach.gateMet")}
          />
          <CoachGate
            label={t("trends.coach.gateDays")}
            value={t("trends.coach.gateDaysValue", { met: String(readiness.meaningfulDays) })}
            requirement={t("trends.coach.gateDaysNeeded", { required: String(COACH_REQUIRED_DAYS), hours: String(COACH_MEANINGFUL_DAY_HOURS) })}
            progress={readiness.daysProgress}
            done={readiness.daysProgress >= 1}
            doneLabel={t("trends.coach.gateMet")}
          />
        </div>

        <p className="insights-coach-lock__note">{t("trends.coach.localNote")}</p>
      </div>
    </section>
  );
}

function CoachGate({
  label,
  value,
  requirement,
  progress,
  done,
  doneLabel,
}: {
  readonly label: string;
  readonly value: string;
  readonly requirement: string;
  readonly progress: number;
  readonly done: boolean;
  readonly doneLabel: string;
}) {
  const percent = Math.round(progress * 100);
  return (
    <div className={`insights-coach-gate${done ? " is-met" : ""}`}>
      <div className="insights-coach-gate__head">
        <span className="insights-coach-gate__label">{label}</span>
        {done ? <span className="insights-coach-gate__met">{doneLabel}</span> : null}
      </div>
      <strong className="insights-coach-gate__value">{value}</strong>
      <div
        className="insights-coach-gate__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className="insights-coach-gate__fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="insights-coach-gate__requirement">{requirement}</span>
    </div>
  );
}
