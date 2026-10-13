import { NavChevronIcon } from "./NavChevronIcon";

export function DateNavigator({
  ariaLabel,
  label,
  todayLabel,
  todayActionLabel,
  isTodayDisabled,
  isNextDisabled,
  isPreviousDisabled = false,
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
  /** Lists with a first entry (such as weekly reads) stop at it; date ranges never do. */
  isPreviousDisabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  previousLabel: string;
  nextLabel: string;
}) {
  return (
    <div className="day-nav" aria-label={ariaLabel}>
      <div className="day-nav__current"><strong>{label}</strong></div>
      <button className="app-btn app-btn--quiet app-btn--compact app-btn--icon day-nav__step" type="button" onClick={onPrevious} disabled={isPreviousDisabled} aria-label={previousLabel}><NavChevronIcon direction="left" /></button>
      <button className="app-btn app-btn--quiet app-btn--compact day-nav__today" type="button" onClick={onToday} disabled={isTodayDisabled} aria-label={todayActionLabel}>{todayLabel}</button>
      <button className="app-btn app-btn--quiet app-btn--compact app-btn--icon day-nav__step" type="button" onClick={onNext} disabled={isNextDisabled} aria-label={nextLabel}><NavChevronIcon direction="right" /></button>
    </div>
  );
}
