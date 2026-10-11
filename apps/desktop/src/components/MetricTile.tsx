/** `detailTitle` repeats a detail that can be cut off (an app name) as its hover title. */
export function MetricTile({ label, value, detail, detailTitle = false, className }: { label: string; value: string; detail?: string; detailTitle?: boolean; className?: string }) {
  const tileClassName = ["metric-tile", className].filter(Boolean).join(" ");

  return (<div className={tileClassName}><span className="eyebrow">{label}</span><strong>{value}</strong>{detail ? <p title={detailTitle ? detail : undefined}>{detail}</p> : null}</div>);
}
