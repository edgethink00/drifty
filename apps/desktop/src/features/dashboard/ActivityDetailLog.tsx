import type { ActivityCardDetailRun, AppIconMap } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";

function clock(ms: number): string {
  const date = new Date(ms);
  return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}

/** Whole minutes that add up to the rounded total (largest remainder), so the lines sum like the header. */
export function allotWholeMinutes(seconds: readonly number[]): number[] {
  const raw = seconds.map((value) => value / 60);
  const minutes = raw.map(Math.floor);
  let left = Math.round(raw.reduce((total, value) => total + value, 0)) - minutes.reduce((total, value) => total + value, 0);
  const order = raw.map((value, index) => [value - minutes[index], index] as const).sort((a, b) => b[0] - a[0]);
  for (let position = 0; position < order.length && left > 0; position += 1, left -= 1) minutes[order[position][1]] += 1;
  return minutes;
}

type LogIdentity = { readonly id: string; readonly appName: string; readonly bundleId: string | null; readonly siteDomain: string | null };

/** The panel's line under the name: the stretch, its recorded time and its main apps. */
export function ActivityLogMeta({ startMs, endMs, recordedSeconds, identities, appIcons }: {
  readonly startMs: number;
  readonly endMs: number;
  readonly recordedSeconds: number;
  readonly identities: readonly LogIdentity[];
  readonly appIcons: AppIconMap;
}) {
  const { effectiveLanguage, t } = useLocalization();
  return (
    <div className="activity-log-meta">
      <span className="activity-log-meta__range">{clock(startMs)}–{clock(endMs)}</span>
      <span>{t("dashboard.activityDetail.recorded", { duration: formatLocalizedCompactDurationFromSeconds(recordedSeconds, effectiveLanguage) })}</span>
      {identities.length > 0 ? (
        <span className="activity-log-meta__icons" aria-hidden="true">
          {identities.slice(0, 3).map((identity) => {
            const iconSrc = appIcons[identity.bundleId ?? identity.appName] ?? appIcons[identity.appName] ?? null;
            return (
              <span key={identity.id}>
                {identity.siteDomain
                  ? <SiteFavicon domain={identity.siteDomain} size={16} fallbackIconSrc={iconSrc} />
                  : <AppGlyph appName={identity.appName} iconSrc={iconSrc} size="sm" />}
              </span>
            );
          })}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The block's activities in time order, one line per stretch, as Dayflow's detailed summary is:
 * start time, what it was (a second activity after a dot when it held a quarter of the line) and
 * its minutes. Lines known only by their app read a little softer. Nothing sits under anything.
 */
export function ActivityDetailLog({ runs }: { readonly runs: readonly ActivityCardDetailRun[] }) {
  const { effectiveLanguage, t } = useLocalization();
  if (runs.length === 0) return null;
  const minutes = allotWholeMinutes(runs.map((run) => run.totalSeconds));
  return (
    <section className="activity-detail-log" aria-label={t("dashboard.activityDetail.log")}>
      <h4 className="activity-detail-log__heading">{t("dashboard.activityDetail.log")}</h4>
      <ol className="activity-detail-log__list">
        {runs.map((run, index) => (
          <li
            key={run.startMs + ":" + run.label}
            className={run.kind === "app" ? "activity-detail-log__row activity-detail-log__row--app" : "activity-detail-log__row"}
          >
            <time dateTime={new Date(run.startMs).toISOString()}>{clock(run.startMs)}</time>
            <span className="activity-detail-log__name">
              {run.label}
              {run.also ? <span className="activity-detail-log__also"> · {run.also.label}</span> : null}
            </span>
            <strong>{formatLocalizedCompactDurationFromSeconds(Math.max(1, minutes[index]) * 60, effectiveLanguage)}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}
