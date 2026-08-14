export function DateNavigator({
  ariaLabel,
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
      <div className="day-nav__current"><strong>{label}</strong></div>
      <button className="app-btn app-btn--quiet app-btn--compact day-nav__step" type="button" onClick={onPrevious} aria-label={previousLabel}>&lsaquo;</button>
      <button className="app-btn app-btn--quiet app-btn--compact day-nav__today" type="button" onClick={onToday} disabled={isTodayDisabled}>{todayLabel}</button>
      <button className="app-btn app-btn--quiet app-btn--compact day-nav__step" type="button" onClick={onNext} disabled={isNextDisabled} aria-label={nextLabel}>&rsaquo;</button>
    </div>
  );
}
