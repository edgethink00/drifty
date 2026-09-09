import type { DeveloperReleaseList as ReleaseList, DeveloperReleaseInstallResult as InstallResult } from "@drifty/domain";
import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isDeveloperPreReleaseUpdaterAvailable } from "../updates/preReleaseUpdaterClient";
import { acquireUpdateOperation, pauseUpdatesForVersionTest, resumeUpdatesAfterVersionTest, useUpdateOperationBusy, useVersionTestPauseUntil, useVersionReplacement, markVersionReplacementComplete } from "../updates/versionSwitchState";
import { clearPostUpdateRelaunchFocusPending, markPostUpdateRelaunchFocusPending } from "../updates/updatePolicy";
import { toErrorMessage } from "../../lib/formatting";

export function DevVersionSwitchBlock() {
  const [catalog, setCatalog] = useState<ReleaseList | null>(null);
  const [tag, setTag] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [installing, setInstalling] = useState(false);
  const installed = useVersionReplacement();
  const [restarting, setRestarting] = useState(false);
  const restartingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const operationBusy = useUpdateOperationBusy();
  const pauseUntil = useVersionTestPauseUntil();
  const available = isDeveloperPreReleaseUpdaterAvailable();
  const selected = catalog?.releases.find((release) => release.tag === tag);
  const busy = loading || operationBusy || installing;

  async function load() {
    if (loadingRef.current || operationBusy) return;
    loadingRef.current = true;
    setLoading(true); setError(null); setConfirming(false);
    try {
      const result = await invoke<ReleaseList>("developer_list_releases");
      setCatalog(result);
      setTag("");
    } catch (cause) { setError(toErrorMessage(cause)); }
    finally { loadingRef.current = false; setLoading(false); }
  }
  async function restart() {
    if (restartingRef.current) return;
    restartingRef.current = true;
    setRestarting(true);
    try {
      markPostUpdateRelaunchFocusPending();
      await invoke("app_restart_after_update");
    } catch (cause) {
      clearPostUpdateRelaunchFocusPending();
      setError(`Version installed, but restart failed. Quit and reopen Drifty. ${toErrorMessage(cause)}`);
    } finally { restartingRef.current = false; setRestarting(false); }
  }
  async function install() {
    if (!selected || !confirming || installed) return;
    const release = acquireUpdateOperation();
    if (!release) return;
    setInstalling(true); setError(null);
    try {
      pauseUpdatesForVersionTest();
      const result = await invoke<InstallResult>("developer_install_release", { tag: selected.tag });
      markVersionReplacementComplete(result); setConfirming(false);
      await restart();
    } catch (cause) { setError(toErrorMessage(cause)); }
    finally { setInstalling(false); release(); }
  }

  return <div className="settings-block settings-block--dev-preview" aria-labelledby="dev-version-switch-title">
    <h3 id="dev-version-switch-title">Version testing</h3>
    <div className="settings-row settings-row--fallback">
      <div><div className="lbl">Switch app version</div><div className="desc">Replace this app with a signed release to test an older version or pre-release.</div>
        {!available && <p className="capture-recency">Available in the desktop app only.</p>}
        {catalog && <p className="capture-recency">Current version: {catalog.currentVersion}</p>}
        {catalog?.installUnavailableReason && <p className="capture-recency">{catalog.installUnavailableReason}</p>}
      </div>
      <div className="ctrl"><button type="button" className="settings-btn" disabled={!available || busy || !!installed} onClick={() => void load()}>{loading ? "Loading…" : "Load versions"}</button></div>
    </div>
    {catalog && !installed && <div className="settings-row settings-row--fallback">
      <div><label className="lbl" htmlFor="dev-release-version">Target version</label><div className="desc">{catalog.releases.length === 0 ? "No compatible signed releases found." : "Releases that cannot be installed on this Mac are hidden."}{catalog.hasMore ? " Showing the most recent 100 releases." : ""}</div></div>
      <div className="ctrl settings-row__actions settings-row__actions--wrap">
        <select id="dev-release-version" className="settings-select" value={tag} disabled={busy} onChange={(event) => { setTag(event.target.value); setConfirming(false); setError(null); }}>
          <option value="">Choose a version</option>
          {catalog.releases.map((item) => <option key={item.tag} value={item.tag}>{item.tag}{item.prerelease ? " · Pre-release" : " · Stable"}{item.version === catalog.currentVersion ? " · Same version number" : ""}</option>)}
        </select>
        <button type="button" className="settings-btn" disabled={!selected || busy || !!catalog?.installUnavailableReason} onClick={() => setConfirming(true)}>Review switch</button>
      </div>
    </div>}
    {confirming && selected && <div className="settings-row settings-row--fallback" role="group" aria-label="Confirm version switch">
      <div><div className="lbl">{catalog?.currentVersion} → {selected.tag}{selected.prerelease ? " · Pre-release" : ""}</div>
        <div className="desc">Drifty will back up the local tracker database, replace this app, and restart. A backup does not guarantee older versions can read newer data. Settings are not rolled back.</div>
        {catalog?.backupDirectory && <p className="capture-recency">Backup folder: {catalog.backupDirectory}. The three newest tracker backups are kept; deleting activity also removes older backup copies.</p>}
        <p className="capture-recency">Automatic checks pause for 7 days and background installation turns off. Older builds may not honor the pause or include this version picker. To return to a newer stable version, use Check for Updates. For a specific version, use its official release DMG.</p>
      </div>
      <div className="ctrl settings-row__actions settings-row__actions--wrap">
        <button type="button" className="settings-btn" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
        <button type="button" className="settings-btn settings-btn--primary" disabled={busy} onClick={() => void install()}>{installing ? "Backing up and installing…" : "Back up, install & restart"}</button>
      </div>
    </div>}
    {installed && <div role="status"><p className="capture-recency">Installed {installed.version}. {installed.backupPath ? `Tracker backup: ${installed.backupPath}` : "No tracker database was present to back up."}</p><button type="button" className="settings-btn" disabled={installing || restarting} onClick={() => void restart()}>Restart Drifty</button></div>}
    {pauseUntil > 0 && <div className="settings-row settings-row--fallback"><div><div className="lbl">Test update pause</div><div className="desc">Automatic checks resume {new Date(pauseUntil).toLocaleString()}. Background installation remains off. Manual update checks remain available.</div></div><div className="ctrl"><button type="button" className="settings-btn" disabled={busy} onClick={() => { try { resumeUpdatesAfterVersionTest(); } catch (cause) { setError(toErrorMessage(cause)); } }}>Resume automatic checks</button></div></div>}
    {error && <p className="capture-recency capture-recency--error" role="alert">{error}</p>}
  </div>;
}
