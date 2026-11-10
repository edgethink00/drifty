export type DayWeekPeriod = "Today" | "Week";

export function DayWeekToggle({
  ariaLabel,
  dayLabel,
  period,
  weekLabel,
  onChange,
}: {
  readonly ariaLabel: string;
  readonly dayLabel: string;
  readonly period: DayWeekPeriod;
  readonly weekLabel: string;
  readonly onChange: (period: DayWeekPeriod) => void;
}) {
  return (
    <div className="seg day-week-toggle" role="group" aria-label={ariaLabel}>
      {(["Today", "Week"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={period === value}
          className={period === value ? "on" : undefined}
          onClick={() => onChange(value)}
        >
          {value === "Today" ? dayLabel : weekLabel}
        </button>
      ))}
    </div>
  );
}
