import { useCallback, useEffect, useState } from "react";

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
        await (operation === "install" ? client.installCodexSkill() : client.uninstallCodexSkill());
      }
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(null);
    }
  }, [client, refresh]);

  const artifactRow = (
    artifact: ArtifactKey,
    title: string,
    description: string,
    privacy: string,
  ) => {
    const artifactStatus = status?.[artifact];
    const activeBusy = busy?.artifact === artifact;
    const actionLabel = artifactStatus?.canRepair
      ? t("settings.developer.repair")
      : t(artifact === "cli" ? "settings.developer.installCli" : "settings.developer.installSkill");
    return (
      <div className="settings-row settings-row--developer-tool">
        <div>
          <div className="lbl">{title}</div>
          <div className="desc">{description}</div>
          <code className="developer-tool-path">{artifactStatus?.installedPath ?? (artifact === "cli" ? "~/.local/bin/drifty" : "~/.codex/skills/drifty")}</code>
          <div className="desc developer-tool-privacy">{privacy}</div>
          {artifactStatus?.message ? <div className="desc" role="status">{artifactStatus.message}</div> : null}
        </div>
        <div className="ctrl developer-tool-controls">
          <span className={`chip${artifactStatus?.state === "installed" ? " green" : " gray"}`}>
            {artifactStatus ? statusLabel(artifactStatus.state, t) : t("settings.developer.checking")}
          </span>
          {artifactStatus?.canInstall || artifactStatus?.canRepair ? (
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              disabled={busy !== null}
              aria-label={`${actionLabel}: ${title}`}
              onClick={() => void run(artifact, "install")}
            >
              {activeBusy && busy?.operation === "install" ? t("settings.developer.installing") : actionLabel}
            </button>
          ) : null}
          {artifactStatus?.canUninstall ? (
            <button
              type="button"
              className="settings-btn"
              disabled={busy !== null}
              aria-label={`${t("settings.developer.uninstall")}: ${title}`}
              onClick={() => void run(artifact, "uninstall")}
            >
              {activeBusy && busy?.operation === "uninstall" ? t("settings.developer.uninstalling") : t("settings.developer.uninstall")}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="settings-section settings-section--developer">
      <div className="settings-block">
        <h3>{t("settings.section.developer")}</h3>
        <p className="settings-section-intro">{t("settings.developer.intro")}</p>
        {artifactRow(
          "cli",
          t("settings.developer.cliTitle"),
          t("settings.developer.cliDescription"),
          t("settings.developer.cliPrivacy"),
        )}
        {artifactRow(
          "codexSkill",
          t("settings.developer.skillTitle"),
          t("settings.developer.skillDescription"),
          t("settings.developer.skillPrivacy"),
        )}
      </div>
      <div className="settings-block">
        <h3>{t("settings.developer.notesTitle")}</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.developer.pathTitle")}</div>
            <div className="desc">{t("settings.developer.pathDescription")}</div>
          </div>
        </div>
      </div>
      {error ? (
        <div className="developer-tool-error" role="alert">
          <span>{error}</span>
          <button type="button" className="settings-btn" disabled={busy !== null} onClick={() => void refresh()}>{t("settings.developer.retry")}</button>
        </div>
      ) : null}
    </div>
  );
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
