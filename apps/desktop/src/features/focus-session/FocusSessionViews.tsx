import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatStartOfDayOptionLabel, localeForDisplayLanguage } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import {
  endFocusSession,
  focusPhaseAt,
  formatCountdown,
  useFocusSessionClock,
  type FocusSession,
} from "./focusSession";
import "./focusSession.css";

/*
 * Sessions start from the menu bar (owner review 2026-11-17: no idle button in
 * the title bar). While one runs, the title bar shows its time left; the panel
 * under it shows when it ends, the pomodoro rounds and End.
 */

function ProgressRing({ value, size = 14 }: { readonly value: number; readonly size?: number }) {
  const radius = (size - 3) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className="fs-ring" width={size} height={size} viewBox={"0 0 " + size + " " + size} aria-hidden="true">
      <circle className="fs-ring__track" cx={size / 2} cy={size / 2} r={radius} />
      <circle
        className="fs-ring__value"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, value)))}
      />
    </svg>
  );
}

function clockLabel(timestamp: number, locale: string): string {
  const date = new Date(timestamp);
  return formatStartOfDayOptionLabel(date.getHours() * 60 + date.getMinutes(), locale);
}

/** A panel under its title bar trigger, outside the title bar so nothing clips it. */
function useAnchoredStyle(anchor: HTMLElement | null, width: number): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", visibility: "hidden", width });
  useLayoutEffect(() => {
    if (!anchor) return undefined;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
      setStyle({ position: "fixed", left, top: rect.bottom + 8, width });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [anchor, width]);
  return style;
}

function useDismiss(rootRef: { readonly current: HTMLElement | null }, anchor: HTMLElement | null, onClose: () => void) {
  useEffect(() => {
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
      anchor?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", handlePointer, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [anchor, onClose, rootRef]);
}

function Popover({ anchor, width, onClose, className, children }: {
  readonly anchor: HTMLElement | null;
  readonly width: number;
  readonly onClose: () => void;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const style = useAnchoredStyle(anchor, width);
  useDismiss(ref, anchor, onClose);
  return createPortal(<div ref={ref} className={"fs-panel" + (className ? " " + className : "")} style={style} role="dialog">{children}</div>, document.body);
}

function RunningPanel({ session, now, anchor, onClose, focusSecondsToday }: {
  readonly session: FocusSession;
  readonly now: number;
  readonly anchor: HTMLElement | null;
  readonly onClose: () => void;
  readonly focusSecondsToday: number | null;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const phase = focusPhaseAt(session, now);
  const locale = localeForDisplayLanguage(effectiveLanguage);
  const onBreak = phase?.kind === "break";
  const pomodoro = session.mode === "pomodoro" && phase !== null;
  const left = formatCountdown((phase?.end ?? session.endsAt) - now);
  const endsAt = clockLabel(session.endsAt, locale);
  const state = onBreak ? t("focus.session.break") : t("focus.session.focusing");
  const end = () => {
    endFocusSession({ focusSecondsNow: focusSecondsToday });
    onClose();
  };
  const tone = onBreak ? " is-break" : "";

  return (
    <Popover anchor={anchor} width={236} onClose={onClose} className={"fs-panel--hero" + tone}>
      <span className="fs-hero__eyebrow">
        <i aria-hidden="true" />
        {state}{pomodoro && phase ? " · " + phase.round + "/" + phase.rounds : ""}
      </span>
      <span className="fs-hero__time">{left}</span>
      <span className="fs-hero__sub">{t("focus.session.endsAt", { time: endsAt })}</span>
      <button type="button" className="fs-hero__end" onClick={end}>{t("focus.session.end")}</button>
    </Popover>
  );
}

/** The time left of a running session in the title bar; nothing while none runs. */
export function FocusSessionTitlebarTimer({ focusSecondsToday }: { readonly focusSecondsToday: number | null }) {
  const { t } = useLocalization();
  const { session, now } = useFocusSessionClock();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const running = session !== null && now < session.endsAt ? session : null;
  // A session that starts or ends from the menu bar closes the panel.
  const runningId = running?.id ?? null;
  useEffect(() => setOpen(false), [runningId]);
  if (!running) return null;
  const phase = focusPhaseAt(running, now);
  const onBreak = phase?.kind === "break";
  const left = formatCountdown((phase?.end ?? running.endsAt) - now);
  const progress = (now - running.startedAt) / (running.endsAt - running.startedAt);
  const label = onBreak
    ? t("focus.session.break") + " " + left
    : running.mode === "pomodoro" && phase
      ? phase.round + "/" + phase.rounds + " · " + left
      : t("focus.session.focusing") + " " + left;
  return (
    <div className="fs-titlebar">
      <button
        ref={setAnchor}
        type="button"
        className={"fs-titlebar__button is-running" + (onBreak ? " is-break" : "")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("focus.session.aria", { time: formatCountdown(running.endsAt - now) })}
        onClick={() => setOpen((value) => !value)}
      >
        <ProgressRing value={progress} />
        <span className="fs-titlebar__time">{label}</span>
      </button>
      {open ? <RunningPanel session={running} now={now} anchor={anchor} onClose={() => setOpen(false)} focusSecondsToday={focusSecondsToday} /> : null}
    </div>
  );
}
