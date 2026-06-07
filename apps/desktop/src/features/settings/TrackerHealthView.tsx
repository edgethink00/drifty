import type { TrackerStatus } from "@drifty/domain";

export function TrackerHealthView({
  status,
  onStart,
  onStop,
}: {
  status: TrackerStatus;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  return (
    <div>
      <h3>Tracker health</h3>
      <div className="list">
        <div className="stat-row">
          <span>Tracker running</span>
          <strong>{status.running ? "Yes" : "No"}</strong>
        </div>
        <div className="stat-row">
          <span>Accessibility granted</span>
          <strong>{status.accessibilityGranted ? "Granted" : "Missing"}</strong>
        </div>
        <div className="stat-row">
          <span>Mode</span>
          <strong>{status.trackerMode ?? "unknown"}</strong>
        </div>
        <div className="stat-row">
          <span>Database</span>
          <strong>{status.databasePath ?? "Unavailable"}</strong>
        </div>
        <div className="stat-row">
          <span>Last event</span>
          <strong>{status.lastEventAt ?? "None yet"}</strong>
        </div>
        {status.message ? (
          <div className="stat-row">
            <span>Message</span>
            <strong>{status.message}</strong>
          </div>
        ) : null}
      </div>
      <div className="health-actions">
        <button className="primary-button" onClick={() => void onStart()}>
          Start tracking
        </button>
        <button className="secondary-button" onClick={() => void onStop()}>
          Stop tracking
        </button>
      </div>
    </div>
  );
}
