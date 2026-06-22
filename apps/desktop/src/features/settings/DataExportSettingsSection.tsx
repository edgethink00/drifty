type DataExportSettingsSectionProps = {
  readonly databasePath: string | null | undefined;
  readonly todaySessionCount: number;
};

export function DataExportSettingsSection({ databasePath, todaySessionCount }: DataExportSettingsSectionProps) {
  return (
    <div className="settings-section">
      <div className="settings-block">
        <h3>Data &amp; Export</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">Database</div>
          </div>
          <div className="ctrl ctrl--value">{databasePath ?? "Unknown"}</div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">Sessions logged</div>
          </div>
          <div className="ctrl ctrl--value">{todaySessionCount} today</div>
        </div>
      </div>
      <div className="settings-block">
        <h3>Export</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">Export session data</div>
            <div className="desc">All sessions as CSV</div>
          </div>
          <div className="ctrl"><button type="button" className="settings-btn">Download CSV</button></div>
        </div>
      </div>
    </div>
  );
}
