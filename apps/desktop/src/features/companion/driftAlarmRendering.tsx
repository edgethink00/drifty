export function renderBreakReturnTitle(title: string, breakDurationLabel: string) {
  if (!title.startsWith(breakDurationLabel)) return <span>{title}</span>;
  const titleBody = title.slice(breakDurationLabel.length).trim();
  return (
    <>
      <span className="da__time-prefix">{breakDurationLabel}</span>
      <span>{titleBody || title}</span>
    </>
  );
}

export function renderBreakReturnSummary(summary: string, breakDurationLabel: string) {
  const breakDurationIndex = summary.indexOf(breakDurationLabel);
  if (breakDurationIndex < 0) return summary;
  const prefix = summary.slice(0, breakDurationIndex);
  const durationSummary = summary.slice(breakDurationIndex);
  return (
    <>
      {prefix}
      <strong>{durationSummary}</strong>
    </>
  );
}

export function renderContextPill(pill: string, emphasizedValue: string | null) {
  if (!emphasizedValue) return pill;
  const valueIndex = pill.indexOf(emphasizedValue);
  if (valueIndex < 0) return pill;
  const prefix = pill.slice(0, valueIndex);
  const suffix = pill.slice(valueIndex + emphasizedValue.length);
  return (
    <>
      {prefix}
      <strong>{emphasizedValue}</strong>
      {suffix}
    </>
  );
}
