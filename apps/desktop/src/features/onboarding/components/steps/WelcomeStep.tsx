import driftyIconUrl from "../../../../assets/drifty-icon.png";

export function WelcomeStep() {
  return (
    <div className="dc-onb-welcome">
      <img className="dc-onb-welcome__icon" src={driftyIconUrl} alt="" aria-hidden="true" />
      <span className="dc-onb-welcome__headline">Welcome to drifty.</span>
      <span className="dc-onb-welcome__headline dc-onb-welcome__headline--muted">Your AI time tracker.</span>
      <span className="dc-onb-welcome__body">
        I show where your time actually goes, and gently help you stay with the work that matters.
      </span>
    </div>
  );
}
