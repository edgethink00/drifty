import { EmptyState } from "../../components/EmptyState";
import type { BreakRecoveryInsight } from "../companion/driftAlarmRecovery";
import "./breakRecoveryCard.css";

type BreakRecoveryCardProps = {
  readonly summary: BreakRecoveryInsight;
};

type MetricItem = {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
};

type DistributionTone = "success" | "warning" | "neutral" | "muted" | "action";

type DistributionItem = {
  readonly label: string;
  readonly value: number;
  readonly total: number;
  readonly tone: DistributionTone;
};

const formatRate = (value: number | null): string => {
  if (value === null) {
    return "—";
  }

  return `${Math.round(value * 100)}%`;
};

const actionTotal = (summary: BreakRecoveryInsight): number =>
  Object.values(summary.actionCounts).reduce((total, count) => total + count, 0);

const barWidth = (value: number, total: number): string => {
  if (value <= 0 || total <= 0) {
    return "0%";
  }

  return `${Math.max(6, Math.round((value / total) * 100))}%`;
};

function DistributionGroup({
  title,
  totalLabel,
  items,
}: {
  readonly title: string;
  readonly totalLabel: string;
  readonly items: readonly DistributionItem[];
}) {
  return (
    <div className="break-recovery-card__distribution">
      <div className="break-recovery-card__distribution-head">
        <span>{title}</span>
        <small>{totalLabel}</small>
      </div>
      <div className="break-recovery-card__rows">
        {items.map((item) => (
          <div className="break-recovery-card__distribution-row" key={item.label}>
            <span>{item.label}</span>
            <div className="break-recovery-card__bar" aria-hidden="true">
              <span
                className={`break-recovery-card__bar-fill break-recovery-card__bar-fill--${item.tone}`}
                style={{ width: barWidth(item.value, item.total) }}
              />
            </div>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BreakRecoveryCard({ summary }: BreakRecoveryCardProps) {
  const hasData = actionTotal(summary) > 0 || summary.totalBreaks > 0;
  const bestBreakLabel = summary.bestBreak === null ? "—" : `${summary.bestBreak.minutes}m`;
  const bestBreakDetail = summary.bestBreak === null
    ? "No reliable length"
    : `${formatRate(summary.bestBreak.recoveryRate)} recovered, ${summary.bestBreak.resolvedBreaks} samples`;
  const totalActions = actionTotal(summary);
  const metricItems = [
    {
      label: "Recovery rate",
      value: formatRate(summary.recoveryRate),
      detail: `${summary.resolvedBreaks} of ${summary.totalBreaks} breaks`,
    },
    {
      label: "Best break",
      value: bestBreakLabel,
      detail: bestBreakDetail,
    },
    {
      label: "Break starts",
      value: String(summary.actionCounts.start_break),
      detail: `${summary.actionCounts.return_to_focus} return clicks`,
    },
    {
      label: "Corrections",
      value: String(summary.actionCounts.manual_correction),
      detail: `${summary.actionCounts.settings} settings opens`,
    },
  ] satisfies readonly MetricItem[];
  const outcomeItems = [
    { label: "Recovered", value: summary.outcomeCounts.recovered, total: summary.totalBreaks, tone: "success" },
    { label: "Same drift", value: summary.outcomeCounts.same_drift_continued, total: summary.totalBreaks, tone: "warning" },
    { label: "Shifted", value: summary.outcomeCounts.drift_shifted, total: summary.totalBreaks, tone: "neutral" },
    { label: "Excluded", value: summary.outcomeCounts.unknown, total: summary.totalBreaks, tone: "muted" },
  ] satisfies readonly DistributionItem[];
  const actionItems = [
    { label: "Take a break", value: summary.actionCounts.start_break, total: totalActions, tone: "action" },
    { label: "Return to focus", value: summary.actionCounts.return_to_focus, total: totalActions, tone: "success" },
    { label: "Manual correction", value: summary.actionCounts.manual_correction, total: totalActions, tone: "neutral" },
    { label: "Settings", value: summary.actionCounts.settings, total: totalActions, tone: "muted" },
    { label: "Dismissed", value: summary.actionCounts.dismiss, total: totalActions, tone: "warning" },
  ] satisfies readonly DistributionItem[];

  return (
    <section className="break-recovery-card editorial-panel editorial-panel--soft" aria-label="Break recovery">
      <div className="break-recovery-card__header">
        <h2>Break recovery</h2>
        <div className="break-recovery-card__header-stat">
          <strong>{summary.resolvedBreaks} resolved</strong>
          <span>{summary.totalBreaks} attempts</span>
          <span className="break-recovery-card__header-pill">{summary.outcomeCounts.drift_shifted} shifted</span>
          <span className="break-recovery-card__header-pill">{summary.outcomeCounts.unknown} excluded</span>
        </div>
      </div>

      {!hasData ? (
        <EmptyState
          title="No break recovery yet"
          detail="Use Take a break from a drift alarm to start building this trend."
        />
      ) : (
        <div className="break-recovery-card__compact-grid" aria-label="Break recovery dense summary">
          <div className="break-recovery-card__summary-grid">
            {metricItems.map((item) => (
              <div className="break-recovery-card__metric" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>

          <DistributionGroup title="Attempt outcomes" totalLabel={`${summary.totalBreaks} total`} items={outcomeItems} />
          <DistributionGroup title="Alarm actions" totalLabel={`${totalActions} presses`} items={actionItems} />
        </div>
      )}
    </section>
  );
}
