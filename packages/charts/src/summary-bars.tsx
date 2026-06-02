import React from "react";

export function SummaryBars({
  items,
  scaleLabel,
  maxValueLabel,
}: {
  items: Array<{ label: string; value: number }>;
  scaleLabel?: string;
  maxValueLabel?: string;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <div className="bars">
      {scaleLabel || maxValueLabel ? (
        <div className="bars__meta">
          <span>{scaleLabel ?? "Scale"}</span>
          {maxValueLabel ? <strong>{maxValueLabel}</strong> : null}
        </div>
      ) : null}
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <div className="bar-row__label">
            <span>{item.label}</span>
          </div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${Math.max((item.value / max) * 100, item.value > 0 ? 6 : 0)}%` }}
            />
          </div>
          <div className="bar-row__value">
            <strong>{formatSummaryBarValue(item.value)}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatSummaryBarValue(value: number) {
  if (value < 60) return `${value}s`;

  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}h`;

  return `${hours}h ${remainingMinutes}m`;
}
