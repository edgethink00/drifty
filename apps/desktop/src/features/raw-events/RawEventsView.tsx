import type { ActivitySegment } from "@dtime/domain";

export function RawEventsView({ events }: { events: ActivitySegment[] }) {
  return (
    <div>
      <h3>Raw events</h3>
      <p className="muted">Captured segments and source metadata.</p>
      <table className="table">
        <thead>
            <tr>
              <th>App</th>
              <th>Site</th>
              <th>Window</th>
              <th>Start</th>
              <th>Duration</th>
              <th>Source</th>
          </tr>
        </thead>
        <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{event.appName}</td>
                <td>{event.siteDomain ?? "—"}</td>
                <td>{event.windowTitle ?? "—"}</td>
                <td>{new Date(event.startedAt).toLocaleString()}</td>
                <td>{Math.round(event.durationSeconds / 60)}m</td>
              <td>{event.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
