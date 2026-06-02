type Props = {
  hours: number;
};

export function FocusGoalBar({ hours }: Props) {
  const clamped = Math.max(0, Math.min(24, hours));
  const pct = Math.round((clamped / 24) * 100);
  return (
    <div className="onb-focus-bar" aria-hidden="true">
      <div className="onb-focus-bar__track">
        <div className="onb-focus-bar__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="onb-focus-bar__labels">
        <span className="onb-focus-bar__label">0h</span>
        <span className="onb-focus-bar__label">12h</span>
        <span className="onb-focus-bar__label">24h</span>
      </div>
    </div>
  );
}
