import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { BreakIcon, ChevronDownIcon } from "./DriftAlarmIcons";
import { formatBreakOption } from "./driftAlarmEvent";

const CUSTOM_BREAK_MINUTES_MIN = 1;
const CUSTOM_BREAK_MINUTES_MAX = 60;

type BreakDurationPickerProps = {
  readonly isPending?: boolean;
  readonly label: string;
  readonly options: readonly number[];
  readonly selectedMinutes: number | null;
  readonly onSelect: (minutes: number) => void;
};

export function BreakDurationPicker({ isPending = false, label, options, selectedMinutes, onSelect }: BreakDurationPickerProps) {
  const panelId = useId();
  const customFormId = useId();
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [customMinutesValue, setCustomMinutesValue] = useState(() => getInitialCustomValue(selectedMinutes, options));

  const customMinutes = parseCustomBreakMinutes(customMinutesValue);

  useEffect(() => {
    if (!isOpen || !isCustomOpen) return undefined;
    const focusTimer = window.setTimeout(() => {
      customInputRef.current?.focus({ preventScroll: true });
      customInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [isCustomOpen, isOpen]);

  const selectMinutes = (minutes: number) => {
    if (isPending) return;
    onSelect(minutes);
    setIsOpen(false);
    setIsCustomOpen(false);
    setCustomMinutesValue(String(minutes));
  };

  const openCustomInput = () => {
    if (isPending) return;
    setIsOpen(true);
    setIsCustomOpen(true);
    setCustomMinutesValue(getInitialCustomValue(selectedMinutes, options));
  };

  const handleCustomValueChange = (event: ChangeEvent<HTMLInputElement>) => {
    setCustomMinutesValue(event.target.value);
  };

  const handleCustomSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (customMinutes === null) return;
    selectMinutes(customMinutes);
  };

  return (
    <div className={`da__break-picker${isOpen && !isPending ? " is-open" : ""}${isPending ? " is-pending" : ""}`}>
      <button
        className={`da__break-trigger${selectedMinutes !== null ? " is-selected" : ""}`}
        type="button"
        aria-label={isPending ? "Starting break" : label}
        aria-busy={isPending ? "true" : undefined}
        aria-expanded={isPending ? false : isOpen}
        aria-controls={panelId}
        disabled={isPending}
        onClick={() => setIsOpen((current) => !current)}
      >
        {isPending ? <span className="da__break-spinner" aria-hidden="true" /> : <BreakIcon />}
        <span className="da__break-trigger-copy">
          {isPending ? (
            <span className="da__break-pending-status" role="status" aria-label="Starting break">
              <strong>Starting break</strong>
            </span>
          ) : (
            <strong>{label}</strong>
          )}
        </span>
        <span className="da__break-trigger-chevron" aria-hidden="true"><ChevronDownIcon /></span>
      </button>

      {isOpen && !isPending ? (
        <div className="da__break-menu" id={panelId}>
          <div className="da__break-options" aria-label={`${label} options`}>
            {options.map((minutes) => (
              <button
                className={`da__break-option${selectedMinutes === minutes ? " is-selected" : ""}`}
                key={minutes}
                type="button"
                aria-pressed={selectedMinutes === minutes}
                disabled={isPending}
                onClick={() => selectMinutes(minutes)}
              >
                {formatBreakOption(minutes)}
              </button>
            ))}
            <button
              className={`da__break-option da__break-option--more${isCustomOpen ? " is-selected" : ""}`}
              type="button"
              aria-expanded={isCustomOpen}
              aria-controls={customFormId}
              disabled={isPending}
              onClick={openCustomInput}
            >
              More
            </button>
          </div>

          {isCustomOpen ? (
            <form className="da__break-custom" id={customFormId} onSubmit={handleCustomSubmit}>
              <input
                className="da__break-custom-input"
                ref={customInputRef}
                type="number"
                min={CUSTOM_BREAK_MINUTES_MIN}
                max={CUSTOM_BREAK_MINUTES_MAX}
                inputMode="numeric"
                aria-label="Custom break minutes"
                value={customMinutesValue}
                onChange={handleCustomValueChange}
              />
              <button className="da__break-custom-submit" type="submit" disabled={isPending || customMinutes === null}>
                Start
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function getInitialCustomValue(selectedMinutes: number | null, options: readonly number[]): string {
  return String(selectedMinutes ?? getDefaultBreakMinutes(options));
}

function getDefaultBreakMinutes(options: readonly number[]): number {
  return options[0] ?? 5;
}

function parseCustomBreakMinutes(value: string): number | null {
  const minutes = Number(value);
  if (!Number.isInteger(minutes)) return null;
  if (minutes < CUSTOM_BREAK_MINUTES_MIN || minutes > CUSTOM_BREAK_MINUTES_MAX) return null;
  return minutes;
}
