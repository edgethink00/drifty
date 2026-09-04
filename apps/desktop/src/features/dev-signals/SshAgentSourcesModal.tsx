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
import { sshAgentSourceBackfillDays } from "./useSshAgentSourceSyncController";

type Operation = { readonly kind: "test" | "collect"; readonly host: string } | null;
type Status = (Pick<SshAgentSourceTestResult, "ok" | "code" | "message"> & Partial<Pick<SshAgentSourceCollectResult, "turnsFound">>) | null;
type Discovery = Pick<SshAgentSourceListResult, "ok" | "code" | "message" | "aliases"> | null;

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
  status: NonNullable<Status>,
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
}: {
  readonly onClose: () => void;
  readonly onCollected: () => void;
  readonly collectSource?: (host: string, backfillDays: number) => Promise<SshAgentSourceCollectResult>;
}): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const dialogRef = useRef<HTMLElement>(null);
  const [host, setHost] = useState("");
  const [verifiedHost, setVerifiedHost] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation>(null);
  const [status, setStatus] = useState<Status>(null);
  const [sources, setSources] = useState(loadSshAgentSources);
  const [discovery, setDiscovery] = useState<Discovery>(null);
  const normalizedHost = host.trim();
  const isBusy = operation !== null;
  const sourceLimitReached = sources.length >= MAX_SAVED_SSH_AGENT_SOURCES
    && !sources.some((source) => source.host === normalizedHost);
  const canCollectNew = normalizedHost.length > 0
    && verifiedHost === normalizedHost
    && !sourceLimitReached
    && !isBusy;
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

  useEffect(() => subscribeSshAgentSources(() => {
    setSources(loadSshAgentSources());
  }), []);

  const updateSources = (next: SavedSshAgentSource[]): boolean => {
    if (!saveSshAgentSources(next)) {
      setStatus({ ok: false, code: "save_error", message: "Drifty could not save the SSH source for continuous collection." });
      return false;
    }
    setSources(next);
    return true;
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
      setStatus({ ok: false, code: "start_error", message: "Drifty could not start the SSH connection. Try again." });
    } finally {
      setOperation(null);
    }
  };

  const collect = async (targetHost: string) => {
    if (!targetHost || isBusy) return;
    setOperation({ kind: "collect", host: targetHost });
    setStatus(null);
    try {
      const currentSources = loadSshAgentSources();
      const savedSource = currentSources.find((source) => source.host === targetHost);
      if (!savedSource && currentSources.length >= MAX_SAVED_SSH_AGENT_SOURCES) {
        setStatus({ ok: false, code: "source_limit", message: "Remove a saved SSH source before adding another one." });
        return;
      }
      const result = await collectSource(
        targetHost,
        savedSource ? sshAgentSourceBackfillDays(savedSource.lastCollectedAt, Date.now()) : 30,
      );
      setStatus(result);
      if (result.ok) {
        const sourceSaved = updateSources(upsertSshAgentSource(loadSshAgentSources(), {
          host: targetHost,
          lastCollectedAt: new Date().toISOString(),
          lastMessage: result.message,
          turnsFound: result.turnsFound,
        }));
        if (sourceSaved) {
          setHost(targetHost);
          setVerifiedHost(targetHost);
          onCollected();
        }
      }
    } catch {
      setStatus({ ok: false, code: "collect_error", message: "Drifty could not collect from this host. Check SSH in Terminal, then retry." });
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
        <ModalCloseButton disabled={isBusy} label={t("agents.ssh.close")} onClick={requestClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="agents-ssh-title">{t("agents.ssh.title")}</h2>
            <p>{t("agents.ssh.subtitle")}</p>
          </div>
        </div>

        <div className="agents-ssh-modal__notice">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 9l3 3-3 3M13 15h3" />
            <rect x="3" y="4" width="18" height="16" rx="3" />
          </svg>
          <p>
            {t("agents.ssh.privacyBefore")} <code>~/.ssh/config</code>{t("agents.ssh.privacyAfter")}
          </p>
        </div>

        <div className="agents-ssh-modal__discovered" aria-busy={discovery === null}>
          <div className="agents-ssh-modal__section-head">
            <h3>{t("agents.ssh.config")}</h3>
            <span>{t("agents.ssh.local")}</span>
          </div>
          {discovery === null ? (
            <p className="agents-ssh-modal__discovery-state" role="status">{t("agents.ssh.looking")}</p>
          ) : discoveredAliases.length > 0 ? (
            <ul aria-label={t("agents.ssh.configHostsAria")}>
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
                        <small>{t("agents.ssh.fromConfig")}</small>
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
                ? t("agents.ssh.allSaved")
                : localizedDiscoveryMessage(discovery, effectiveLanguage, t)}
            </p>
          )}
        </div>

        <form className="agents-ssh-modal__form" onSubmit={handleSubmit}>
          <label className="auth-modal__field" htmlFor="agents-ssh-host">
            <span>{t("agents.ssh.hostLabel")}</span>
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
              placeholder={t("agents.ssh.hostPlaceholder")}
              disabled={isBusy}
              onChange={(event) => {
                setHost(event.target.value);
                setVerifiedHost(null);
                setStatus(null);
              }}
            />
          </label>
          <p id="agents-ssh-host-hint" className={`agents-ssh-modal__hint${sourceLimitReached ? " is-error" : ""}`}>
            {sourceLimitReached
              ? t("agents.ssh.sourceLimit", { count: MAX_SAVED_SSH_AGENT_SOURCES })
              : t("agents.ssh.hint")}
          </p>
          <div className="agents-ssh-modal__actions">
            <button
              type="button"
              className="modal-btn modal-btn--secondary"
              disabled={!normalizedHost || isBusy}
              onClick={() => void testConnection()}
            >
              {operation?.kind === "test" ? t("agents.ssh.testing") : t("agents.ssh.test")}
            </button>
            <button type="submit" className="modal-btn modal-btn--primary" disabled={!canCollectNew}>
              {operation?.kind === "collect" && operation.host === normalizedHost ? t("agents.ssh.collecting") : t("agents.ssh.collectAndSave")}
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
            <span>{localizedStatusMessage(status, effectiveLanguage, t)}</span>
          </div>
        ) : null}

        {sources.length > 0 ? (
          <div className="agents-ssh-modal__saved" aria-label={t("agents.ssh.savedAria")}>
            <div className="agents-ssh-modal__saved-head">
              <h3>{t("agents.ssh.saved")}</h3>
              <span>{t("agents.ssh.local")}</span>
            </div>
            <ul>
              {sources.map((source) => {
                const collecting = operation?.kind === "collect" && operation.host === source.host;
                return (
                  <li key={source.host}>
                    <div className="agents-ssh-modal__source-copy">
                      <strong dir="ltr">{source.host}</strong>
                      <span>{formatCollectedAt(source.lastCollectedAt, effectiveLanguage, t)} · {t("agents.ssh.turnsFound", { count: source.turnsFound })}</span>
                    </div>
                    <div className="agents-ssh-modal__source-actions">
                      <button
                        type="button"
                        className="modal-btn modal-btn--secondary"
                        disabled={isBusy}
                        onClick={() => void collect(source.host)}
                      >
                        {collecting ? t("agents.ssh.collecting") : t("agents.ssh.collect")}
                      </button>
                      <button
                        type="button"
                        className="agents-ssh-modal__remove"
                        aria-label={t("agents.ssh.removeAria", { host: source.host })}
                        title={t("agents.ssh.removeTitle")}
                        disabled={isBusy}
                        onClick={() => updateSources(removeSshAgentSource(loadSshAgentSources(), source.host))}
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 3h4M7 6l.6 10h4.8L13 6" /></svg>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="agents-ssh-modal__saved-foot">{t("agents.ssh.removeDetail")}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function formatCollectedAt(value: string, language: DisplayLanguage, t: LocalizationController["t"]): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("agents.ssh.collectedPreviously");
  return new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
