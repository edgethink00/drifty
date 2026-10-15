/**
 * A project's time over the latest days as a small line, scaled to its own
 * busiest day so the shape reads at any size; the time column carries the size.
 */
export function ProjectSparkline({ values, color, label }: {
  readonly values: readonly number[];
  readonly color: string;
  readonly label?: string;
}): JSX.Element | null {
  if (values.length < 2) return null;
  const width = 64;
  const height = 18;
  const pad = 2;
  const max = Math.max(0, ...values);
  const step = (width - pad * 2) / (values.length - 1);
  const points = values.map((value, index) => [
    pad + index * step,
    max > 0 ? height - pad - (value / max) * (height - pad * 2) : height - pad,
  ] as const);
  const line = points.map(([x, y]) => x.toFixed(1) + "," + y.toFixed(1)).join(" ");
  const last = points[points.length - 1]!;
  return (
    <svg
      className="pt-spark"
      viewBox={"0 0 " + width + " " + height}
      width={width}
      height={height}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {/* Colors go in style so a CSS variable works as well as a hex value. */}
      <polygon points={pad + "," + (height - pad) + " " + line + " " + (width - pad) + "," + (height - pad)} style={{ fill: color }} opacity="0.12" />
      <polyline points={line} fill="none" style={{ stroke: color }} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="1.8" style={{ fill: color }} />
    </svg>
  );
}
