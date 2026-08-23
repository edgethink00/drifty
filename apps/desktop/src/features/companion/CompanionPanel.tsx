import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  fetchCompanionDevices,
  generateCompanionPairingCode,
  saveCompanionSummary,
  type CompanionDevice,
} from "./companionService";

export function CompanionPanel() {
  const { user, isEnabled } = useAuth();
  const [pairingCode, setPairingCode] = useState(() => generateCompanionPairingCode());
  const [summaryCode, setSummaryCode] = useState("");
  const [devices, setDevices] = useState<CompanionDevice[]>([]);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const totalFocusMinutes = useMemo(() => devices.reduce((total, device) => total + device.focusMinutesToday, 0), [devices]);

  useEffect(() => {
    if (!isEnabled || !user) return;
    void refreshDevices();
  }, [isEnabled, user]);

  async function refreshDevices() {
    setLoading(true);
    const result = await fetchCompanionDevices();
    if (result.success) {
      setDevices(result.data ?? []);
      setStatus(null);
    } else {
      setStatus({ kind: "error", message: result.error ?? "Unable to load companion devices" });
    }
    setLoading(false);
  }

  async function importSummary() {
    setLoading(true);
    const result = await saveCompanionSummary(pairingCode, summaryCode);
    if (result.success && result.data) {
      setDevices((current) => [result.data!, ...current.filter((device) => device.deviceId !== result.data!.deviceId)]);
      setSummaryCode("");
      setStatus({ kind: "ok", message: "Imported iOS focus summary." });
    } else {
      setStatus({ kind: "error", message: result.error ?? "Import failed" });
    }
    setLoading(false);
  }

  if (!isEnabled) {
    return <p>Supabase is not configured. Configure account sync before linking an iOS companion.</p>;
  }

  if (!user) {
    return <p>Sign in to connect iOS companion summaries to this desktop account.</p>;
  }

  return (
    <div className="companion-panel">
      <div className="settings-row">
        <div>
          <div className="lbl">Pairing code</div>
          <div className="desc">Enter this code on iPhone. Codes link only coarse focus summaries and settings.</div>
        </div>
        <div className="ctrl companion-code">{pairingCode}</div>
      </div>

      <div className="settings-row">
        <div>
          <div className="lbl">Rotate code</div>
          <div className="desc">Generate a new one-time code before linking another iPhone.</div>
        </div>
        <div className="ctrl">
          <button className="settings-btn" onClick={() => setPairingCode(generateCompanionPairingCode())} disabled={loading}>
            New code
          </button>
        </div>
      </div>

      <div className="settings-row companion-import-row">
        <div>
          <div className="lbl">Import iOS summary</div>
          <div className="desc">Paste the Drifty iOS summary code. It contains no selected apps, sites, or Screen Time events.</div>
        </div>
        <div className="ctrl companion-import-controls">
          <textarea
            value={summaryCode}
            onChange={(event) => setSummaryCode(event.target.value)}
            placeholder="DRIFTY-IOS-V1|..."
            rows={3}
          />
          <button className="settings-btn" onClick={() => void importSummary()} disabled={loading || summaryCode.trim().length === 0}>
            Import
          </button>
        </div>
      </div>

      <div className="settings-row">
        <div>
          <div className="lbl">iOS focus today</div>
          <div className="desc">Aggregate imported from companion devices.</div>
        </div>
        <div className="ctrl companion-code">{totalFocusMinutes}m</div>
      </div>

      {devices.map((device) => (
        <div className="settings-row" key={device.deviceId}>
          <div>
            <div className="lbl">{device.deviceName}</div>
            <div className="desc">{device.focusMinutesToday}m · {device.sessionsCompletedToday} sessions · {device.currentFocusMode} · synced {new Date(device.lastSyncedAt).toLocaleString()}</div>
          </div>
          <div className="ctrl"><span className="chip green">iOS</span></div>
        </div>
      ))}

      {status ? <div className={`sync-test__result sync-test__result--${status.kind}`}>{status.message}</div> : null}
    </div>
  );
}
