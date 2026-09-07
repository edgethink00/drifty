import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  developerToolsClient,
  type DeveloperArtifactState,
  type DeveloperArtifactStatus,
  type DeveloperSkillTarget,
  type DeveloperToolsClient,
  type DeveloperToolsStatus,
} from "../../lib/api/developerToolsClient";
import { useLocalization, type DisplayLanguage, type LocalizationController } from "../localization/LocalizationContext";
import { localizeSettingsError } from "../localization/settingsMessageTranslations";
import type { TranslationKey } from "../localization/translations";
import "./DeveloperSettingsSection.css";

type ArtifactKey = "cli" | DeveloperSkillTarget;
type Operation = "install" | "uninstall";

type DeveloperSettingsSectionProps = {
  readonly client?: DeveloperToolsClient;
};

const CLI_EXAMPLES = [
  { command: "drifty summary --day 2026-08-04", descriptionKey: "settings.developer.commandSummary" },
  { command: "drifty search --query \"CLI\"", descriptionKey: "settings.developer.commandSearch" },
  { command: "drifty timeline --day 2026-08-04", descriptionKey: "settings.developer.commandTimeline" },
] as const satisfies ReadonlyArray<{ command: string; descriptionKey: TranslationKey }>;

const SHELL_STARTUP_LINE = 'export PATH="$HOME/.local/bin:$PATH"';

const SKILL_TARGETS = [
  { id: "codex", nameKey: "settings.developer.skillTargetCodex", path: "~/.codex/skills" },
  { id: "claudeCode", nameKey: "settings.developer.skillTargetClaudeCode", path: "~/.claude/skills" },
  { id: "cursor", nameKey: "settings.developer.skillTargetCursor", path: "~/.cursor/skills" },
  { id: "openCode", nameKey: "settings.developer.skillTargetOpenCode", path: "~/.config/opencode/skills" },
] as const satisfies ReadonlyArray<{ id: DeveloperSkillTarget; nameKey: TranslationKey; path: string }>;

const SKILL_STATUS_KEYS = {
  codex: "codexSkill",
  claudeCode: "claudeCodeSkill",
  cursor: "cursorSkill",
  openCode: "openCodeSkill",
} as const satisfies Record<DeveloperSkillTarget, keyof DeveloperToolsStatus>;

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
  claudeCodeSkill: unavailableArtifact("~/.claude/skills/drifty"),
  cursorSkill: unavailableArtifact("~/.cursor/skills/drifty"),
  openCodeSkill: unavailableArtifact("~/.config/opencode/skills/drifty"),
};

const STATUS_MESSAGE_KEYS = {
  "Drifty could not inspect the installation path.": "settings.developer.inspectPathDetail",
  "A regular file or directory already uses this path. Drifty will not replace it.": "settings.developer.pathOccupiedDetail",
  "Drifty could not read the existing symbolic link.": "settings.developer.readLinkDetail",
  "The installed link points to an older or missing Drifty app. Repair it to use this app.": "settings.developer.oldLinkDetail",
  "This path points somewhere Drifty does not own. Drifty will not replace or remove it.": "settings.developer.foreignPathDetail",
} as const satisfies Readonly<Record<string, TranslationKey>>;

function localizeArtifactMessage(
  status: DeveloperArtifactStatus | undefined,
  artifact: ArtifactKey,
  agentName: string,
  language: DisplayLanguage,
  t: LocalizationController["t"],
): string | null {
  if (!status?.message) return null;
  if (language === "en") return status.message;
  if (status.state === "unavailableInBuild") {
    return artifact === "cli"
      ? t("settings.developer.cliUnavailableDetail")
      : t("settings.developer.skillUnavailableDetail", { agent: agentName });
  }
  const messageKey = STATUS_MESSAGE_KEYS[status.message as keyof typeof STATUS_MESSAGE_KEYS];
  return messageKey ? t(messageKey) : localizeSettingsError(status.message, language, t);
}

export function DeveloperSettingsSection({ client = developerToolsClient }: DeveloperSettingsSectionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [status, setStatus] = useState<DeveloperToolsStatus | null>(null);
  const [busy, setBusy] = useState<{ artifact: ArtifactKey; operation: Operation } | null>(null);
  const [selectedSkillTarget, setSelectedSkillTarget] = useState<DeveloperSkillTarget>("codex");
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
        await (operation === "install" ? client.installSkill(artifact) : client.uninstallSkill(artifact));
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
  const selectedTarget = SKILL_TARGETS.find((target) => target.id === selectedSkillTarget) ?? SKILL_TARGETS[0];
  const skillStatus = status?.[SKILL_STATUS_KEYS[selectedSkillTarget]];
  const skillPath = skillStatus?.installedPath ?? `${selectedTarget.path}/drifty`;
  const cliStatusMessage = localizeArtifactMessage(cliStatus, "cli", "CLI", effectiveLanguage, t);
  const skillStatusMessage = localizeArtifactMessage(skillStatus, selectedSkillTarget, t(selectedTarget.nameKey), effectiveLanguage, t);

  return (
    <div className="settings-section settings-section--developer">
      <div className="settings-block">
        <h3>{t("settings.section.developer")}</h3>
        <h4 className="developer-subheading">{t("settings.developer.cliSectionTitle")}</h4>
        {/* Terminal figure sits above the copy and the install action. */}
        <div data-setting-id="settings.developer.cliTitle" className="settings-row settings-row--fallback settings-row--group-start developer-cli-row">
          <div className="developer-cli-row__figure">
            <CommandPreview t={t} />
          </div>
          <div className="developer-cli-row__copy">
            <div className="lbl">{t("settings.developer.cliTitle")}</div>
            <div className="desc">{t("settings.developer.cliDescription")}</div>
            {cliStatusMessage ? <div className="desc developer-note developer-note--warn" role="status">{cliStatusMessage}</div> : null}
          </div>
          <div className="ctrl settings-row__actions">
            <ArtifactActions
              artifact="cli"
              status={cliStatus}
              busy={busy}
              title={t("settings.developer.cliTitle")}
              installLabel={t("settings.developer.installCli")}
              reinstallLabel={t("settings.developer.reinstall")}
              checkingLabel={t("settings.developer.checking")}
              installingLabel={t("settings.developer.installing")}
              reinstallingLabel={t("settings.developer.reinstalling")}
              repairLabel={t("settings.developer.repair")}
              onRun={run}
              t={t}
            />
          </div>
        </div>
        {cliStatus?.state === "installed" ? (
          <div className="settings-row">
            <div>
              <div className="lbl">{t("settings.developer.shellStartupLabel")}</div>
              <div className="desc">
                <CodeValue
                  value={SHELL_STARTUP_LINE}
                  copied={copiedValue === SHELL_STARTUP_LINE}
                  copyLabel={t("settings.developer.copyPath")}
                  copiedLabel={t("settings.developer.copied")}
                  onCopy={() => void copy(SHELL_STARTUP_LINE)}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Separate block, but pulled close to the CLI card above it. */}
      <div className="settings-block developer-commands-block">
        {CLI_EXAMPLES.map(({ command, descriptionKey }) => (
          <div className="settings-row" key={command}>
            <div>
              <div className="lbl"><code className="developer-code">{command}</code></div>
              <div className="desc">{t(descriptionKey)}</div>
            </div>
          </div>
        ))}
      </div>

      <div data-setting-id="settings.developer.skillSectionTitle" className="settings-block">
        <h3>{t("settings.developer.skillSectionTitle")}</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">{`${t(selectedTarget.nameKey)} ${t("settings.developer.agentSkillSuffix")}`}</div>
            <div className="desc">{t("settings.developer.skillDescription")}</div>
            {skillStatusMessage ? <div className="desc developer-note developer-note--warn" role="status">{skillStatusMessage}</div> : null}
          </div>
          <div className="ctrl settings-row__actions">
            <SkillTargetPicker
              status={status}
              busy={busy}
              selectedTarget={selectedSkillTarget}
              onSelectTarget={setSelectedSkillTarget}
              onInstall={(target) => run(target, "install")}
              t={t}
            />
            {skillStatus?.canUninstall ? (
              <button
                type="button"
                className="settings-btn"
                disabled={busy !== null}
                aria-label={`${t("settings.developer.removeSkill")}: ${t(selectedTarget.nameKey)}`}
                onClick={() => void run(selectedSkillTarget, "uninstall")}
              >
                {busy?.artifact === selectedSkillTarget && busy.operation === "uninstall"
                  ? t("settings.developer.removingSkill")
                  : t("settings.developer.removeSkill")}
              </button>
            ) : null}
          </div>
        </div>
        <div data-setting-id="settings.developer.skillPathLabel" className="settings-row">
          <div>
            <div className="lbl">{t("settings.developer.skillPathLabel")}</div>
            <div className="desc">
              <CodeValue
                value={skillPath}
                copied={copiedValue === skillPath}
                copyLabel={t("settings.developer.copyPath")}
                copiedLabel={t("settings.developer.copied")}
                onCopy={() => void copy(skillPath)}
              />
            </div>
            <div className="desc developer-note">{t("settings.developer.skillPrivacy")}</div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="developer-tool-error" role="alert">
          <span>{localizeSettingsError(error, effectiveLanguage, t)}</span>
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
  readonly reinstallLabel: string;
  readonly checkingLabel: string;
  readonly installingLabel: string;
  readonly reinstallingLabel: string;
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
  reinstallLabel,
  checkingLabel,
  installingLabel,
  reinstallingLabel,
  repairLabel,
  onRun,
  t,
}: ArtifactActionsProps) {
  const activeBusy = busy?.artifact === artifact;
  const isInstalled = status?.state === "installed";
  const installActionLabel = isInstalled ? reinstallLabel : status?.canRepair ? repairLabel : installLabel;
  const installingActionLabel = isInstalled ? reinstallingLabel : installingLabel;
  const canRunInstall = isInstalled || Boolean(status?.canInstall || status?.canRepair);
  const chipLabel = status ? statusLabel(status.state, t) : checkingLabel;
  // The action button already says what the state is ("Install CLI", "Repair",
  // "Reinstall"), so the chip only appears when there is no button to speak for
  // it — an unavailable build, or a path Drifty must not touch.
  const showStatusChip = !canRunInstall;

  return (
    <>
      {showStatusChip ? (
        <span className={`settings-beta-badge developer-status developer-status--${status?.state ?? "checking"}`} role="status">
          {chipLabel}
        </span>
      ) : null}
      {canRunInstall ? (
        <button
          type="button"
          className="settings-btn"
          disabled={busy !== null}
          aria-label={`${installActionLabel}: ${title}`}
          onClick={() => void onRun(artifact, "install")}
        >
          {activeBusy && busy?.operation === "install" ? installingActionLabel : installActionLabel}
        </button>
      ) : null}
    </>
  );
}

type CodeValueProps = {
  readonly value: string;
  readonly copied: boolean;
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly onCopy: () => void;
};

function CodeValue({ value, copied, copyLabel, copiedLabel, onCopy }: CodeValueProps) {
  return (
    <span className="developer-code-value">
      <code className="developer-code">{value}</code>
      <CopyButton copied={copied} label={`${copyLabel}: ${value}`} copiedLabel={copiedLabel} onClick={onCopy} />
    </span>
  );
}

/* Decorative terminal figure: one short command line, as in the original design.
   The example commands themselves live in the list below, and no activity
   numbers appear here, so nothing can be mistaken for recorded data. */
function CommandPreview({ t }: { readonly t: (key: TranslationKey) => string }) {
  return (
    <div className="developer-command-preview" aria-hidden="true">
      <div className="developer-command-preview__bar">
        <span /><span /><span />
        <strong>{t("settings.developer.terminalTitle")}</strong>
      </div>
      <div className="developer-command-preview__body">
        <p className="developer-command-preview__command"><span>$</span> drifty summary</p>
        <p className="developer-command-preview__hint">{t("settings.developer.examplesLabel")}</p>
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

type SkillTargetPickerProps = {
  readonly status: DeveloperToolsStatus | null;
  readonly busy: { artifact: ArtifactKey; operation: Operation } | null;
  readonly selectedTarget: DeveloperSkillTarget;
  readonly onSelectTarget: (target: DeveloperSkillTarget) => void;
  readonly onInstall: (target: DeveloperSkillTarget) => Promise<void>;
  readonly t: (key: TranslationKey) => string;
};

function SkillTargetPicker({ status, busy, selectedTarget, onSelectTarget, onInstall, t }: SkillTargetPickerProps) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Matches the AccountMenu popover contract: listeners only exist while the menu
  // is open, and Escape returns focus to the trigger instead of stranding it.
  useEffect(() => {
    if (!open) return undefined;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (pickerRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const handleInstall = async (target: DeveloperSkillTarget, artifact: DeveloperArtifactStatus | undefined) => {
    onSelectTarget(target);
    if (!artifact?.canInstall && !artifact?.canRepair) {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    await onInstall(target);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="developer-skill-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="developer-skill-picker__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy !== null}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{t("settings.developer.addSkillTo")}</span>
        <ChevronIcon />
      </button>
      {open ? (
        <div className="developer-skill-picker__menu" role="menu" aria-label={t("settings.developer.skillTargetsLabel")}>
          <p>{t("settings.developer.skillTargetsLabel")}</p>
          <div className="developer-skill-picker__options">
            {SKILL_TARGETS.map((target) => {
              const artifact = status?.[SKILL_STATUS_KEYS[target.id]];
              const isInstalled = artifact?.state === "installed";
              const actionable = Boolean(artifact?.canInstall || artifact?.canRepair);
              const actionLabel = isInstalled
                ? t("settings.developer.skillTargetAdded")
                : artifact?.canRepair
                  ? t("settings.developer.repair")
                  : t("settings.developer.skillTargetAdd");
              return (
                <button
                  type="button"
                  role="menuitem"
                  className={`developer-skill-picker__option${selectedTarget === target.id ? " is-selected" : ""}`}
                  disabled={(!actionable && !isInstalled) || busy !== null}
                  key={target.id}
                  onClick={() => void handleInstall(target.id, artifact)}
                >
                  <span className="developer-skill-picker__agent-icon" aria-hidden="true"><AgentIcon target={target.id} /></span>
                  <span className="developer-skill-picker__agent-copy">
                    <strong>{t(target.nameKey)}</strong>
                    <small>{target.path}</small>
                  </span>
                  <span className={`developer-skill-picker__action${isInstalled ? " is-installed" : ""}`}>
                    {isInstalled ? <CheckIcon /> : null}
                    {actionLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Icon({ children }: { readonly children: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

function CopyIcon() {
  return <Icon><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Icon>;
}

function CheckIcon() {
  return <Icon><path d="m5 12.5 4.2 4L19 7" /></Icon>;
}

function ChevronIcon() {
  return <Icon><path d="m7 9.5 5 5 5-5" /></Icon>;
}

function CodexIcon() {
  return <Icon><path d="m12 3.5 6.8 3.9v7.2L12 18.5l-6.8-3.9V7.4z" /><path d="m8.5 9.4 3.5 2 3.5-2M12 11.4v4" /></Icon>;
}

function AgentIcon({ target }: { readonly target: string }) {
  if (target === "codex") return <CodexIcon />;
  if (target === "claudeCode") return <Icon><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" /></Icon>;
  if (target === "cursor") return <Icon><path d="m4 7 8-4 8 4v10l-8 4-8-4z" /><path d="M4 7l8 4 8-4M12 11v10" /></Icon>;
  return <Icon><path d="M5 4h14v16H5z" /><path d="M9 9h6v6H9z" /></Icon>;
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
