import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  developerToolsClient,
  type DeveloperArtifactState,
  type DeveloperArtifactStatus,
  type DeveloperToolsClient,
  type DeveloperToolsStatus,
} from "../../lib/api/developerToolsClient";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import "./DeveloperSettingsSection.css";

type ArtifactKey = "cli" | "codexSkill";
type Operation = "install" | "uninstall";

type DeveloperSettingsSectionProps = {
  readonly client?: DeveloperToolsClient;
};

const CLI_EXAMPLES = [
  { command: "drifty summary --day 2026-08-04", descriptionKey: "settings.developer.commandSummary" },
  { command: "drifty search --query \"CLI\"", descriptionKey: "settings.developer.commandSearch" },
  { command: "drifty timeline --day 2026-08-04", descriptionKey: "settings.developer.commandTimeline" },
] as const satisfies ReadonlyArray<{ command: string; descriptionKey: TranslationKey }>;

const unavailableArtifact = (installedPath: string): DeveloperArtifactStatus => ({
  state: "unavailableInBuild",
  installedPath,
  canInstall: false,
  canRepair: false,
  canUninstall: false,
  message: null,
});

const unavailableStatus: DeveloperToolsStatus = {
  cli: unavailableArtifact("~/.local/bin/drifty"),
  codexSkill: unavailableArtifact("~/.codex/skills/drifty"),
};

export function DeveloperSettingsSection({ client = developerToolsClient }: DeveloperSettingsSectionProps) {
  const { t } = useLocalization();
  const [status, setStatus] = useState<DeveloperToolsStatus | null>(null);
  const [busy, setBusy] = useState<{ artifact: ArtifactKey; operation: Operation } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!client.isAvailable()) {
      setStatus(unavailableStatus);
      return;
    }
    try {
      setError(null);
      setStatus(await client.getStatus());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => () => {
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
  }, []);

  const run = useCallback(async (artifact: ArtifactKey, operation: Operation) => {
    setBusy({ artifact, operation });
    setError(null);
    try {
      if (artifact === "cli") {
        await (operation === "install" ? client.installCli() : client.uninstallCli());
      } else {
        await (operation === "install" ? client.installCodexSkill() : client.uninstallCodexSkill());
      }
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(null);
    }
  }, [client, refresh]);

  const copy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => setCopiedValue(null), 1800);
    } catch {
      setError(t("settings.developer.copyError"));
    }
  }, [t]);

  const cliStatus = status?.cli;
  const skillStatus = status?.codexSkill;
  const cliPath = cliStatus?.installedPath ?? "~/.local/bin/drifty";
  const skillPath = skillStatus?.installedPath ?? "~/.codex/skills/drifty";

  return (
    <div className="settings-section settings-section--developer">
      <header className="developer-page-header">
        <h3>{t("settings.section.developer")}</h3>
        <p>{t("settings.developer.intro")}</p>
      </header>

      <section className="developer-group" aria-labelledby="developer-cli-heading">
        <div className="developer-section-heading">
          <h4 id="developer-cli-heading">{t("settings.developer.cliSectionTitle")}</h4>
          <p>{t("settings.developer.cliSectionDescription")}</p>
        </div>

        <div className="developer-cli-hero">
          <TerminalPreview />
          <div className="developer-cli-hero__content">
            <div>
              <span className="developer-eyebrow">{t("settings.developer.cliEyebrow")}</span>
              <h5>{t("settings.developer.cliValueTitle")}</h5>
              <p>{t("settings.developer.cliDescription")}</p>
            </div>
            <PathControl
              path={cliPath}
              copied={copiedValue === cliPath}
              label={t("settings.developer.cliPathLabel")}
              onCopy={() => void copy(cliPath)}
              copyLabel={t("settings.developer.copyPath")}
              copiedLabel={t("settings.developer.copied")}
            />
            <p className="developer-artifact-privacy">{t("settings.developer.cliPrivacy")}</p>
            {cliStatus?.message ? <p className="developer-artifact-message" role="status">{cliStatus.message}</p> : null}
            <ArtifactActions
              artifact="cli"
              status={cliStatus}
              busy={busy}
              title={t("settings.developer.cliTitle")}
              installLabel={t("settings.developer.installCli")}
              installedLabel={t("settings.developer.statusInstalled")}
              uninstallLabel={t("settings.developer.uninstall")}
              checkingLabel={t("settings.developer.checking")}
              installingLabel={t("settings.developer.installing")}
              uninstallingLabel={t("settings.developer.uninstalling")}
              repairLabel={t("settings.developer.repair")}
              onRun={run}
              t={t}
            />
          </div>
        </div>

        <div className="developer-command-list" aria-label={t("settings.developer.examplesLabel")}>
          {CLI_EXAMPLES.map(({ command, descriptionKey }) => (
            <div className="developer-command-row" key={command}>
              <span className="developer-command-row__icon" aria-hidden="true"><TerminalIcon /></span>
              <div className="developer-command-row__content">
                <code>{command}</code>
                <span>{t(descriptionKey)}</span>
              </div>
              <CopyButton
                copied={copiedValue === command}
                label={t("settings.developer.copyCommand", { command })}
                copiedLabel={t("settings.developer.copied")}
                onClick={() => void copy(command)}
              />
            </div>
          ))}
        </div>

        <p className="developer-shell-note">
          <InfoIcon />
          <span>{t("settings.developer.pathDescription")}</span>
        </p>
      </section>

      <section className="developer-group" aria-labelledby="developer-skill-heading">
        <div className="developer-section-heading">
          <h4 id="developer-skill-heading">{t("settings.developer.skillSectionTitle")}</h4>
          <p>{t("settings.developer.skillSectionDescription")}</p>
        </div>
        <div className="developer-skill-card">
          <span className="developer-skill-card__icon" aria-hidden="true"><SkillIcon /></span>
          <div className="developer-skill-card__content">
            <div>
              <h5>{t("settings.developer.skillTitle")}</h5>
              <p>{t("settings.developer.skillDescription")}</p>
            </div>
            <PathControl
              path={skillPath}
              copied={copiedValue === skillPath}
              label={t("settings.developer.skillPathLabel")}
              onCopy={() => void copy(skillPath)}
              copyLabel={t("settings.developer.copyPath")}
              copiedLabel={t("settings.developer.copied")}
            />
            <p className="developer-artifact-privacy">{t("settings.developer.skillPrivacy")}</p>
            {skillStatus?.message ? <p className="developer-artifact-message" role="status">{skillStatus.message}</p> : null}
          </div>
          <ArtifactActions
            artifact="codexSkill"
            status={skillStatus}
            busy={busy}
            title={t("settings.developer.skillTitle")}
            installLabel={t("settings.developer.installSkill")}
            installedLabel={t("settings.developer.skillInstalled")}
            uninstallLabel={t("settings.developer.removeSkill")}
            checkingLabel={t("settings.developer.checking")}
            installingLabel={t("settings.developer.installingSkill")}
            uninstallingLabel={t("settings.developer.removingSkill")}
            repairLabel={t("settings.developer.repair")}
            onRun={run}
            t={t}
          />
        </div>
      </section>

      {error ? (
        <div className="developer-tool-error" role="alert">
          <span>{error}</span>
          <button type="button" className="settings-btn" disabled={busy !== null} onClick={() => void refresh()}>{t("settings.developer.retry")}</button>
        </div>
      ) : null}
    </div>
  );
}

type ArtifactActionsProps = {
  readonly artifact: ArtifactKey;
  readonly status: DeveloperArtifactStatus | undefined;
  readonly busy: { artifact: ArtifactKey; operation: Operation } | null;
  readonly title: string;
  readonly installLabel: string;
  readonly installedLabel: string;
  readonly uninstallLabel: string;
  readonly checkingLabel: string;
  readonly installingLabel: string;
  readonly uninstallingLabel: string;
  readonly repairLabel: string;
  readonly onRun: (artifact: ArtifactKey, operation: Operation) => Promise<void>;
  readonly t: (key: TranslationKey) => string;
};

function ArtifactActions({
  artifact,
  status,
  busy,
  title,
  installLabel,
  installedLabel,
  uninstallLabel,
  checkingLabel,
  installingLabel,
  uninstallingLabel,
  repairLabel,
  onRun,
  t,
}: ArtifactActionsProps) {
  const activeBusy = busy?.artifact === artifact;
  const installActionLabel = status?.canRepair ? repairLabel : installLabel;
  const chipLabel = status
    ? status.state === "installed" ? installedLabel : statusLabel(status.state, t)
    : checkingLabel;

  return (
    <div className="developer-artifact-actions">
      <span className={`developer-status developer-status--${status?.state ?? "checking"}`} role="status">
        {status?.state === "installed" ? <CheckIcon /> : null}
        {chipLabel}
      </span>
      <div className="developer-artifact-actions__button-slot">
        {status?.canInstall || status?.canRepair ? (
          <button
            type="button"
            className="settings-btn settings-btn--primary"
            disabled={busy !== null}
            aria-label={`${installActionLabel}: ${title}`}
            onClick={() => void onRun(artifact, "install")}
          >
            {activeBusy && busy?.operation === "install" ? installingLabel : installActionLabel}
          </button>
        ) : null}
        {status?.canUninstall ? (
          <button
            type="button"
            className="settings-btn"
            disabled={busy !== null}
            aria-label={`${uninstallLabel}: ${title}`}
            onClick={() => void onRun(artifact, "uninstall")}
          >
            {activeBusy && busy?.operation === "uninstall" ? uninstallingLabel : uninstallLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

type PathControlProps = {
  readonly path: string;
  readonly copied: boolean;
  readonly label: string;
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly onCopy: () => void;
};

function PathControl({ path, copied, label, copyLabel, copiedLabel, onCopy }: PathControlProps) {
  return (
    <div className="developer-path-control">
      <span className="developer-path-control__label">{label}</span>
      <div className="developer-path-control__value">
        <code>{path}</code>
        <CopyButton copied={copied} label={`${copyLabel}: ${path}`} copiedLabel={copiedLabel} onClick={onCopy} />
      </div>
    </div>
  );
}

function CopyButton({ copied, label, copiedLabel, onClick }: { readonly copied: boolean; readonly label: string; readonly copiedLabel: string; readonly onClick: () => void }) {
  return (
    <button type="button" className={`developer-copy-button${copied ? " is-copied" : ""}`} aria-label={copied ? copiedLabel : label} onClick={onClick}>
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span className="developer-copy-button__feedback" aria-live="polite">{copied ? copiedLabel : ""}</span>
    </button>
  );
}

function TerminalPreview() {
  return (
    <div className="developer-terminal" aria-hidden="true">
      <div className="developer-terminal__bar">
        <span /><span /><span />
        <strong>Drifty CLI</strong>
      </div>
      <div className="developer-terminal__body">
        <p><span>$</span> drifty summary --day 2026-08-04</p>
        <div className="developer-terminal__rule" />
        <dl>
          <div><dt>RECORDED</dt><dd>2h 05m</dd></div>
          <div><dt>FOCUS</dt><dd>1h 42m</dd></div>
          <div><dt>TOP APP</dt><dd>Codex</dd></div>
        </dl>
        <p className="developer-terminal__hint">Local history · read only</p>
      </div>
    </div>
  );
}

function Icon({ children }: { readonly children: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

function TerminalIcon() {
  return <Icon><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7.5 9 2.5 2.5L7.5 14M12.5 14h4" /></Icon>;
}

function SkillIcon() {
  return <Icon><path d="M6.5 3.5h8l3 3v14h-11z" /><path d="M14.5 3.5v3h3M9.5 12h5M12 9.5v5" /></Icon>;
}

function CopyIcon() {
  return <Icon><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Icon>;
}

function CheckIcon() {
  return <Icon><path d="m5 12.5 4.2 4L19 7" /></Icon>;
}

function InfoIcon() {
  return <Icon><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Icon>;
}

function statusLabel(state: DeveloperArtifactState, t: (key: TranslationKey) => string) {
  const keys = {
    notInstalled: "settings.developer.statusNotInstalled",
    installed: "settings.developer.statusInstalled",
    needsRepair: "settings.developer.statusNeedsRepair",
    unavailableInBuild: "settings.developer.statusUnavailable",
  } as const;
  return t(keys[state]);
}
