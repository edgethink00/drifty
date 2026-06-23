export function DataReviewStep() {
  return (
    <>
      <p className="onb-step-desc">Review this before Drifty starts building your focus insights.</p>
      <div className="onb-data-rows" aria-label="Data handling summary">
        <div className="onb-data-row">
          <span className="onb-data-row__label">Uses</span>
          <span className="onb-data-row__copy">
            App names, active windows, browser sites, and session timing.
          </span>
        </div>
        <div className="onb-data-row">
          <span className="onb-data-row__label">Stored for</span>
          <span className="onb-data-row__copy">Your Drifty account and insight history after setup.</span>
        </div>
        <div className="onb-data-row">
          <span className="onb-data-row__label">You control</span>
          <span className="onb-data-row__copy">
            Pause tracking, review settings, or switch setup later.
          </span>
        </div>
      </div>
    </>
  );
}
