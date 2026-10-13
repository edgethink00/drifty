import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./readWait.css";
import { formatLocalizedCompactDurationFromSeconds } from "../../../lib/formatting";
import type { DisplayLanguage } from "../../localization/languagePreference";
import { useLocalization } from "../../localization/LocalizationContext";
import { COACH_MEANINGFUL_DAY_HOURS, COACH_REQUIRED_DAYS, COACH_REQUIRED_HOURS } from "../insightsReadiness";
import type { InsightsRead, ReadUnlockProgress } from "./readModel";
import { weekRangeLabel } from "./readFormat";

/*
 * Your read before the first read exists, the Dayflow way: the read sits
 * behind, out of focus, and one small dialog in the centre says how far along
 * the unlock is. The dialog follows the app's own modal chrome (24px corner,
 * hairline, shell shadow, 1.2rem title, modal-btn) and holds only what the
 * wait needs. The unlock notification is on by default, so a locked dialog
 * has nothing to press.
 *
 * The read behind is drawn at the page's own width and settings, only set in
 * a little and out of focus, so once the first read is written the cover can
 * clear in place: the dialog lifts away, the blur and veil go, the inset and
 * the frame's edge go, and the frame opens to the read's full height. The
 * page that takes over is then the same picture in the same place.
 */

const HOUR = 3600;
export const READ_WRITE_STEP_MS = 650;
export const READ_WRITE_STEPS = 4;
const STEP_MS = READ_WRITE_STEP_MS;
const STEPS = READ_WRITE_STEPS;
/** How long the cover takes to clear once the read is written, before the read page takes over. */
export const REVEAL_MS = 900;

export type WaitPhase = "locked" | "ready" | "ready-no-ai" | "writing";

export type ReadWaitProps = {
  readonly phase: WaitPhase;
  readonly progress: ReadUnlockProgress;
  /** The read the first write will produce; supplies its range. */
  readonly firstRead: InsightsRead;
  /** The read page behind the dialog, drawn out of focus. */
  readonly silhouette: ReactNode;
  readonly holdWriting?: boolean;
  readonly onWrite: () => void;
  readonly onSetUpAi: () => void;
  /** Called once the written read has been revealed in place, for the read page to take over. */
  readonly onWritten?: () => void;
};

function duration(seconds: number, language: DisplayLanguage): string {
  if (seconds < 60) return language === "ko" ? "0분" : "0m";
  return formatLocalizedCompactDurationFromSeconds(seconds, language);
}

function useStep(active: boolean, hold: boolean): number {
  const [step, setStep] = useState(0);
  const last = hold ? 2 : STEPS;
  useEffect(() => {
    if (!active || step >= last) return undefined;
    const timer = window.setTimeout(() => setStep((value) => value + 1), STEP_MS);
    return () => window.clearTimeout(timer);
  }, [active, step, last]);
  return step;
}

/** Keeps the out-of-focus read out of focus order and the accessibility tree. */
function inertRef(node: HTMLDivElement | null) {
  node?.setAttribute("inert", "");
}

function Bar({ fill, label }: { readonly fill: number; readonly label: string }) {
  const value = Math.min(1, Math.max(0, fill));
  return (
    <span className="rw-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <i style={{ width: value * 100 + "%" }} />
    </span>
  );
}

function DialogContent({ props, step }: { readonly props: ReadWaitProps; readonly step: number }) {
  const { effectiveLanguage: language, t } = useLocalization();
  const read = props.firstRead;

  if (props.phase === "locked") {
    const required = COACH_REQUIRED_HOURS * HOUR;
    const tracked = props.progress.trackedSeconds;
    const hours = String(COACH_REQUIRED_HOURS);
    const daysDone = Math.min(props.progress.meaningfulDays, COACH_REQUIRED_DAYS);
    return (
      <>
        <h2 className="rw-title">{t("trends.read.wait.title")}</h2>
        <p className="rw-body">{t("trends.read.wait.body", { hours })}</p>
        <p className="rw-amount"><strong>{duration(tracked, language)}</strong><span>{t("trends.read.wait.of", { hours })}</span></p>
        <Bar fill={tracked / required} label={t("trends.read.wait.title")} />
        <p className="rw-meta">
          <span>{t("trends.read.wait.days", { count: String(daysDone), days: String(COACH_REQUIRED_DAYS), dayHours: String(COACH_MEANINGFUL_DAY_HOURS) })}</span>
          <span>{t("trends.read.wait.left", { value: duration(Math.max(0, required - tracked), language) })}</span>
        </p>
      </>
    );
  }

  if (props.phase === "writing") {
    const steps = [
      t("trends.read.writing.step.read", { days: String(read.comparableDays) }),
      t("trends.read.writing.step.compare"),
      t("trends.read.writing.step.check", { count: String(read.checked.length) }),
      t("trends.read.writing.step.write"),
    ];
    return (
      <>
        <h2 className="rw-title">{t("trends.read.writing.title")}</h2>
        <p className="rw-body" aria-live="polite">{steps[Math.min(step, STEPS - 1)]}…</p>
        <Bar fill={step / STEPS} label={t("trends.read.writing.title")} />
        <p className="rw-fine">{t("trends.read.writing.leave")}</p>
      </>
    );
  }

  const noAi = props.phase === "ready-no-ai";
  return (
    <>
      <h2 className="rw-title">{noAi ? t("trends.read.gate.noAiTitle") : t("trends.read.wait.readyTitle")}</h2>
      <p className="rw-body">{noAi ? t("trends.read.gate.noAi") : t("trends.read.wait.readyBody", { range: weekRangeLabel(read.weekStart, read.weekEnd, language) })}</p>
      {noAi
        ? <button type="button" className="modal-btn modal-btn--primary rw-action" onClick={props.onSetUpAi}>{t("trends.read.gate.setUpAi")}</button>
        : <button type="button" className="modal-btn modal-btn--primary rw-action" onClick={props.onWrite}>{t("trends.read.gate.write")}</button>}
      {noAi ? null : <p className="rw-fine">{t("trends.read.wait.disclosure")}</p>}
    </>
  );
}

/** Before the first read: the read behind, out of focus, under one small dialog. */
export function ReadWait(props: ReadWaitProps) {
  const { t } = useLocalization();
  const writing = props.phase === "writing";
  const step = useStep(writing, Boolean(props.holdWriting));
  const open = writing && step >= STEPS;
  const focus = open ? 1 : writing ? 0.15 + 0.85 * (step / STEPS) : 0;
  const frameRef = useRef<HTMLElement>(null);
  const behindRef = useRef<HTMLDivElement | null>(null);
  const onWritten = props.onWritten;
  // Once written, the frame opens from its height to the read's, with the dialog held where it stood.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const frame = frameRef.current;
    const behind = behindRef.current;
    if (frame && behind) {
      const from = frame.getBoundingClientRect().height;
      frame.style.setProperty("--rw-mid", from / 2 + "px");
      frame.style.height = from + "px";
      void frame.offsetHeight;
      frame.style.height = Math.max(from, behind.scrollHeight) + "px";
    }
    const timer = window.setTimeout(() => onWritten?.(), REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [open, onWritten]);
  return (
    <div className="rw-root">
      <section ref={frameRef} className={"rw is-" + props.phase + (open ? " is-open" : "")} style={{ "--rw-focus": focus } as CSSProperties} aria-label={t("trends.read.gate.eyebrow")}>
        <div className="rw__behind" aria-hidden="true" ref={(node) => { behindRef.current = node; inertRef(node); }}>{props.silhouette}</div>
        <span className="rw__veil" aria-hidden="true" />
        <div className="rw-dialog">
          <div key={props.phase} className="rw-dialog__content">
            <DialogContent props={props} step={step} />
          </div>
        </div>
      </section>
    </div>
  );
}
