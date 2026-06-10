export function DateNavigator({
  ariaLabel,
  context,
  label,
  todayLabel,
  isTodayDisabled,
  isNextDisabled,
  onPrevious,
  onNext,
  onToday,
  previousLabel,
  nextLabel,
}: {
  ariaLabel: string;
  context: string;
  label: string;
  todayLabel: string;
  isTodayDisabled: boolean;
  isNextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  previousLabel: string;
  nextLabel: string;
}) {
  return (
    <div className="day-nav" aria-label={ariaLabel}>
      <button className="ghost-button day-nav__step" type="button" onClick={onPrevious} aria-label={previousLabel}>&lsaquo;</button>
      <div className="day-nav__current"><span className="eyebrow">{context}</span><strong>{label}</strong></div>
      <button className="ghost-button day-nav__step" type="button" onClick={onNext} disabled={isNextDisabled} aria-label={nextLabel}>&rsaquo;</button>
      <button className="ghost-button day-nav__today" type="button" onClick={onToday} disabled={isTodayDisabled}>{todayLabel}</button>
    </div>
  );
}
