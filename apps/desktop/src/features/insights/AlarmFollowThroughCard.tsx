import { useLocalization } from "../localization/LocalizationContext";
import {
  FOLLOW_THROUGH_MIN_FOCUS_MINUTES,
  FOLLOW_THROUGH_WINDOW_MINUTES,
  type AlarmFollowThrough,
  type AlarmFollowThroughPath,
} from "./alarmFollowThrough";

type AlarmFollowThroughCardProps = {
  readonly followThrough: AlarmFollowThrough;
};

const PATHS = [
  { id: "afterBreak", labelKey: "trends.followThrough.afterBreak", tone: "success" },
  { id: "returned", labelKey: "trends.followThrough.returned", tone: "action" },
  { id: "onOwn", labelKey: "trends.followThrough.onOwn", tone: "neutral" },
  { id: "noReturn", labelKey: "trends.followThrough.noReturn", tone: "warning" },
] as const satisfies readonly {
  readonly id: AlarmFollowThroughPath;
  readonly labelKey:
    | "trends.followThrough.afterBreak"
    | "trends.followThrough.returned"
    | "trends.followThrough.onOwn"
    | "trends.followThrough.noReturn";
  readonly tone: string;
}[];

/**
 * One rate for the whole alarm feature: after Drifty interrupted, did the drift
 * end? Every alarm counts, so it reads for people who dismiss as well as people
 * who take breaks. The path rows record what the user did before returning and
 * make no claim that the alarm caused it.
 */
export function AlarmFollowThroughCard({ followThrough }: AlarmFollowThroughCardProps) {
  const { effectiveLanguage, t } = useLocalization();
  const isKorean = effectiveLanguage === "ko";
  const requestedVariant = (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("alarmLayout")) ?? "split-led";
  const variant = ["summary", "share", "table"].includes(requestedVariant ?? "") ? requestedVariant! : "baseline";
  const finish = ["crisp", "soft", "ruled"].includes(requestedVariant ?? "") ? requestedVariant! : undefined;
  const structure = ["list-led", "split-led", "integrated"].includes(requestedVariant ?? "") ? requestedVariant! : undefined;
  const ratePercent = followThrough.rate === null ? "—" : `${Math.round(followThrough.rate * 100)}%`;
  const median = followThrough.medianMinutesToFocus;
  const medianLabel = median === null
    ? t("trends.followThrough.noMedian")
    : t("trends.followThrough.median", { duration: isKorean ? `${median}분` : effectiveLanguage === "es" ? `${median} min` : `${median}m` });

  return (
    <section
      className="alarm-follow-through editorial-panel editorial-panel--soft insight-section"
      data-alarm-layout={variant}
      data-alarm-finish={finish}
      data-alarm-structure={structure}
      aria-label={t("trends.followThrough.title")}
    >
      <div className="alarm-follow-through__head">
        <span className="alarm-follow-through__rate-label">
          {structure === "integrated" ? null : t("trends.followThrough.rateLabel")}
          <span className="alarm-follow-through__help">
            <button
              type="button"
              className="help-trigger alarm-follow-through__help-trigger"
              aria-label={t("trends.followThrough.ruleAria")}
              aria-describedby="alarm-follow-through-help"
            >
              ?
            </button>
            {/* The threshold stays reachable rather than printed: a wrapping
                sentence owned a third of a half-column card, but a rate whose
                rule cannot be found at all is the focus-profile mistake. */}
            <span className="alarm-follow-through__tip" id="alarm-follow-through-help" role="tooltip">
              {t("trends.followThrough.rule", {
                window: String(FOLLOW_THROUGH_WINDOW_MINUTES),
                minimum: String(FOLLOW_THROUGH_MIN_FOCUS_MINUTES),
              })}
            </span>
          </span>
        </span>
        <span className="alarm-follow-through__total">
          {t("trends.followThrough.alarmCount", { count: String(followThrough.totalAlarms) })}
        </span>
      </div>

      <div className="alarm-follow-through__lede">
        <div className="alarm-follow-through__metric">
          <strong>{ratePercent}</strong>
        </div>
        <p className="alarm-follow-through__median" title={medianLabel}>
          {variant === "baseline" && !structure ? medianLabel : <><span>{t("trends.followThrough.timeLabel")}</span> <strong>{median === null ? "—" : `${median}${isKorean ? "분" : "m"}`}</strong></>}
        </p>
      </div>

      {variant === "share" && <div className="alarm-follow-through__distribution" aria-hidden="true">
        {PATHS.map(path => <span key={path.id} className={`alarm-follow-through__fill alarm-follow-through__fill--${path.tone}`} style={{width: `${followThrough.totalAlarms > 0 ? followThrough.pathCounts[path.id] / followThrough.totalAlarms * 100 : 0}%`}} />)}
      </div>}

      <div className="alarm-follow-through__paths" aria-label={t("trends.followThrough.pathsAria")}>
        {structure === "integrated" && <div className="alarm-follow-through__rollup">
          <span>{t("trends.followThrough.rateLabel")}</span>
          <div className="alarm-follow-through__bar" aria-hidden="true"><span className="alarm-follow-through__fill alarm-follow-through__fill--success" style={{width: `${(followThrough.rate ?? 0) * 100}%`}} /></div>
          <strong>{ratePercent}</strong>
        </div>}
        {PATHS.map((path) => {
          const value = followThrough.pathCounts[path.id];
          const width = followThrough.totalAlarms > 0 ? (value / followThrough.totalAlarms) * 100 : 0;
          return (
            <div className="alarm-follow-through__row" key={path.id} data-tone={path.tone}>
              <div className="alarm-follow-through__meta">
                <span>{t(path.labelKey)}</span>
                <strong>{value}</strong>
              </div>
              <div className="alarm-follow-through__bar" aria-hidden="true">
                <span className={`alarm-follow-through__fill alarm-follow-through__fill--${path.tone}`} style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>

    </section>
  );
}
