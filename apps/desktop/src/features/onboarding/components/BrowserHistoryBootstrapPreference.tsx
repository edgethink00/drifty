type BrowserHistoryBootstrapPreferenceProps = {
  readonly enabled: boolean;
  readonly onChange: (enabled: boolean) => void;
};

export function BrowserHistoryBootstrapPreference({
  enabled,
  onChange,
}: BrowserHistoryBootstrapPreferenceProps) {
  return (
      <label className="onb-browser-history-preference">
        <span className="onb-browser-history-preference__title">
          Import from browser history (last 48 hours)
        </span>
      <input
        type="checkbox"
        className="onb-browser-history-preference__input"
        checked={enabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span
        className={`onb-browser-history-preference__toggle onb-toggle${enabled ? " onb-toggle--on" : ""}`}
        aria-hidden="true"
      >
        <span className="onb-toggle__track">
          <span className="onb-toggle__thumb" />
        </span>
        <span className="onb-toggle__label">{enabled ? "On" : "Off"}</span>
      </span>
    </label>
  );
}
