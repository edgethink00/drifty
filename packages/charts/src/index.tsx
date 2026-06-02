import type { ReactNode } from "react";
export { SummaryBars } from "./summary-bars";

export interface SimpleBarDatum {
  label: string;
  value: number;
  helper?: ReactNode;
}

export function SimpleBarChart({
  data,
}: {
  data: SimpleBarDatum[];
}) {
  const max = Math.max(...data.map((entry) => entry.value), 1);

  return (
    <div className="chart">
      {data.map((entry) => (
        <div className="chart__row" key={entry.label}>
          <div className="chart__meta">
            <span>{entry.label}</span>
            <strong>{Math.round((entry.value / 60) * 10) / 10}m</strong>
          </div>
          <div className="chart__track">
            <div
              className="chart__fill"
              style={{ width: `${(entry.value / max) * 100}%` }}
            />
          </div>
          {entry.helper ? <div className="chart__helper">{entry.helper}</div> : null}
        </div>
      ))}
    </div>
  );
}
