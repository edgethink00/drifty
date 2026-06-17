type StartupLoginPreferenceProps = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};

export function StartupLoginPreference({ enabled, onChange }: StartupLoginPreferenceProps) {
  return (
    <section className="onb-startup-preference" aria-labelledby="onb-startup-preference-title">
      <div className="onb-startup-preference__copy">
        <h2 className="onb-startup-preference__title" id="onb-startup-preference-title">
          Start Drifty at login
        </h2>
      </div>
      <button
        type="button"
        className={`onb-toggle${enabled ? " onb-toggle--on" : ""}`}
        aria-label="Start Drifty at login"
        aria-pressed={enabled}
        onClick={() => onChange(!enabled)}
      >
        <span className="onb-toggle__track" aria-hidden="true">
          <span className="onb-toggle__thumb" />
        </span>
        <span className="onb-toggle__label">{enabled ? "On" : "Off"}</span>
      </button>
    </section>
  );
}
