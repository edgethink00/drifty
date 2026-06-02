import type { HourBucket } from "@dtime/domain";
import { SummaryBars } from "@dtime/charts";

export function HourlySummaryView({ buckets }: { buckets: HourBucket[] }) {
  const activeBuckets = buckets.filter((bucket) => bucket.totalSeconds > 0);
  const sourceBuckets = activeBuckets.length > 0 ? activeBuckets : buckets;
  const totalSeconds = activeBuckets.reduce((sum, bucket) => sum + bucket.totalSeconds, 0);
  const peakBucket = activeBuckets.reduce<HourBucket | null>(
    (current, bucket) => (current === null || bucket.totalSeconds > current.totalSeconds ? bucket : current),
    null,
  );
  const averageSeconds = activeBuckets.length > 0 ? Math.round(totalSeconds / activeBuckets.length) : 0;
  const peakLabel = peakBucket ? peakBucket.hour.slice(11, 16) : "—";

  return (
    <div className="hourly-summary-shell">
      <h3>Hourly breakdown</h3>
      <p className="muted">Tracked time by local hour.</p>
      {activeBuckets.length > 0 ? (
        <div className="hourly-summary-brief">
          <div className="hourly-summary-brief__lead">
            <span className="eyebrow">Selected day</span>
            <strong>
              {peakBucket
                ? `${peakLabel} is the longest tracked hour.`
                : "No tracked hour yet."}
            </strong>
            <p>
              {peakBucket
                ? `${formatSummaryMetric(totalSeconds)} across ${activeBuckets.length} ${activeBuckets.length === 1 ? "hour" : "hours"} with activity. Average active hour: ${formatSummaryMetric(averageSeconds)}.`
                : "Hourly totals appear after activity is recorded."}
            </p>
          </div>
          <div className="hourly-summary-ribbon" aria-label="Hourly summary highlights">
            <div className="hourly-summary-pill">
              <span>Longest hour</span>
              <strong>{peakLabel}</strong>
            </div>
            <div className="hourly-summary-pill">
              <span>Active hours</span>
              <strong>{activeBuckets.length}h</strong>
            </div>
            <div className="hourly-summary-pill">
              <span>Average active hour</span>
              <strong>{formatSummaryMetric(averageSeconds)}</strong>
            </div>
          </div>
        </div>
      ) : null}
      <SummaryBars
        items={sourceBuckets.map((bucket) => ({
          label: bucket.hour.slice(11, 16),
          value: bucket.totalSeconds,
        }))}
        scaleLabel="Tracked time"
        maxValueLabel={peakBucket ? `Longest hour ${peakLabel} · ${formatSummaryMetric(peakBucket.totalSeconds)}` : undefined}
      />
    </div>
  );
}

function formatSummaryMetric(value: number) {
  if (value <= 0) return "—";

  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}h`;

  return `${hours}h ${remainingMinutes}m`;
}
