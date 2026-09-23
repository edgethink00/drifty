import { Toggle } from "../../components/Toggle";
import type { InterventionLedgerSummary } from "../companion/interventionLedger";
import { SettingsCollapsibleCard } from "./SettingsCollapsibleCard";

type DevSettingsDebugLogsBlockProps = {
  readonly onOpenDebugLogs: () => void;
};

export function DevSettingsDebugLogsBlock({ onOpenDebugLogs }: DevSettingsDebugLogsBlockProps) {
  return (
    <div className="settings-block">
      <h3>Debug logs</h3>
      <div className="settings-row">
        <div>
          <div className="lbl">Debug logs</div>
          <div className="desc">Preview a local JSON bundle with safe app status and setting values.</div>
        </div>
        <div className="ctrl">
          <button type="button" className="settings-btn" onClick={onOpenDebugLogs}>View debug logs</button>
        </div>
      </div>
    </div>
  );
}

type DevSettingsAxFallbackCardProps = {
  readonly forceBrowserHistoryUrlFallbackEnabled: boolean;
  readonly forceChromiumAxCaptureEnabled: boolean;
  readonly forceChromiumAxExtremeNudgeEnabled: boolean;
  readonly forceFrontmostFallbackCaptureEnabled: boolean;
  readonly onForceBrowserHistoryUrlFallbackChange: (enabled: boolean) => void;
  readonly onForceChromiumAxCaptureChange: (enabled: boolean) => void;
  readonly onForceChromiumAxExtremeNudgeChange: (enabled: boolean) => void;
  readonly onForceFrontmostFallbackCaptureChange: (enabled: boolean) => void;
};

export function DevSettingsAxFallbackCard({
  forceBrowserHistoryUrlFallbackEnabled,
  forceChromiumAxCaptureEnabled,
  forceChromiumAxExtremeNudgeEnabled,
  forceFrontmostFallbackCaptureEnabled,
  onForceBrowserHistoryUrlFallbackChange,
  onForceChromiumAxCaptureChange,
  onForceChromiumAxExtremeNudgeChange,
  onForceFrontmostFallbackCaptureChange,
}: DevSettingsAxFallbackCardProps) {
  return (
    <SettingsCollapsibleCard title="AX fallback diagnostics">
      <div className="settings-row">
        <div>
          <div className="lbl">Force Chromium AX site capture</div>
          <div className="desc">Skip Chromium tab AppleScript reads and capture the front URL through the Accessibility address bar path.</div>
        </div>
        <div className="ctrl">
          <Toggle checked={forceChromiumAxCaptureEnabled} onChange={onForceChromiumAxCaptureChange} ariaLabel="Force Chromium Accessibility site capture" />
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="lbl">Force frontmost fallback tracking</div>
          <div className="desc">Skip System Events frontmost app capture so tracker samples must identify the app through the lsappinfo fallback.</div>
        </div>
        <div className="ctrl">
          <Toggle checked={forceFrontmostFallbackCaptureEnabled} onChange={onForceFrontmostFallbackCaptureChange} ariaLabel="Force frontmost fallback tracking" />
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="lbl">Force browser history URL fallback</div>
          <div className="desc">Skip AppleScript and AX site capture so tracker samples test title-to-history URL matching only.</div>
        </div>
        <div className="ctrl">
          <Toggle checked={forceBrowserHistoryUrlFallbackEnabled} onChange={onForceBrowserHistoryUrlFallbackChange} ariaLabel="Force browser history URL fallback" />
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="lbl">Force Chromium AX automatic close</div>
          <div className="desc">Skip Chromium tab AppleScript close paths so Automatic close must use the Accessibility fallback.</div>
        </div>
        <div className="ctrl">
          <Toggle checked={forceChromiumAxExtremeNudgeEnabled} onChange={onForceChromiumAxExtremeNudgeChange} ariaLabel="Force Chromium Accessibility automatic close" />
        </div>
      </div>
    </SettingsCollapsibleCard>
  );
}

type DevSettingsInterventionLedgerBlockProps = {
  readonly summaries: readonly InterventionLedgerSummary[];
  readonly onRefresh: () => void;
};

function topEntries(counts: Readonly<Record<string, number>>, limit = 4): string {
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
  return ranked.length ? ranked.map(([key, count]) => `${key} ×${count}`).join(", ") : "—";
}

export function DevSettingsInterventionLedgerBlock({ summaries, onRefresh }: DevSettingsInterventionLedgerBlockProps) {
  return (
    <div className="settings-block" data-testid="dev-settings-intervention-ledger">
      <h3>Automatic close ledger</h3>
      <div className="settings-row">
        <div>
          <div className="lbl">Local outcome ledger</div>
          <div className="desc">Delivered alarms and automatic close attempts kept on this device for 30 days. No URLs, titles, or domains are stored.</div>
        </div>
        <div className="ctrl">
          <button type="button" className="settings-btn" onClick={onRefresh}>Refresh</button>
        </div>
      </div>
      {summaries.map((summary) => {
        const rate = summary.closeAttempts > 0 ? Math.round((100 * summary.closeApplied) / summary.closeAttempts) : null;
        return (
          <div className="settings-row" key={summary.days}>
            <div>
              <div className="lbl">Last {summary.days} days</div>
              <div className="desc">
                Alarms delivered {summary.delivered}, suppressed {summary.suppressed}. Close attempts {summary.closeAttempts}: applied {summary.closeApplied}
                {rate === null ? "" : ` (${rate}%)`}, not applied {summary.closeNotApplied}, pet skipped {summary.petSkipped}, errors {summary.errors}.
              </div>
              <div className="desc">Not applied: {topEntries(summary.notAppliedDiagnostics)}</div>
              <div className="desc">Pet skipped: {topEntries(summary.petSkipReasons)}</div>
              <div className="desc">Errors: {topEntries(summary.errorCodes)}</div>
              <div className="desc">
                By browser: {Object.keys(summary.byBrowser).length
                  ? Object.entries(summary.byBrowser).map(([browser, counts]) => `${browser} ${counts.applied}/${counts.attempts}`).join(", ")
                  : "—"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
