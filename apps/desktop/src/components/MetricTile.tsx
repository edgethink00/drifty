import type { ReactNode } from "react";

/**
 * `detailTitle` and `valueTitle` repeat text that can be cut off (an app name) as its hover title.
 * `action` is a control placed in the tile, such as a team board tile's metric menu.
 */
export function MetricTile({ label, value, detail, detailTitle = false, valueTitle = false, className, action }: { label: string; value: string; detail?: string; detailTitle?: boolean; valueTitle?: boolean; className?: string; action?: ReactNode }) {
  const tileClassName = ["metric-tile", className].filter(Boolean).join(" ");

  return (<div className={tileClassName}><span className="eyebrow">{label}</span><strong title={valueTitle ? value : undefined}>{value}</strong>{detail ? <p title={detailTitle ? detail : undefined}>{detail}</p> : null}{action}</div>);
}
