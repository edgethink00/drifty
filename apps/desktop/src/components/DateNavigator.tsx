import { NavChevronIcon } from "./NavChevronIcon";
import { DateJumpCalendar, type DateJumpPicker } from "./DateJumpCalendar";
import "./action-label.css";

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
  pendingLabel,
  picker,
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
  /** The displayed date stays put while another date is being prepared. */
  pendingLabel?: string;
  /** Turns the caption into a button that opens a month to jump to a day or week. */
  picker?: DateJumpPicker;
}) {
  return (
    <div className={"day-nav" + (picker ? " day-nav--pick" : "")} aria-label={ariaLabel}>
      <div className="day-nav__current">
        {pendingLabel ? <span className="day-nav__pending" role="status" aria-label={pendingLabel} title={pendingLabel}><span className="action-label__spinner" aria-hidden="true" /></span> : null}
        {picker ? <DateJumpCalendar label={label} picker={picker} /> : <strong>{label}</strong>}
      </div>
      <button className="app-btn app-btn--quiet app-btn--compact app-btn--icon day-nav__step" type="button" onClick={onPrevious} disabled={isPreviousDisabled} aria-label={previousLabel}><NavChevronIcon direction="left" /></button>
      <button className="app-btn app-btn--quiet app-btn--compact day-nav__today" type="button" onClick={onToday} disabled={isTodayDisabled} aria-label={todayActionLabel}>{todayLabel}</button>
      <button className="app-btn app-btn--quiet app-btn--compact app-btn--icon day-nav__step" type="button" onClick={onNext} disabled={isNextDisabled} aria-label={nextLabel}><NavChevronIcon direction="right" /></button>
    </div>
  );
}
