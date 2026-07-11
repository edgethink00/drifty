import { useEffect, useMemo, useState } from "react";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { onboardingActivityLabel } from "./onboardingOptionLabels";
import "./styles/first-day-preparation.css";

export type FirstDayPreparationPhase = "importing" | "downloading" | "classifying";

type PhaseCopy = {
  readonly title: string;
  readonly lines: readonly string[];
};

const LINE_ROTATION_MS = 8450;

// The one personalized touch: lead the classifying phase with the work the user
// named during onboarding, so the first loading screen shows Drifty remembered.
function classifyingLines(workActivityLabel: string | null | undefined, copy: PhaseCopy, t: LocalizationController["t"]): readonly string[] {
  const base = copy.lines;
  if (!workActivityLabel) return base;
  return [t("onboarding.preparing.personalized", { activity: workActivityLabel }), ...base];
}

type FirstDayPreparationScreenProps = {
  readonly phase: FirstDayPreparationPhase;
  /** 0..1 for a determinate bar, or null while the step has no measurable progress. */
  readonly progress: number | null;
  /** First work activity from onboarding (e.g. "Designing"), used to personalize the classifying copy. */
  readonly workActivityLabel?: string | null;
};

export function FirstDayPreparationScreen({ phase, progress, workActivityLabel }: FirstDayPreparationScreenProps) {
  const { effectiveLanguage, t } = useLocalization();
  const phaseCopy = useMemo<Record<FirstDayPreparationPhase, PhaseCopy>>(() => ({
    importing: { title: t("onboarding.preparing.importTitle"), lines: [t("onboarding.preparing.importLine1"), t("onboarding.preparing.importLine2")] },
    downloading: { title: t("onboarding.preparing.downloadTitle"), lines: [t("onboarding.preparing.downloadLine1"), t("onboarding.preparing.downloadLine2")] },
    classifying: { title: t("onboarding.preparing.classifyTitle"), lines: [t("onboarding.preparing.classifyLine1"), t("onboarding.preparing.classifyLine2"), t("onboarding.preparing.classifyLine3"), t("onboarding.preparing.classifyLine4")] },
  }), [t]);
  const copy = phaseCopy[phase];
  const lines = useMemo(
    () => (phase === "classifying" ? classifyingLines(onboardingActivityLabel(workActivityLabel ?? "", effectiveLanguage), phaseCopy.classifying, t) : phaseCopy[phase].lines),
    [effectiveLanguage, phase, phaseCopy, t, workActivityLabel],
  );
  const line = useRotatingLine(lines, phase);
  const determinate = progress !== null && Number.isFinite(progress);
  const percent = determinate ? Math.min(100, Math.max(0, Math.round((progress as number) * 100))) : null;

  return (
    <div className="first-day-prep">
      <div className="first-day-prep__drag" data-tauri-drag-region />
      <div className="first-day-prep__panel" role="status" aria-live="polite">
        <div className="first-day-prep__mark" aria-hidden="true">
          <span className="first-day-prep__mark-glow" />
          <svg className="first-day-prep__hourglass" viewBox="0 0 1024 1024" width="96" height="96" role="img">
            <defs>
              <linearGradient id="firstDayPrepAurora" x1="0.12" y1="0" x2="0.9" y2="1">
                <stop offset="0" stopColor="#f7b267" />
                <stop offset="0.5" stopColor="#f4845f" />
                <stop offset="1" stopColor="#b18cff" />
              </linearGradient>
            </defs>
            {/* Drifty hourglass mark: top chamber points down into the neck, bottom chamber rises from it. */}
            <g fill="url(#firstDayPrepAurora)">
              <path d="M266 270h492L512 510z" />
              <path d="M512 514 758 754H266z" />
            </g>
          </svg>
        </div>

        <div className="first-day-prep__copy">
          <h1 className="first-day-prep__title">{copy.title}</h1>
          <p className="first-day-prep__line" key={line}>{line}</p>
        </div>

        <div
          className={`first-day-prep__progress${determinate ? "" : " first-day-prep__progress--indeterminate"}`}
          role="progressbar"
          aria-label={copy.title}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(percent !== null ? { "aria-valuenow": percent } : {})}
        >
          <span
            className="first-day-prep__progress-fill"
            style={determinate ? { width: `${percent}%` } : undefined}
          />
        </div>
        <span className="first-day-prep__percent">{percent !== null ? `${percent}%` : t("onboarding.preparing.working")}</span>
      </div>
    </div>
  );
}

function useRotatingLine(lines: readonly string[], resetKey: string): string {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (lines.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % lines.length);
    }, LINE_ROTATION_MS);
    return () => clearInterval(timer);
  }, [lines, resetKey]);

  return lines[Math.min(index, lines.length - 1)] ?? "";
}
