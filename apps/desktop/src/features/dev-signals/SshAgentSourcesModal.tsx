import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type {
  SshAgentSourceCollectResult,
  SshAgentSourceListResult,
  SshAgentSourceTestResult,
} from "@drifty/domain";
import { KeyHint } from "../../components/KeyHint";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { trackerClient } from "../../lib/api/trackerClient";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useLocalization, type DisplayLanguage, type LocalizationController } from "../localization/LocalizationContext";
import {
  loadSshAgentSources,
  MAX_SAVED_SSH_AGENT_SOURCES,
  removeSshAgentSource,
  saveSshAgentSources,
  subscribeSshAgentSources,
  upsertSshAgentSource,
  type SavedSshAgentSource,
} from "./sshAgentSourcesStorage";
import {
  INACTIVE_SSH_AGENT_SOURCE_SYNC_STATUS,
  SSH_AGENT_INITIAL_BACKFILL_DAYS,
  sshAgentSourceBackfillDays,
  type SshAgentSourceSyncStatus,
} from "./useSshAgentSourceSyncController";

type Operation = { readonly kind: "connect" | "sync"; readonly host: string } | null;
type StatusResult = Pick<SshAgentSourceTestResult, "ok" | "code" | "message"> & Partial<Pick<SshAgentSourceCollectResult, "turnsFound">>;
// The latest outcome of a saved host's manual sync, shown on that host's row.
type Status = (StatusResult & { readonly host: string }) | null;
// A host the user just chose to connect. It joins the connected list right
// away so progress and failure stay on the row the user acted on.
type PendingConnection = {
  readonly host: string;
  readonly phase: "checking" | "importing" | "failed";
  readonly status?: StatusResult;
};
type Discovery = Pick<SshAgentSourceListResult, "ok" | "code" | "message" | "aliases"> | null;
type HostState = "synced" | "syncing" | "error";

function localizedDiscoveryMessage(
  discovery: NonNullable<Discovery>,
  language: DisplayLanguage,
  t: LocalizationController["t"],
): string {
  if (language === "en") return discovery.message;
  if (discovery.code === "unavailable") return t("agents.ssh.discoveryUnavailable");
  if (discovery.code === "missing") return t("agents.ssh.discoveryMissing");
  if (discovery.code === "unreadable") return t("agents.ssh.discoveryUnreadable");
  if (discovery.code === "partial") return t("agents.ssh.discoveryPartial");
  if (discovery.code === "empty") return t("agents.ssh.discoveryEmpty");
  return discovery.message;
}

function localizedStatusMessage(
  status: StatusResult,
  language: DisplayLanguage,
  t: LocalizationController["t"],
): string {
  if (status.code === "empty") return t("agents.ssh.statusEmpty");
  if (status.code === "collected") return t("agents.ssh.statusCollected", { count: status.turnsFound ?? 0 });
  if (status.code === "save_error") return t("agents.ssh.saveError");
  if (status.code === "source_limit") return t("agents.ssh.sourceLimit", { count: MAX_SAVED_SSH_AGENT_SOURCES });
  if (language === "en") return status.message;
  switch (status.code) {
    case "unavailable": return t("agents.ssh.statusUnavailable");
    case "ready": return t("agents.ssh.statusReady");
    case "timeout": return t("agents.ssh.statusTimeout");
    case "host_key": return t("agents.ssh.statusHostKey");
    case "auth": return t("agents.ssh.statusAuth");
    case "unknown_host": return t("agents.ssh.statusUnknownHost");
    case "remote_runtime": return t("agents.ssh.statusRemoteRuntime");
    case "remote_error": return t("agents.ssh.statusRemoteError");
    case "invalid_host": return t("agents.ssh.statusInvalidHost");
    case "ssh_unavailable": return t("agents.ssh.statusSshUnavailable");
    case "invalid_response": return t("agents.ssh.statusInvalidResponse");
    case "empty": return t("agents.ssh.statusEmpty");
    case "collected": return t("agents.ssh.statusCollected", { count: status.turnsFound ?? 0 });
    case "start_error": return t("agents.ssh.startError");
    case "collect_error": return t("agents.ssh.collectError");
    default: return t("agents.ssh.statusDetails", { message: status.message });
  }
}

export function SshAgentSourcesModal({
  onClose,
  onCollected,
  collectSource = (host, backfillDays) => trackerClient.collectSshAgentSource(host, backfillDays),
  syncStatus = INACTIVE_SSH_AGENT_SOURCE_SYNC_STATUS,
}: {
  readonly onClose: () => void;
  readonly onCollected: () => void;
  readonly collectSource?: (host: string, backfillDays: number) => Promise<SshAgentSourceCollectResult>;
  readonly syncStatus?: SshAgentSourceSyncStatus;
}): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const dialogRef = useRef<HTMLElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const [manualHost, setManualHost] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [operation, setOperation] = useState<Operation>(null);
  const [status, setStatus] = useState<Status>(null);
  const [pending, setPending] = useState<readonly PendingConnection[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [sources, setSources] = useState(loadSshAgentSources);
  const [discovery, setDiscovery] = useState<Discovery>(null);
  const isBusy = operation !== null;
  const sourceLimitReached = sources.length >= MAX_SAVED_SSH_AGENT_SOURCES;
  const knownHostKeys = new Set([...sources.map((source) => source.host), ...pending.map((entry) => entry.host)]
    .map((value) => value.toLocaleLowerCase()));
  const detectedHosts = discovery?.aliases.filter((alias) => !knownHostKeys.has(alias.toLocaleLowerCase())) ?? [];
  // Without detected hosts, typing a host is the only way in, so the field is
  // already open.
  const showManual = manualOpen || (discovery !== null && detectedHosts.length === 0);
  const normalizedManualHost = manualHost.trim();

  useModalDismiss(onClose, { disabled: isBusy });
  useModalFocusTrap(dialogRef);

  useEffect(() => {
    let active = true;
    void trackerClient.listSshAgentSources()
      .then((result) => {
        if (active) setDiscovery(result);
      })
      .catch(() => {
        if (active) {
          setDiscovery({
            ok: false,
            code: "unreadable",
            message: "Drifty could not read your SSH config. You can still enter a custom host.",
            aliases: [],
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => subscribeSshAgentSources(() => {
    setSources(loadSshAgentSources());
  }), []);

  useEffect(() => {
    if (manualOpen) manualInputRef.current?.focus();
  }, [manualOpen]);

  const persistSources = (next: SavedSshAgentSource[]): boolean => {
    if (!saveSshAgentSources(next)) return false;
    setSources(next);
    return true;
  };

  const updatePending = (host: string, next: PendingConnection | null) => {
    setPending((current) => {
      const rest = current.filter((entry) => entry.host !== host);
      return next ? [...rest, next] : rest;
    });
  };

  // One click connects: check the SSH route, import the first 30 days, then
  // save the host for background sync. Nothing connects before this click.
  const connect = async (targetHost: string) => {
    const host = targetHost.trim();
    if (!host || isBusy) return;
    const savedSources = loadSshAgentSources();
    const alreadySaved = savedSources.find((source) => source.host.toLocaleLowerCase() === host.toLocaleLowerCase());
    if (alreadySaved) {
      // A typed host that is already connected is a manual sync of that row,
      // not a second pending entry for the same machine.
      setManualHost("");
      setManualOpen(false);
      await syncSaved(alreadySaved.host);
      return;
    }
    if (savedSources.length >= MAX_SAVED_SSH_AGENT_SOURCES) {
      updatePending(host, {
        host,
        phase: "failed",
        status: { ok: false, code: "source_limit", message: "Remove a saved SSH source before adding another one." },
      });
      return;
    }
    setOperation({ kind: "connect", host });
    setAnnouncement("");
    updatePending(host, { host, phase: "checking" });
    try {
      let tested: SshAgentSourceTestResult;
      try {
        tested = await trackerClient.testSshAgentSource(host);
      } catch {
        updatePending(host, {
          host,
          phase: "failed",
          status: { ok: false, code: "start_error", message: "Drifty could not start the SSH connection. Try again." },
        });
        return;
      }
      if (!tested.ok) {
        updatePending(host, { host, phase: "failed", status: tested });
        return;
      }
      updatePending(host, { host, phase: "importing" });
      let result: SshAgentSourceCollectResult;
      try {
        result = await collectSource(host, SSH_AGENT_INITIAL_BACKFILL_DAYS);
      } catch {
        updatePending(host, {
          host,
          phase: "failed",
          status: { ok: false, code: "collect_error", message: "Drifty could not collect from this host. Check SSH in Terminal, then retry." },
        });
        return;
      }
      if (!result.ok) {
        updatePending(host, { host, phase: "failed", status: result });
        return;
      }
      const saved = persistSources(upsertSshAgentSource(loadSshAgentSources(), {
        host,
        lastCollectedAt: new Date().toISOString(),
        lastMessage: result.message,
        turnsFound: result.turnsFound,
      }));
      if (!saved) {
        updatePending(host, {
          host,
          phase: "failed",
          status: { ok: false, code: "save_error", message: "Drifty could not save the SSH source for continuous collection." },
        });
        return;
      }
      updatePending(host, null);
      setAnnouncement(localizedStatusMessage(result, effectiveLanguage, t));
      if (manualHost.trim() === host) {
        setManualHost("");
        setManualOpen(false);
      }
      onCollected();
    } finally {
      setOperation(null);
    }
  };

  const syncSaved = async (host: string) => {
    if (isBusy) return;
    setOperation({ kind: "sync", host });
    setStatus(null);
    setAnnouncement("");
    try {
      const savedSource = loadSshAgentSources().find((source) => source.host === host);
      const result = await collectSource(
        host,
        savedSource ? sshAgentSourceBackfillDays(savedSource.lastCollectedAt, Date.now()) : SSH_AGENT_INITIAL_BACKFILL_DAYS,
      );
      setStatus({ ...result, host });
      if (result.ok) {
        const saved = persistSources(upsertSshAgentSource(loadSshAgentSources(), {
          host,
          lastCollectedAt: new Date().toISOString(),
          lastMessage: result.message,
          turnsFound: result.turnsFound,
        }));
        if (!saved) {
          setStatus({ ok: false, code: "save_error", message: "Drifty could not save the SSH source for continuous collection.", host });
          return;
        }
        setAnnouncement(localizedStatusMessage(result, effectiveLanguage, t));
        onCollected();
      }
    } catch {
      setStatus({ ok: false, code: "collect_error", message: "Drifty could not collect from this host. Check SSH in Terminal, then retry.", host });
    } finally {
      setOperation(null);
    }
  };

  const handleManualSubmit = (event: FormEvent) => {
    event.preventDefault();
    void connect(normalizedManualHost);
  };

  const savedHostState = (host: string): HostState => {
    if ((operation?.kind === "sync" && operation.host === host) || syncStatus.activeHosts.includes(host)) return "syncing";
    if (status?.host === host) return status.ok ? "synced" : "error";
    if (syncStatus.lastErrorHost === host) return "error";
    return "synced";
  };

  const requestClose = () => {
    if (!isBusy) onClose();
  };
  const overlayDismiss = useOverlayDismiss(requestClose, { disabled: isBusy });

  const syncIcon = (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.5 9.2A5.6 5.6 0 0 0 5.6 6.4M4.5 10.8a5.6 5.6 0 0 0 9.9 2.8" />
      <path d="M5.2 3.6v3.1h3.1M14.8 16.4v-3.1h-3.1" />
    </svg>
  );

  return (
    <div className="auth-modal__overlay agents-ssh-modal__overlay" {...overlayDismiss}>
      <section
        ref={dialogRef}
        className="auth-modal modal-shell agents-ssh-modal"
        data-modal-variant="standard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agents-ssh-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton disabled={isBusy} label={t("agents.ssh.close")} onClick={requestClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="agents-ssh-title">{t("agents.ssh.title")}</h2>
            <p>{t("agents.ssh.subtitle")}</p>
          </div>
        </div>

        {sources.length > 0 || pending.length > 0 ? (
          <section className="agents-ssh-modal__section" aria-labelledby="agents-ssh-connected">
            <h3 id="agents-ssh-connected" className="label-mono agents-ssh-modal__label">
              {t("agents.ssh.saved")}
              <span className="agents-ssh-modal__count">{sources.length}</span>
            </h3>
            <ul className="agents-ssh-modal__table agents-ssh-modal__hosts" aria-label={t("agents.ssh.savedAria")}>
              {sources.map((source) => {
                const state = savedHostState(source.host);
                const rowStatus = status?.host === source.host ? status : null;
                const meta = state === "syncing"
                  ? t("agents.ssh.hostSyncing")
                  : rowStatus && !rowStatus.ok
                    ? localizedStatusMessage(rowStatus, effectiveLanguage, t)
                    : state === "error"
                      ? t("agents.ssh.hostSyncFailed")
                      : formatCollectedAt(source.lastCollectedAt, effectiveLanguage, t);
                return (
                  <li key={source.host} className="agents-ssh-modal__host" data-state={state}>
                    <span className="agents-ssh-modal__host-dot" aria-hidden="true" />
                    <div className="agents-ssh-modal__host-copy">
                      <strong dir="ltr" title={source.host}>{source.host}</strong>
                      <span role={rowStatus && !rowStatus.ok ? "alert" : undefined}>{meta}</span>
                    </div>
                    <div className="agents-ssh-modal__host-actions">
                      <button
                        type="button"
                        className="modal-btn modal-btn--ghost agents-ssh-modal__icon-btn"
                        aria-label={t("agents.ssh.collect")}
                        title={t("agents.ssh.collect")}
                        disabled={isBusy}
                        onClick={() => void syncSaved(source.host)}
                      >
                        {syncIcon}
                      </button>
                      <button
                        type="button"
                        className="modal-btn modal-btn--ghost agents-ssh-modal__icon-btn agents-ssh-modal__icon-btn--danger"
                        aria-label={t("agents.ssh.removeAria", { host: source.host })}
                        title={t("agents.ssh.removeTitle")}
                        disabled={isBusy}
                        onClick={() => {
                          if (status?.host === source.host) setStatus(null);
                          if (!persistSources(removeSshAgentSource(loadSshAgentSources(), source.host))) {
                            setStatus({ ok: false, code: "save_error", message: "Drifty could not save the SSH source for continuous collection.", host: source.host });
                          }
                        }}
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8.2 3.5h3.6M6.5 6l.6 9.5h5.8l.6-9.5" /></svg>
                      </button>
                    </div>
                  </li>
                );
              })}
              {pending.map((entry) => {
                const failed = entry.phase === "failed";
                return (
                  <li key={"pending:" + entry.host} className="agents-ssh-modal__host" data-state={failed ? "error" : "syncing"}>
                    <span className="agents-ssh-modal__host-dot" aria-hidden="true" />
                    <div className="agents-ssh-modal__host-copy">
                      <strong dir="ltr" title={entry.host}>{entry.host}</strong>
                      <span role={failed ? "alert" : "status"}>
                        {failed && entry.status
                          ? localizedStatusMessage(entry.status, effectiveLanguage, t)
                          : t(entry.phase === "checking" ? "agents.ssh.connecting" : "agents.ssh.importing")}
                      </span>
                    </div>
                    {failed ? (
                      <div className="agents-ssh-modal__host-actions">
                        <button
                          type="button"
                          className="modal-btn modal-btn--ghost agents-ssh-modal__icon-btn"
                          aria-label={t("agents.ssh.retryAria", { host: entry.host })}
                          title={t("agents.ssh.retry")}
                          disabled={isBusy}
                          onClick={() => void connect(entry.host)}
                        >
                          {syncIcon}
                        </button>
                        <button
                          type="button"
                          className="modal-btn modal-btn--ghost agents-ssh-modal__icon-btn"
                          aria-label={t("agents.ssh.dismissAria", { host: entry.host })}
                          title={t("agents.ssh.dismiss")}
                          disabled={isBusy}
                          onClick={() => updatePending(entry.host, null)}
                        >
                          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
                        </button>
                      </div>
                    ) : (
                      <span className="agents-ssh-modal__progress" aria-hidden="true" data-phase={entry.phase} />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="agents-ssh-modal__section" aria-labelledby="agents-ssh-add" aria-busy={discovery === null}>
          <h3 id="agents-ssh-add" className="label-mono agents-ssh-modal__label">{t("agents.ssh.addHost")}</h3>
          <div className="agents-ssh-modal__table">
            {discovery === null ? (
              <p className="agents-ssh-modal__table-note" role="status">{t("agents.ssh.looking")}</p>
            ) : detectedHosts.length > 0 ? (
              <ul className="agents-ssh-modal__hosts" aria-label={t("agents.ssh.configHostsAria")}>
                {detectedHosts.map((alias) => (
                  <li key={alias} className="agents-ssh-modal__host agents-ssh-modal__host--detected">
                    <span className="agents-ssh-modal__glyph" aria-hidden="true">
                      <svg viewBox="0 0 20 20"><path d="M6.2 7.6l2.4 2.4-2.4 2.4M10.4 12.6h3.6" /></svg>
                    </span>
                    <div className="agents-ssh-modal__host-copy">
                      <strong dir="ltr" title={alias}>{alias}</strong>
                    </div>
                    <button
                      type="button"
                      className="modal-btn modal-btn--secondary agents-ssh-modal__row-btn"
                      aria-label={t("agents.ssh.connectAria", { host: alias })}
                      disabled={isBusy || sourceLimitReached}
                      onClick={() => void connect(alias)}
                    >
                      {t("agents.ssh.connect")}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {showManual ? (
              <form className="agents-ssh-modal__manual" onSubmit={handleManualSubmit}>
                <span className="agents-ssh-modal__glyph" aria-hidden="true">
                  <svg viewBox="0 0 20 20"><path d="M6.2 7.6l2.4 2.4-2.4 2.4M10.4 12.6h3.6" /></svg>
                </span>
                <input
                  ref={manualInputRef}
                  data-ssh-host-input
                  aria-label={t("agents.ssh.hostLabel")}
                  className="agents-ssh-modal__input"
                  value={manualHost}
                  maxLength={383}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  dir="ltr"
                  placeholder={t("agents.ssh.hostPlaceholder")}
                  disabled={isBusy}
                  onChange={(event) => setManualHost(event.target.value)}
                />
                <button
                  type="submit"
                  className="modal-btn modal-btn--primary agents-ssh-modal__row-btn"
                  disabled={!normalizedManualHost || isBusy || sourceLimitReached}
                >
                  {t("agents.ssh.connect")}
                  <KeyHint shortcut="enter" />
                </button>
              </form>
            ) : discovery !== null ? (
              <button type="button" className="agents-ssh-modal__add-row" disabled={isBusy} onClick={() => setManualOpen(true)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
                {t("agents.ssh.manualEntry")}
              </button>
            ) : null}
          </div>
          {sourceLimitReached ? (
            <p className="agents-ssh-modal__note is-error">{t("agents.ssh.sourceLimit", { count: MAX_SAVED_SSH_AGENT_SOURCES })}</p>
          ) : discovery !== null && discovery.aliases.length === 0 ? (
            <p className={"agents-ssh-modal__note" + (discovery.ok ? "" : " is-error")}>
              {localizedDiscoveryMessage(discovery, effectiveLanguage, t)}
            </p>
          ) : null}
        </section>
        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      </section>
    </div>
  );
}

function formatCollectedAt(value: string, language: DisplayLanguage, t: LocalizationController["t"]): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("agents.ssh.collectedPreviously");
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (elapsedMinutes < 1) return t("agents.ssh.syncedJustNow");
  const relative = new Intl.RelativeTimeFormat(language === "ko" ? "ko-KR" : "en-US", { numeric: "auto" });
  const time = elapsedMinutes < 60
    ? relative.format(-elapsedMinutes, "minute")
    : elapsedMinutes < 48 * 60
      ? relative.format(-Math.round(elapsedMinutes / 60), "hour")
      : relative.format(-Math.round(elapsedMinutes / (24 * 60)), "day");
  return t("agents.ssh.syncedAt", { time });
}
