import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import claudeCodeIcon from "../../assets/agent-tools/claude-ai-icon.svg";
import codexIcon from "../../assets/agent-tools/codex_light.svg";
import cursorIcon from "../../assets/agent-tools/cursor_light.svg";
import openCodeIcon from "../../assets/agent-tools/opencode.svg";
import { AnchoredPresence } from "../../components/AnchoredPresence";
import {
  developerToolsClient,
  type DeveloperArtifactStatus,
  type DeveloperSkillTarget,
  type DeveloperToolsClient,
  type DeveloperToolsStatus,
} from "../../lib/api/developerToolsClient";
import { createDeveloperToolsPreviewClient, resolveDeveloperToolsPreviewScenario } from "../../lib/api/developerToolsPreviewClient";
import { shouldUsePreviewData } from "../../lib/api/previewData";
import { localDateKey } from "../../lib/formatting";
import { useCopyFeedback } from "../../lib/useCopyFeedback";
import { useLocalization, type DisplayLanguage, type LocalizationController } from "../localization/LocalizationContext";
import { localizeSettingsError } from "../localization/settingsMessageTranslations";
import type { TranslationKey } from "../localization/translations";
import { CollapsiblePanel } from "./CollapsiblePanel";
import "./DeveloperSettingsSection.css";

type ArtifactKey = "cli" | DeveloperSkillTarget;
type Operation = "install" | "uninstall";
type BusyState = { readonly artifact: ArtifactKey; readonly operation: Operation } | null;
type Translate = LocalizationController["t"];

type DeveloperSettingsSectionProps = {
  readonly client?: DeveloperToolsClient;
  /** The Drifty API block, after the local tools: it reads the cloud copy, not this computer. */
  readonly api?: ReactNode;
  /** Whether added agents also read automatic memory, inside the agent skill row. */
  readonly memory?: ReactNode;
};

// Examples use today's date so a copied command returns the user's current
// day instead of a fixed day from when the screen was written.
function cliExamples(day: string): ReadonlyArray<{ command: string; descriptionKey: TranslationKey }> {
  return [
    { command: `drifty summary --day ${day}`, descriptionKey: "settings.developer.commandSummary" },
    { command: "drifty search --query \"CLI\"", descriptionKey: "settings.developer.commandSearch" },
    { command: `drifty timeline --day ${day}`, descriptionKey: "settings.developer.commandTimeline" },
  ];
}

const SHELL_STARTUP_LINE = 'export PATH="$HOME/.local/bin:$PATH"';
const DETAIL_FLAG = "--detail full";
const EXAMPLES_PANEL_ID = "developer-cli-examples";
const EXAMPLES_TOGGLE_ID = "developer-cli-examples-toggle";

type SkillTarget = {
  readonly id: DeveloperSkillTarget;
  readonly nameKey: TranslationKey;
  readonly statusKey: Exclude<keyof DeveloperToolsStatus, "cli">;
  readonly path: string;
  readonly icon: string;
  /** Black-on-light marks are inverted in dark mode, as in the Your Agents hover card. */
  readonly monochrome?: boolean;
  /** The OpenCode mark fills half of its canvas, so it is scaled into its slot. */
  readonly padded?: boolean;
};

const SKILL_TARGETS: ReadonlyArray<SkillTarget> = [
  { id: "codex", nameKey: "settings.developer.skillTargetCodex", statusKey: "codexSkill", path: "~/.codex/skills", icon: codexIcon, monochrome: true },
  { id: "claudeCode", nameKey: "settings.developer.skillTargetClaudeCode", statusKey: "claudeCodeSkill", path: "~/.claude/skills", icon: claudeCodeIcon },
  { id: "cursor", nameKey: "settings.developer.skillTargetCursor", statusKey: "cursorSkill", path: "~/.cursor/skills", icon: cursorIcon, monochrome: true },
  // The OpenCode mark carries its own light canvas, so it is inverted with the black marks.
  { id: "openCode", nameKey: "settings.developer.skillTargetOpenCode", statusKey: "openCodeSkill", path: "~/.config/opencode/skills", icon: openCodeIcon, monochrome: true, padded: true },
];

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

/** What a skill target can show and do, derived once for the row, chips and menu. */
type SkillTargetState = "loading" | "added" | "available" | "repair" | "blocked" | "unavailable";

function skillTargetState(status: DeveloperArtifactStatus | undefined): SkillTargetState {
  if (!status) return "loading";
  if (status.state === "installed") return "added";
  if (status.state === "unavailableInBuild") return "unavailable";
  if (status.canRepair) return "repair";
  if (status.canInstall) return "available";
  return "blocked";
}

// A plain browser has no native installer. The browser preview swaps in an
// in-memory stand-in so the screen can be reviewed in every state; the desktop
// app always talks to the native commands.
function resolveDefaultClient(): DeveloperToolsClient {
  if (developerToolsClient.isAvailable() || !shouldUsePreviewData()) return developerToolsClient;
  return createDeveloperToolsPreviewClient(resolveDeveloperToolsPreviewScenario(window.location.search));
}

function localizeArtifactMessage(
  status: DeveloperArtifactStatus | undefined,
  artifact: ArtifactKey,
  agentName: string,
  language: DisplayLanguage,
  t: Translate,
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

export function DeveloperSettingsSection({ client: providedClient, api, memory }: DeveloperSettingsSectionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [client] = useState(() => providedClient ?? resolveDefaultClient());
  const [status, setStatus] = useState<DeveloperToolsStatus | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState<string | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const { copiedKey: copiedValue, showCopied } = useCopyFeedback<string>();
  const [examples] = useState(() => cliExamples(localDateKey(new Date())));

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
      // A fresh install is the moment to show what to type next.
      if (artifact === "cli" && operation === "install") setExamplesOpen(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(null);
    }
  }, [client, refresh]);

  const copy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showCopied(value);
    } catch {
      setError(t("settings.developer.copyError"));
    }
  }, [showCopied, t]);

  const cliStatus = status?.cli;
  const cliInstalled = cliStatus?.state === "installed";
  const cliStatusMessage = localizeArtifactMessage(cliStatus, "cli", "CLI", effectiveLanguage, t);
  const cliPath = cliStatus && cliStatus.state !== "notInstalled" && cliStatus.state !== "unavailableInBuild" ? cliStatus.installedPath : null;
  // Skills run the CLI, so the agent row names the step that is still open.
  const cliPrerequisite: TranslationKey | null = cliStatus?.state === "notInstalled"
    ? "settings.developer.skillNeedsCli"
    : cliStatus?.state === "needsRepair" ? "settings.developer.skillNeedsCliRepair" : null;

  const agents = SKILL_TARGETS.map((target) => {
    const name = t(target.nameKey);
    const artifactStatus = status?.[target.statusKey];
    return {
      target,
      name,
      status: artifactStatus,
      state: skillTargetState(artifactStatus),
      message: localizeArtifactMessage(artifactStatus, target.id, name, effectiveLanguage, t),
    };
  });
  // A stale link is still an added skill, so it stays among the chips with its state.
  const addedAgents = agents.filter((agent) => agent.state === "added" || agent.state === "repair");
  // Problems are written out on the row, so they are never only inside the menu.
  const agentProblems = agents.filter((agent) => agent.message && (agent.state === "repair" || agent.state === "blocked"));
  const allUnavailable = status !== null && agents.every((agent) => agent.state === "unavailable");

  return (
    <div className="settings-section settings-section--developer">
      <div className="settings-block">
        <h3>{t("settings.section.developer")}</h3>
        <h4 className="developer-subheading">{t("settings.developer.cliSectionTitle")}</h4>
        <div data-setting-id="settings.developer.cliTitle" className="settings-row settings-row--group-start developer-cli-row">
          <div>
            <div className="lbl">{t("settings.developer.cliTitle")}</div>
            <div className="desc">{t("settings.developer.cliDescription")}</div>
            {cliPath ? <div className="desc developer-path"><code>{cliPath}</code></div> : null}
            {cliStatusMessage ? <div className="desc developer-note developer-note--warn" role="status">{cliStatusMessage}</div> : null}
          </div>
          <div className="ctrl settings-row__actions developer-row-actions">
            <CliControls status={cliStatus} busy={busy} name={t("settings.developer.cliTitle")} onRun={run} t={t} />
          </div>
        </div>
        {cliInstalled ? (
          <div className="settings-row developer-shell-row">
            <div>
              <div className="lbl">{t("settings.developer.shellStartupLabel")}</div>
              <div className="desc">{t("settings.developer.shellStartupDescription")}</div>
              <div className="desc">
                <CodeValue
                  value={SHELL_STARTUP_LINE}
                  copied={copiedValue === SHELL_STARTUP_LINE}
                  copyLabel={t("settings.developer.copyCommand")}
                  copiedLabel={t("settings.developer.copied")}
                  onCopy={() => void copy(SHELL_STARTUP_LINE)}
                />
              </div>
            </div>
          </div>
        ) : null}
        <div data-setting-id="settings.developer.examplesTitle" className="settings-row settings-row--group-end developer-examples-row">
          <button
            id={EXAMPLES_TOGGLE_ID}
            type="button"
            className="developer-disclosure"
            aria-expanded={examplesOpen}
            aria-controls={EXAMPLES_PANEL_ID}
            onClick={() => setExamplesOpen((current) => !current)}
          >
            <span>{t("settings.developer.examplesTitle")}</span>
            <ChevronIcon />
          </button>
          <CollapsiblePanel id={EXAMPLES_PANEL_ID} expanded={examplesOpen} labelledBy={EXAMPLES_TOGGLE_ID} contentClassName="developer-examples">
            <ul className="developer-examples__list">
              {examples.map(({ command, descriptionKey }) => (
                <li key={command}>
                  <CodeValue
                    value={command}
                    copied={copiedValue === command}
                    copyLabel={t("settings.developer.copyCommand")}
                    copiedLabel={t("settings.developer.copied")}
                    onCopy={() => void copy(command)}
                  />
                  <span className="developer-examples__desc">{t(descriptionKey)}</span>
                </li>
              ))}
            </ul>
            <p className="developer-examples__hint">{withCode(t("settings.developer.detailHint", { flag: CODE_SLOT }), DETAIL_FLAG)}</p>
          </CollapsiblePanel>
        </div>
      </div>

      <div data-setting-id="settings.developer.skillSectionTitle" className="settings-block">
        <h3>{t("settings.developer.skillSectionTitle")}</h3>
        <div className="settings-row settings-row--group-end developer-agent-row">
          <div>
            <div className="lbl">{t("settings.developer.skillRowTitle")}</div>
            <div className="desc">
              {t("settings.developer.skillDescription")}
              {cliPrerequisite ? <> <strong className="developer-prerequisite">{t(cliPrerequisite)}</strong></> : null}
            </div>
            {memory}
            {status === null ? null : allUnavailable ? (
              <div className="developer-agent-summary">
                <span className="developer-state developer-state--muted">{t("settings.developer.statusUnavailable")}</span>
              </div>
            ) : addedAgents.length === 0 ? (
              <div className="developer-agent-summary developer-agent-summary--empty">{t("settings.developer.skillAddedNone")}</div>
            ) : (
              <div className="developer-agent-summary">
                {/* The chips with their remove buttons say "added" on their own; the name stays for screen readers. */}
                <ul className="developer-agent-chips" aria-label={t("settings.developer.skillAddedTo")}>
                  {addedAgents.map((agent) => (
                    <AgentChip key={agent.target.id} agent={agent} busy={busy} onRemove={(target) => void run(target, "uninstall")} t={t} />
                  ))}
                </ul>
              </div>
            )}
            {agentProblems.map((agent) => (
              <div key={agent.target.id} className="desc developer-note developer-note--warn" role="status">
                {`${agent.name}: ${agent.message}`}
              </div>
            ))}
          </div>
          <div className="ctrl settings-row__actions developer-row-actions">
            <SkillTargetPicker
              agents={agents}
              busy={busy}
              disabled={status === null || allUnavailable}
              onInstall={(target) => run(target, "install")}
              t={t}
            />
          </div>
        </div>
      </div>

      {api}

      {error ? (
        <div className="developer-tool-error" role="alert">
          <span>{localizeSettingsError(error, effectiveLanguage, t)}</span>
          <button type="button" className="settings-btn" disabled={busy !== null} onClick={() => void refresh()}>{t("settings.developer.retry")}</button>
        </div>
      ) : null}
    </div>
  );
}

type CliControlsProps = {
  readonly status: DeveloperArtifactStatus | undefined;
  readonly busy: BusyState;
  readonly name: string;
  readonly onRun: (artifact: ArtifactKey, operation: Operation) => Promise<void>;
  readonly t: Translate;
};

/** One visible state and at most one action, and the action names what it does. */
function CliControls({ status, busy, name, onRun, t }: CliControlsProps) {
  const activeOperation = busy?.artifact === "cli" ? busy.operation : null;
  if (!status) return <span className="developer-state developer-state--muted" role="status">{t("settings.developer.checking")}</span>;

  let state: ReactNode = null;
  let action: { readonly operation: Operation; readonly label: string; readonly busyLabel: string } | null = null;
  if (status.state === "installed") {
    state = <span className="developer-state developer-state--ok"><CheckIcon />{t("settings.developer.statusInstalled")}</span>;
    if (status.canUninstall) action = { operation: "uninstall", label: t("settings.developer.removeSkill"), busyLabel: t("settings.developer.removingSkill") };
  } else if (status.state === "unavailableInBuild") {
    state = <span className="developer-state developer-state--muted">{t("settings.developer.statusUnavailable")}</span>;
  } else if (status.canRepair) {
    state = <span className="developer-state developer-state--warn">{t("settings.developer.statusNeedsRepair")}</span>;
    action = { operation: "install", label: t("settings.developer.repair"), busyLabel: t("settings.developer.repairing") };
  } else if (status.canInstall) {
    action = { operation: "install", label: t("settings.developer.installCli"), busyLabel: t("settings.developer.installing") };
  } else {
    // A path Drifty must not touch: say so, and offer nothing destructive.
    state = <span className="developer-state developer-state--warn">{t("settings.developer.statusAttention")}</span>;
  }

  const isBusy = action !== null && activeOperation === action.operation;
  return (
    <>
      {state}
      {action ? (
        <button
          type="button"
          className="settings-btn developer-action"
          disabled={busy !== null}
          aria-busy={isBusy || undefined}
          aria-label={`${isBusy ? action.busyLabel : action.label}: ${name}`}
          onClick={() => void onRun("cli", action.operation)}
        >
          {isBusy ? action.busyLabel : action.label}
        </button>
      ) : null}
    </>
  );
}

type AgentView = {
  readonly target: SkillTarget;
  readonly name: string;
  readonly status: DeveloperArtifactStatus | undefined;
  readonly state: SkillTargetState;
  readonly message: string | null;
};

function AgentMark({ target }: { readonly target: SkillTarget }) {
  return (
    <img
      className={[
        "developer-agent-mark",
        target.monochrome ? "developer-agent-mark--monochrome" : "",
        target.padded ? "developer-agent-mark--padded" : "",
      ].filter(Boolean).join(" ")}
      src={target.icon}
      alt=""
      aria-hidden="true"
      width={16}
      height={16}
    />
  );
}

/** An added agent, named, with its own remove control; a stale link shows its state instead. */
function AgentChip({ agent, busy, onRemove, t }: { readonly agent: AgentView; readonly busy: BusyState; readonly onRemove: (target: DeveloperSkillTarget) => void; readonly t: Translate }) {
  const removing = busy?.artifact === agent.target.id && busy.operation === "uninstall";
  const warn = agent.state === "repair";
  return (
    <li className={`developer-agent-chip${warn ? " developer-agent-chip--warn" : ""}${removing ? " is-busy" : ""}`} title={agent.status?.installedPath}>
      <AgentMark target={agent.target} />
      <span className="developer-agent-chip__name">{agent.name}</span>
      {warn ? (
        <span className="developer-agent-chip__state">{t("settings.developer.statusNeedsRepair")}</span>
      ) : null}
      {agent.state === "added" && agent.status?.canUninstall ? (
        <button
          type="button"
          className="developer-agent-chip__remove"
          disabled={busy !== null}
          aria-busy={removing || undefined}
          aria-label={removing ? `${t("settings.developer.removingSkill")}: ${agent.name}` : t("settings.developer.removeSkillFrom", { agent: agent.name })}
          title={t("settings.developer.removeSkillFrom", { agent: agent.name })}
          onClick={() => onRemove(agent.target.id)}
        >
          <CloseIcon />
        </button>
      ) : null}
    </li>
  );
}

type SkillTargetPickerProps = {
  readonly agents: ReadonlyArray<AgentView>;
  readonly busy: BusyState;
  readonly disabled: boolean;
  readonly onInstall: (target: DeveloperSkillTarget) => Promise<void>;
  readonly t: Translate;
};

function SkillTargetPicker({ agents, busy, disabled, onInstall, t }: SkillTargetPickerProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"below" | "above">("below");
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The trigger sits low on the Agents page, so a menu that always opened
  // downward left most agents below the window at the default size. Open
  // upward when the room below is short and there is more above;
  // offsetHeight ignores the entry animation's transform.
  useLayoutEffect(() => {
    if (!open) {
      setPlacement("below");
      return;
    }
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const anchor = trigger.getBoundingClientRect();
    const gap = 8;
    const roomBelow = window.innerHeight - anchor.bottom - gap;
    const roomAbove = anchor.top - gap;
    setPlacement(menu.offsetHeight > roomBelow && roomAbove > roomBelow ? "above" : "below");
  }, [open]);

  // Keyboard users land on the first agent they can act on; with none, on the menu itself.
  useEffect(() => {
    if (!open) return;
    const [first] = enabledSkillMenuItems(menuRef.current);
    (first ?? menuRef.current)?.focus();
  }, [open, placement]);

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

  const handleInstall = async (target: DeveloperSkillTarget) => {
    await onInstall(target);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = enabledSkillMenuItems(menuRef.current);
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (index + 1) % items.length
          : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    setOpen(true);
  };

  return (
    <div className="developer-skill-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="developer-skill-picker__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled || busy !== null}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{t("settings.developer.addSkillTo")}</span>
        <ChevronIcon />
      </button>
      <AnchoredPresence>{open ? (
        <div
          ref={menuRef}
          tabIndex={-1}
          className={`developer-skill-picker__menu${placement === "above" ? " developer-skill-picker__menu--above" : ""}`}
          role="menu"
          aria-label={t("settings.developer.skillTargetsLabel")}
          onKeyDown={handleMenuKeyDown}
        >
          <p>{t("settings.developer.skillTargetsLabel")}</p>
          <div className="developer-skill-picker__options">
            {agents.map((agent) => {
              const actionable = agent.state === "available" || agent.state === "repair";
              const installing = busy?.artifact === agent.target.id && busy.operation === "install";
              const actionLabel = installing
                ? t(agent.state === "repair" ? "settings.developer.repairing" : "settings.developer.addingSkill")
                : {
                  loading: t("settings.developer.checking"),
                  added: t("settings.developer.skillTargetAdded"),
                  available: t("settings.developer.skillTargetAdd"),
                  repair: t("settings.developer.repair"),
                  blocked: t("settings.developer.statusAttention"),
                  unavailable: t("settings.developer.statusUnavailable"),
                }[agent.state];
              return (
                <button
                  type="button"
                  role="menuitem"
                  className={[
                    "developer-skill-picker__option",
                    agent.state === "added" ? "is-added" : "",
                  ].filter(Boolean).join(" ")}
                  disabled={!actionable || busy !== null}
                  aria-busy={installing || undefined}
                  key={agent.target.id}
                  onClick={() => void handleInstall(agent.target.id)}
                >
                  <span className="developer-skill-picker__agent-icon"><AgentMark target={agent.target} /></span>
                  <span className="developer-skill-picker__agent-copy">
                    <strong>{agent.name}</strong>
                    <small>{agent.target.path}</small>
                  </span>
                  <span className={`developer-skill-picker__action developer-skill-picker__action--${agent.state}`}>
                    {agent.state === "added" ? <CheckIcon /> : null}
                    {actionLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}</AnchoredPresence>
    </div>
  );
}

function enabledSkillMenuItems(menu: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(menu?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? []);
}

// Translations carry the flag as a placeholder so word order can change; the
// placeholder becomes a code span here instead of plain text.
const CODE_SLOT = "\u0000";

function withCode(text: string, code: string): ReactNode {
  const [before, after] = text.split(CODE_SLOT);
  if (after === undefined) return text;
  return <>{before}<code className="developer-code">{code}</code>{after}</>;
}

type CodeValueProps = {
  readonly value: string;
  readonly copied: boolean;
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly onCopy: () => void;
};

export function CodeValue({ value, copied, copyLabel, copiedLabel, onCopy }: CodeValueProps) {
  return (
    <span className="developer-code-value">
      <code className="developer-code">{value}</code>
      <CopyButton copied={copied} label={`${copyLabel}: ${value}`} copiedLabel={copiedLabel} onClick={onCopy} />
    </span>
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

function CloseIcon() {
  return <Icon><path d="m7 7 10 10M17 7 7 17" /></Icon>;
}
