type AccessibilityStepProps = {
  readonly accessibilityJustGranted: boolean;
  readonly accessibilityReady: boolean;
  readonly openingSettingsPane: "accessibility" | "notifications" | null;
  readonly onOpenAccessibilitySettings: () => void;
  readonly onRefreshTracker: () => void;
};

export function AccessibilityStep({
  accessibilityJustGranted,
  accessibilityReady,
  openingSettingsPane,
  onOpenAccessibilitySettings,
  onRefreshTracker,
}: AccessibilityStepProps) {
  return (
    <>
      <span className={`onb-status-pill${accessibilityReady ? " onb-status-pill--ready" : ""}`}>
        {accessibilityReady ? "Granted" : "Waiting"}
      </span>
      <p className="onb-step-desc">drifty uses this to understand what you&apos;re working on.</p>
      {!accessibilityReady ? (
        <ol className="onb-instructions" aria-label="Accessibility permission steps">
          <li>Open System Settings → Privacy &amp; Security → Accessibility.</li>
          <li>Enable drifty (or the terminal running it).</li>
          <li>Return here. drifty detects it automatically.</li>
        </ol>
      ) : null}
      {accessibilityJustGranted ? (
        <p className="onb-setup-card__note">Detected automatically. Continue when you&apos;re ready.</p>
      ) : null}
      <div className="onb-setup-card__actions">
        <button
          type="button"
          className="onb-button onb-button--primary"
          onClick={onOpenAccessibilitySettings}
          disabled={openingSettingsPane === "accessibility" || accessibilityReady}
        >
          {openingSettingsPane === "accessibility"
            ? "Opening…"
            : accessibilityReady
              ? "Accessibility ready"
              : "Open Accessibility settings"}
        </button>
        <button type="button" className="onb-button onb-button--ghost" onClick={onRefreshTracker}>
          Check again
        </button>
      </div>
    </>
  );
}
