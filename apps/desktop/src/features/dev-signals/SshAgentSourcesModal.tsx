import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type {
  SshAgentSourceCollectResult,
  SshAgentSourceListResult,
  SshAgentSourceTestResult,
} from "@drifty/domain";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { trackerClient } from "../../lib/api/trackerClient";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import {
  loadSshAgentSources,
  removeSshAgentSource,
  saveSshAgentSources,
  upsertSshAgentSource,
  type SavedSshAgentSource,
} from "./sshAgentSourcesStorage";

type Operation = { readonly kind: "test" | "collect"; readonly host: string } | null;
type Status = Pick<SshAgentSourceTestResult, "ok" | "message"> | null;
type Discovery = Pick<SshAgentSourceListResult, "ok" | "code" | "message" | "aliases"> | null;

export function SshAgentSourcesModal({
  onClose,
  onCollected,
}: {
  readonly onClose: () => void;
  readonly onCollected: () => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLElement>(null);
  const [host, setHost] = useState("");
  const [verifiedHost, setVerifiedHost] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation>(null);
  const [status, setStatus] = useState<Status>(null);
  const [sources, setSources] = useState(loadSshAgentSources);
  const [discovery, setDiscovery] = useState<Discovery>(null);
  const normalizedHost = host.trim();
  const isBusy = operation !== null;
  const canCollectNew = normalizedHost.length > 0 && verifiedHost === normalizedHost && !isBusy;
  const savedHostKeys = new Set(sources.map((source) => source.host.toLocaleLowerCase()));
  const discoveredAliases = discovery?.aliases.filter((alias) => !savedHostKeys.has(alias.toLocaleLowerCase())) ?? [];

  useModalDismiss(onClose, { disabled: isBusy });
  useModalFocusTrap(dialogRef, { initialFocusSelector: "[data-ssh-host-input]" });

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

  const updateSources = (next: SavedSshAgentSource[]) => {
    setSources(next);
    saveSshAgentSources(next);
  };

  const testConnection = async () => {
    if (!normalizedHost || isBusy) return;
    const testedHost = normalizedHost;
    setOperation({ kind: "test", host: testedHost });
    setVerifiedHost(null);
    setStatus(null);
    try {
      const result = await trackerClient.testSshAgentSource(testedHost);
      setStatus(result);
      if (result.ok && host.trim() === testedHost) setVerifiedHost(testedHost);
    } catch {
      setStatus({ ok: false, message: "Drifty could not start the SSH connection. Try again." });
    } finally {
      setOperation(null);
    }
  };

  const collect = async (targetHost: string) => {
    if (!targetHost || isBusy) return;
    setOperation({ kind: "collect", host: targetHost });
    setStatus(null);
    try {
      const result: SshAgentSourceCollectResult = await trackerClient.collectSshAgentSource(targetHost, 30);
      setStatus(result);
      if (result.ok) {
        updateSources(upsertSshAgentSource(sources, {
          host: targetHost,
          lastCollectedAt: new Date().toISOString(),
          lastMessage: result.message,
          turnsFound: result.turnsFound,
        }));
        setHost(targetHost);
        setVerifiedHost(targetHost);
        onCollected();
      }
    } catch {
      setStatus({ ok: false, message: "Drifty could not collect from this host. Check SSH in Terminal, then retry." });
    } finally {
      setOperation(null);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (canCollectNew) void collect(normalizedHost);
    else void testConnection();
  };

  const chooseHost = (nextHost: string) => {
    if (isBusy) return;
    setHost(nextHost);
    setVerifiedHost(null);
    setStatus(null);
  };

  const requestClose = () => {
    if (!isBusy) onClose();
  };

  return (
    <div className="auth-modal__overlay agents-ssh-modal__overlay" onClick={requestClose}>
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
        <ModalCloseButton disabled={isBusy} label="Close SSH collection" onClick={requestClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="agents-ssh-title">Collect from SSH</h2>
            <p>Choose a host you already use</p>
          </div>
        </div>

        <div className="agents-ssh-modal__notice">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 9l3 3-3 3M13 15h3" />
            <rect x="3" y="4" width="18" height="16" rx="3" />
          </svg>
          <p>
            Hosts are read locally from <code>~/.ssh/config</code>. Drifty does not open key files
            or connect until you ask.
          </p>
        </div>

        <div className="agents-ssh-modal__discovered" aria-busy={discovery === null}>
          <div className="agents-ssh-modal__section-head">
            <h3>SSH config</h3>
            <span>Local</span>
          </div>
          {discovery === null ? (
            <p className="agents-ssh-modal__discovery-state" role="status">Looking for host aliases…</p>
          ) : discoveredAliases.length > 0 ? (
            <ul aria-label="Hosts from SSH config">
              {discoveredAliases.map((alias) => {
                const selected = normalizedHost === alias;
                return (
                  <li key={alias}>
                    <button
                      type="button"
                      className={selected ? "is-selected" : undefined}
                      aria-pressed={selected}
                      disabled={isBusy}
                      onClick={() => chooseHost(alias)}
                    >
                      <span className="agents-ssh-modal__host-glyph" aria-hidden="true">
                        <svg viewBox="0 0 20 20"><path d="M6 7.2L9 10l-3 2.8M10.8 13h3.2" /></svg>
                      </span>
                      <span className="agents-ssh-modal__host-copy">
                        <strong dir="ltr">{alias}</strong>
                        <small>From SSH config</small>
                      </span>
                      <svg className="agents-ssh-modal__host-check" viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M4.5 10.2l3.2 3.2 7.8-7.8" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={`agents-ssh-modal__discovery-state ${discovery.ok ? "" : "is-error"}`}>
              {discovery.aliases.length > 0
                ? "All detected SSH hosts are already saved below."
                : discovery.message}
            </p>
          )}
        </div>

        <form className="agents-ssh-modal__form" onSubmit={handleSubmit}>
          <label className="auth-modal__field" htmlFor="agents-ssh-host">
            <span>Host or alias</span>
            <input
              id="agents-ssh-host"
              data-ssh-host-input
              aria-describedby="agents-ssh-host-hint"
              className="settings-input modal-code agents-ssh-modal__input"
              value={host}
              maxLength={383}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              dir="ltr"
              placeholder="Select above or enter a host"
              disabled={isBusy}
              onChange={(event) => {
                setHost(event.target.value);
                setVerifiedHost(null);
                setStatus(null);
              }}
            />
          </label>
          <p id="agents-ssh-host-hint" className="agents-ssh-modal__hint">
            All supported coding agents · last 30 days · key-based SSH only. Trust a new host in Terminal first.
          </p>
          <div className="agents-ssh-modal__actions">
            <button
              type="button"
              className="modal-btn modal-btn--secondary"
              disabled={!normalizedHost || isBusy}
              onClick={() => void testConnection()}
            >
              {operation?.kind === "test" ? "Testing…" : "Test connection"}
            </button>
            <button type="submit" className="modal-btn modal-btn--primary" disabled={!canCollectNew}>
              {operation?.kind === "collect" && operation.host === normalizedHost ? "Collecting…" : "Collect & save"}
            </button>
          </div>
        </form>

        {status ? (
          <div
            className={`agents-ssh-modal__status ${status.ok ? "is-success" : "is-error"}`}
            role={status.ok ? "status" : "alert"}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              {status.ok
                ? <path d="M4 10.5l3.4 3.4L16 5.8" />
                : <><circle cx="10" cy="10" r="7" /><path d="M10 6.5v4.5M10 14h.01" /></>}
            </svg>
            <span>{status.message}</span>
          </div>
        ) : null}

        {sources.length > 0 ? (
          <div className="agents-ssh-modal__saved" aria-label="Saved SSH hosts">
            <div className="agents-ssh-modal__saved-head">
              <h3>Saved hosts</h3>
              <span>Local</span>
            </div>
            <ul>
              {sources.map((source) => {
                const collecting = operation?.kind === "collect" && operation.host === source.host;
                return (
                  <li key={source.host}>
                    <div className="agents-ssh-modal__source-copy">
                      <strong dir="ltr">{source.host}</strong>
                      <span>{formatCollectedAt(source.lastCollectedAt)} · {source.turnsFound} turns found</span>
                    </div>
                    <div className="agents-ssh-modal__source-actions">
                      <button
                        type="button"
                        className="modal-btn modal-btn--secondary"
                        disabled={isBusy}
                        onClick={() => void collect(source.host)}
                      >
                        {collecting ? "Collecting…" : "Collect"}
                      </button>
                      <button
                        type="button"
                        className="agents-ssh-modal__remove"
                        aria-label={`Remove saved SSH host ${source.host}`}
                        title="Remove saved host only; collected activity stays in Drifty"
                        disabled={isBusy}
                        onClick={() => updateSources(removeSshAgentSource(sources, source.host))}
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 3h4M7 6l.6 10h4.8L13 6" /></svg>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="agents-ssh-modal__saved-foot">Removing a saved host removes only this shortcut. Previously collected activity stays in Your Agents.</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function formatCollectedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Collected previously";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
