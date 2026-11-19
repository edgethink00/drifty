import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { KeyHint } from "../../components/KeyHint";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { formatLocalizedCompactDurationFromSeconds, formatStartOfDayOptionLabel, localeForDisplayLanguage } from "../../lib/formatting";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import {
  FOCUS_MAX_MINUTES,
  FOCUS_MIN_MINUTES,
  POMODORO_LIMITS,
  pomodoroPlanMinutes,
  readFocusCustomChoice,
  validPomodoroPlan,
  type FocusSessionMode,
  type PomodoroPlan,
} from "./focusSession";
import "./focusSessionCustomDialog.css";

export type FocusCustomStart =
  | { readonly mode: "single"; readonly minutes: number }
  | { readonly mode: "pomodoro"; readonly plan: PomodoroPlan };

type Range = { readonly min: number; readonly max: number };

/** Lengths the menu bar does not offer, one tap away (the menu has 30, 60 and 120). */
const SINGLE_PICKS = [15, 45, 90, 180] as const;

function wholeNumber(value: string): number | null {
  if (!/^\d{1,4}$/.test(value.trim())) return null;
  return Number(value.trim());
}

function clamp(value: number, range: Range): number {
  return Math.min(range.max, Math.max(range.min, value));
}

/** One number with its unit inside the field and a step either side; ↑/↓ step too. */
function Stepper({ id, label, showLabel = true, unit, value, range, step, size = "regular", onChange, decreaseLabel, increaseLabel }: {
  readonly id: string;
  readonly label: string;
  /** The single-length dialog's title already names its one number. */
  readonly showLabel?: boolean;
  readonly unit: string;
  readonly value: string;
  readonly range: Range;
  readonly step: number;
  readonly size?: "regular" | "large";
  readonly onChange: (next: string) => void;
  readonly decreaseLabel: string;
  readonly increaseLabel: string;
}) {
  const current = wholeNumber(value);
  const nudge = (direction: 1 | -1) => {
    const base = current ?? range.min;
    // Snap to the step first, so 47 + 5 lands on 50 rather than 52.
    const snapped = direction > 0 ? Math.floor(base / step) * step + step : Math.ceil(base / step) * step - step;
    onChange(String(clamp(snapped, range)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      nudge(event.key === "ArrowUp" ? 1 : -1);
    }
  };
  const outOfRange = current === null || current < range.min || current > range.max;
  return (
    <div className={"fs-step fs-step--" + size + (outOfRange ? " is-invalid" : "")}>
      {showLabel ? <label className="fs-step__label" htmlFor={id}>{label}</label> : null}
      <div className="fs-step__row">
        <button type="button" className="fs-step__btn" aria-label={decreaseLabel} disabled={current !== null && current <= range.min} onClick={() => nudge(-1)}>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7" /></svg>
        </button>
        <span className="fs-step__field">
          <input
            id={id}
            className="fs-step__input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            aria-label={label}
            aria-invalid={outOfRange || undefined}
            value={value}
            size={3}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={onKeyDown}
            onChange={(event) => onChange(event.currentTarget.value.replace(/\D/g, ""))}
          />
          <span className="fs-step__unit" aria-hidden="true">{unit}</span>
        </span>
        <button type="button" className="fs-step__btn" aria-label={increaseLabel} disabled={current !== null && current >= range.max} onClick={() => nudge(1)}>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7M6 2.5v7" /></svg>
        </button>
      </div>
    </div>
  );
}

/**
 * The menu bar's "Custom…" rows (owner review 2026-11-19/20): one focus
 * length, or a pomodoro's focus, break and rounds. It opens with the last
 * values the user started; steppers move in sensible steps, and the line
 * above the actions says how long it runs and when it ends.
 */
export function FocusSessionCustomDialog({ mode, onStart, onClose }: {
  readonly mode: FocusSessionMode;
  readonly onStart: (choice: FocusCustomStart) => void;
  readonly onClose: () => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const idPrefix = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const [initial] = useState(readFocusCustomChoice);
  const [minutes, setMinutes] = useState(String(initial.minutes));
  const [focus, setFocus] = useState(String(initial.plan.focusMinutes));
  const [rest, setRest] = useState(String(initial.plan.breakMinutes));
  const [rounds, setRounds] = useState(String(initial.plan.rounds));
  useModalDismiss(onClose);
  useAnchoredDialog(dialogRef);
  const overlayDismiss = useOverlayDismiss(onClose);

  const singleRange = { min: FOCUS_MIN_MINUTES, max: FOCUS_MAX_MINUTES };
  const single = wholeNumber(minutes);
  const singleValid = single !== null && single >= singleRange.min && single <= singleRange.max;
  const rawPlan = { focusMinutes: wholeNumber(focus) ?? -1, breakMinutes: wholeNumber(rest) ?? -1, rounds: wholeNumber(rounds) ?? -1 };
  const plan = validPomodoroPlan(rawPlan);
  const fieldsInRange = rawPlan.focusMinutes >= POMODORO_LIMITS.focus.min && rawPlan.focusMinutes <= POMODORO_LIMITS.focus.max
    && rawPlan.breakMinutes >= POMODORO_LIMITS.break.min && rawPlan.breakMinutes <= POMODORO_LIMITS.break.max
    && rawPlan.rounds >= POMODORO_LIMITS.rounds.min && rawPlan.rounds <= POMODORO_LIMITS.rounds.max;
  const totalMinutes = mode === "single" ? (singleValid ? single : null) : plan ? pomodoroPlanMinutes(plan) : null;
  const canStart = totalMinutes !== null;
  const locale = localeForDisplayLanguage(effectiveLanguage);
  const duration = (value: number) => formatLocalizedCompactDurationFromSeconds(value * 60, effectiveLanguage);
  const endsAt = totalMinutes === null ? null : new Date(Date.now() + totalMinutes * 60_000);
  const endsLabel = endsAt ? formatStartOfDayOptionLabel(endsAt.getHours() * 60 + endsAt.getMinutes(), locale) : "";
  const problem = canStart
    ? null
    : mode === "pomodoro" && fieldsInRange
      ? t("focus.custom.tooLong", { total: duration(pomodoroPlanMinutes(rawPlan)), max: duration(POMODORO_LIMITS.totalMinutes) })
      : mode === "single"
        ? t("focus.custom.rangeSingle", { min: FOCUS_MIN_MINUTES, max: duration(FOCUS_MAX_MINUTES) })
        : t("focus.custom.rangePomodoro", {
          focusMin: POMODORO_LIMITS.focus.min,
          focusMax: POMODORO_LIMITS.focus.max,
          breakMax: POMODORO_LIMITS.break.max,
          roundsMax: POMODORO_LIMITS.rounds.max,
        });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "single" && singleValid) onStart({ mode: "single", minutes: single });
    else if (mode === "pomodoro" && plan) onStart({ mode: "pomodoro", plan });
  };

  const stepLabels = (label: string) => ({
    decreaseLabel: t("focus.custom.decrease", { label }),
    increaseLabel: t("focus.custom.increase", { label }),
  });

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={dialogRef}
        className="auth-modal modal-shell fs-custom"
        data-modal-variant="compact"
        data-mode={mode}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idPrefix + "title"}
        aria-describedby={idPrefix + "lede"}
        data-modal-initial-selector=".fs-step__input"
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("focus.custom.close")} onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id={idPrefix + "title"}>{mode === "single" ? t("focus.custom.titleSingle") : t("focus.custom.titlePomodoro")}</h2>
            <p id={idPrefix + "lede"}>{mode === "single" ? t("focus.custom.ledeSingle") : t("focus.custom.ledePomodoro")}</p>
          </div>
        </div>
        <form onSubmit={submit}>
          {mode === "single" ? (
            <div className="fs-custom__single">
              <Stepper
                id={idPrefix + "minutes"}
                label={t("focus.custom.focusLength")}
                unit={t("focus.custom.unitMinutes")}
                value={minutes}
                range={singleRange}
                step={5}
                size="large"
                showLabel={false}
                onChange={setMinutes}
                {...stepLabels(t("focus.custom.focusLength"))}
              />
              <div className="fs-custom__picks" role="group" aria-label={t("focus.custom.picks")}>
                {SINGLE_PICKS.map((pick) => (
                  <button
                    key={pick}
                    type="button"
                    className={"fs-custom__pick" + (single === pick ? " is-selected" : "")}
                    aria-pressed={single === pick}
                    onClick={() => setMinutes(String(pick))}
                  >
                    {duration(pick)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="fs-custom__plan">
              <Stepper id={idPrefix + "focus"} label={t("focus.custom.focus")} unit={t("focus.custom.unitMinutes")} value={focus} range={POMODORO_LIMITS.focus} step={5} onChange={setFocus} {...stepLabels(t("focus.custom.focus"))} />
              <Stepper id={idPrefix + "break"} label={t("focus.custom.break")} unit={t("focus.custom.unitMinutes")} value={rest} range={POMODORO_LIMITS.break} step={1} onChange={setRest} {...stepLabels(t("focus.custom.break"))} />
              <Stepper id={idPrefix + "rounds"} label={t("focus.custom.rounds")} unit={t("focus.custom.unitRounds")} value={rounds} range={POMODORO_LIMITS.rounds} step={1} onChange={setRounds} {...stepLabels(t("focus.custom.rounds"))} />
            </div>
          )}
          <div className="fs-custom__summary" aria-live="polite">
            {problem ? (
              <span className="fs-custom__problem">{problem}</span>
            ) : (
              <>
                {mode === "pomodoro" && plan ? (
                  <span className="fs-custom__total">
                    {duration(totalMinutes ?? 0)}
                    <span className="fs-custom__part">{t("focus.custom.focusPart", { duration: duration(plan.focusMinutes * plan.rounds) })}</span>
                  </span>
                ) : null}
                <span className="fs-custom__ends">{t("focus.session.endsAt", { time: endsLabel })}</span>
              </>
            )}
          </div>
          <div className="modal-foot">
            <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>
              {t("common.cancel")}<KeyHint shortcut="escape" />
            </button>
            <button type="submit" className="modal-btn modal-btn--primary" disabled={!canStart}>
              {t("focus.custom.start")}<KeyHint shortcut="enter" />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
