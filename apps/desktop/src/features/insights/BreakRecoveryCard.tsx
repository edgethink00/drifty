import { EmptyState } from "../../components/EmptyState";
import type { BreakRecoveryInsight } from "../companion/driftAlarmRecovery";
import { useLocalization } from "../localization/LocalizationContext";
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
  const { effectiveLanguage, t } = useLocalization();
  const hasData = actionTotal(summary) > 0 || summary.totalBreaks > 0;
  const bestBreakLabel = summary.bestBreak === null ? "—" : effectiveLanguage === "ko" ? `${summary.bestBreak.minutes}분` : `${summary.bestBreak.minutes}m`;
  const bestBreakDetail = summary.bestBreak === null
    ? t("trends.noReliableLength")
    : t("trends.recoveredSamples", { rate: formatRate(summary.bestBreak.recoveryRate), count: summary.bestBreak.resolvedBreaks });
  const totalActions = actionTotal(summary);
  const metricItems = [
    {
      label: t("trends.recoveryRate"),
      value: formatRate(summary.recoveryRate),
      detail: t("trends.breakCount", { resolved: summary.resolvedBreaks, total: summary.totalBreaks }),
    },
    {
      label: t("trends.bestBreak"),
      value: bestBreakLabel,
      detail: bestBreakDetail,
    },
    {
      label: t("trends.breakStarts"),
      value: String(summary.actionCounts.start_break),
      detail: t("trends.returnClicks", { count: summary.actionCounts.return_to_focus }),
    },
    {
      label: t("trends.corrections"),
      value: String(summary.actionCounts.manual_correction),
      detail: t("trends.settingsOpens", { count: summary.actionCounts.settings }),
    },
  ] satisfies readonly MetricItem[];
  const outcomeItems = [
    { label: t("trends.outcome.recovered"), value: summary.outcomeCounts.recovered, total: summary.totalBreaks, tone: "success" },
    { label: t("trends.outcome.sameDrift"), value: summary.outcomeCounts.same_drift_continued, total: summary.totalBreaks, tone: "warning" },
    { label: t("trends.outcome.shifted"), value: summary.outcomeCounts.drift_shifted, total: summary.totalBreaks, tone: "neutral" },
    { label: t("trends.outcome.excluded"), value: summary.outcomeCounts.unknown, total: summary.totalBreaks, tone: "muted" },
  ] satisfies readonly DistributionItem[];
  const actionItems = [
    { label: t("trends.action.takeBreak"), value: summary.actionCounts.start_break, total: totalActions, tone: "action" },
    { label: t("trends.action.returnFocus"), value: summary.actionCounts.return_to_focus, total: totalActions, tone: "success" },
    { label: t("trends.action.manualCorrection"), value: summary.actionCounts.manual_correction, total: totalActions, tone: "neutral" },
    { label: t("trends.action.settings"), value: summary.actionCounts.settings, total: totalActions, tone: "muted" },
    { label: t("trends.action.dismissed"), value: summary.actionCounts.dismiss, total: totalActions, tone: "warning" },
  ] satisfies readonly DistributionItem[];

  return (
    <section className="break-recovery-card editorial-panel editorial-panel--soft" aria-label={t("trends.breakRecovery")}>
      <div className="break-recovery-card__header">
        <h2>{t("trends.breakRecovery")}</h2>
        <div className="break-recovery-card__header-stat">
          <strong>{t("trends.breakRecoveryResolved", { count: summary.resolvedBreaks })}</strong>
          <span>{t("trends.breakRecoveryAttempts", { count: summary.totalBreaks })}</span>
          <span className="break-recovery-card__header-pill">{t("trends.breakRecoveryShifted", { count: summary.outcomeCounts.drift_shifted })}</span>
          <span className="break-recovery-card__header-pill">{t("trends.breakRecoveryExcluded", { count: summary.outcomeCounts.unknown })}</span>
        </div>
      </div>

      {!hasData ? (
        <EmptyState
          title={t("trends.breakRecoveryEmpty")}
          detail={t("trends.breakRecoveryEmptyDetail")}
        />
      ) : (
        <div className="break-recovery-card__compact-grid" aria-label={t("trends.breakRecoverySummaryAria")}>
          <div className="break-recovery-card__summary-grid">
            {metricItems.map((item) => (
              <div className="break-recovery-card__metric" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>

          <DistributionGroup title={t("trends.attemptOutcomes")} totalLabel={t("trends.totalCount", { count: summary.totalBreaks })} items={outcomeItems} />
          <DistributionGroup title={t("trends.alarmActions")} totalLabel={t("trends.pressCount", { count: totalActions })} items={actionItems} />
        </div>
      )}
    </section>
  );
}
