import driftyIconUrl from "../../../../assets/drifty-icon.png";

// Illustrative day strip (not real data): welcome is the only screen the user
// sees before the sign-in ask, so it carries a small preview of the payoff —
// a day already sorted into focus and drift, in the dashboard's own tones.
const PREVIEW_SEGMENTS: ReadonlyArray<{ readonly tone: "focus" | "drift" | "neutral"; readonly grow: number }> = [
  { tone: "focus", grow: 21 },
  { tone: "neutral", grow: 6 },
  { tone: "focus", grow: 16 },
  { tone: "drift", grow: 8 },
  { tone: "focus", grow: 26 },
  { tone: "drift", grow: 5 },
  { tone: "neutral", grow: 4 },
  { tone: "focus", grow: 14 },
];

export function WelcomeStep() {
  return (
    <div className="dc-onb-welcome">
      <img className="dc-onb-welcome__icon" src={driftyIconUrl} alt="" aria-hidden="true" />
      <span className="dc-onb-welcome__headline">Welcome to drifty.</span>
      <span className="dc-onb-welcome__headline dc-onb-welcome__headline--muted">Your AI time tracker.</span>
      <span className="dc-onb-welcome__body">
        I show where your time actually goes, and gently help you stay with the work that matters.
      </span>
      <div className="dc-onb-welcome__preview" aria-hidden="true">
        <div className="dc-onb-welcome__preview-strip">
          {PREVIEW_SEGMENTS.map((segment, index) => (
            <span
              key={index}
              className={`dc-onb-welcome__preview-seg dc-onb-welcome__preview-seg--${segment.tone}`}
              style={{ flexGrow: segment.grow }}
            />
          ))}
        </div>
        <div className="dc-onb-welcome__preview-legend">
          <span className="dc-onb-welcome__preview-dot dc-onb-welcome__preview-dot--focus" />
          Focus
          <span className="dc-onb-welcome__preview-dot dc-onb-welcome__preview-dot--drift" />
          Drift
        </div>
      </div>
    </div>
  );
}
