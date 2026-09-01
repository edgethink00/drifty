import { NavChevronIcon } from "./NavChevronIcon";

export function DateNavigator({
  ariaLabel,
  label,
  todayLabel,
  todayActionLabel,
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
  todayActionLabel?: string;
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
      <button className="app-btn app-btn--quiet app-btn--compact day-nav__step" type="button" onClick={onPrevious} aria-label={previousLabel}><NavChevronIcon direction="left" /></button>
      <button className="app-btn app-btn--quiet app-btn--compact day-nav__today" type="button" onClick={onToday} disabled={isTodayDisabled} aria-label={todayActionLabel}>{todayLabel}</button>
      <button className="app-btn app-btn--quiet app-btn--compact day-nav__step" type="button" onClick={onNext} disabled={isNextDisabled} aria-label={nextLabel}><NavChevronIcon direction="right" /></button>
    </div>
  );
}
