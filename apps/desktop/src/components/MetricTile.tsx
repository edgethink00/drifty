export function MetricTile({ label, value, detail, className }: { label: string; value: string; detail?: string; className?: string }) {
  const tileClassName = ["metric-tile", className].filter(Boolean).join(" ");

  return (<div className={tileClassName}><span className="eyebrow">{label}</span><strong>{value}</strong>{detail ? <p>{detail}</p> : null}</div>);
}
