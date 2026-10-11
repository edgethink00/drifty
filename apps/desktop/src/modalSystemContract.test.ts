import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

/** A panel only animates when a ModalPresence boundary owns it, and adoption is
 * per surface rather than global. Registering every animated panel here makes an
 * unwrapped new modal fail loudly: the account plan dialog shipped motionless
 * because adding a modal broke no test. */
const animatedModalPanelFiles = [
  "./features/auth/AccountDeletionModal.tsx",
  "./features/auth/AuthModal.tsx",
  "./features/billing/PromoHandoffAccountDialog.tsx",
  "./features/billing/ProDecisionSheet.tsx",
  "./features/cloud-devices/CloudDeviceManagementPanel.tsx",
  "./features/command-bar/CommandBar.tsx",
  "./features/companion/DriftAlarmCopySettings.tsx",
  "./features/dashboard/DashboardAiRecoveryOverlay.tsx",
  "./features/dev-signals/SshAgentSourcesModal.tsx",
  "./features/device-sync/DeviceSyncPurgeConfirmation.tsx",
  "./features/device-sync/DeviceSyncSetupModal.tsx",
  "./features/feedback/FeedbackModal.tsx",
  "./features/history/HistoryView.tsx",
  "./features/leaderboard/RankEmbedsModal.tsx",
  "./features/onboarding/AutomaticCloseConfirmDialog.tsx",
  "./features/profile/ProfileEmbedsModal.tsx",
  "./features/profile/ProfileModals.tsx",
  "./features/projects/ProjectDeleteConfirmation.tsx",
  "./features/projects/ProjectEditorModal.tsx",
  "./features/settings/AiPrivacyDetailsModal.tsx",
  "./features/settings/AiSetupModelDialogs.tsx",
  "./features/settings/DebugLogModal.tsx",
  "./features/settings/DeleteHistoryModal.tsx",
  "./features/settings/DeleteManagedModelModal.tsx",
  "./features/settings/ExcludedAppHistoryConfirmation.tsx",
  "./features/share/ShareCardModal.tsx",
  "./features/team/TeamProjectsView.tsx",
  "./features/team/TeamWorkspace.tsx",
  "./features/updates/AvailableUpdateDialog.tsx",
] as const;

// A doc comment naming the selector must not register a file as a panel.
const ANIMATED_PANEL_MARKUP = /className="[^"]*\bmodal-shell\b|^\s*data-modal-motion-panel\s*$/m;

function productionComponentFiles(directory = ""): string[] {
  const base = fileURLToPath(new URL(`./${directory}`, import.meta.url));
  return readdirSync(base, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return productionComponentFiles(`${directory}${entry.name}/`);
    if (!entry.name.endsWith(".tsx") || entry.name.includes(".test.")) return [];
    return [`./${directory}${entry.name}`];
  });
}

const sharedModalSurfaces = [
  ["Sign in", "./features/auth/AuthModal.tsx", /className="auth-modal modal-shell" data-modal-variant="standard"/],
  ["Send feedback", "./features/feedback/FeedbackModal.tsx", /className="auth-modal modal-shell feedback-modal"\s+data-modal-variant="standard"/],
  ["Delete account", "./features/auth/AccountDeletionModal.tsx", /className="auth-modal modal-shell account-deletion-modal"\s+data-modal-variant="compact"/],
  ["Delete history", "./features/settings/DeleteHistoryModal.tsx", /className="auth-modal modal-shell delete-history-modal"\s+data-modal-variant="compact"/],
  ["Delete excluded app records", "./features/settings/ExcludedAppHistoryConfirmation.tsx", /className="auth-modal modal-shell excluded-app-history-modal"\s+data-modal-variant="compact"/],
  ["Public profile", "./features/profile/ProfileModals.tsx", /className="auth-modal modal-shell profile-modal" data-modal-variant="standard"/],
  ["Edit profile", "./features/profile/ProfileModals.tsx", /className="auth-modal modal-shell profile-modal profile-editor-modal" data-modal-variant="workspace"/],
  ["Profile embed", "./features/profile/ProfileEmbedsModal.tsx", /className="auth-modal modal-shell profile-modal profile-embeds-modal"\s+data-modal-variant="workspace"/],
  ["Rank embed", "./features/leaderboard/RankEmbedsModal.tsx", /className="auth-modal modal-shell profile-modal rank-embeds-modal"\s+data-modal-variant="workspace"/],
  ["New project", "./features/projects/ProjectEditorModal.tsx", /className="auth-modal modal-shell project-editor-modal"\s+data-modal-variant="standard"/],
  ["Delete project", "./features/projects/ProjectDeleteConfirmation.tsx", /className="auth-modal modal-shell project-delete-modal"\s+data-modal-variant="compact"/],
  ["Debug log", "./features/settings/DebugLogModal.tsx", /className="auth-modal modal-shell debug-log-modal"\s+data-modal-variant="workspace"/],
  ["OpenRouter models", "./features/settings/AiSetupModelDialogs.tsx", /className="auth-modal modal-shell model-picker-modal" data-modal-variant="standard"/],
  ["Delete local model", "./features/settings/DeleteManagedModelModal.tsx", /className="auth-modal modal-shell ai-delete-model-modal"\s+data-modal-variant="compact"/],
  ["Invite to team", "./features/team/TeamWorkspace.tsx", /className="auth-modal modal-shell profile-modal team-modal"\s+data-modal-variant="standard"/],
  ["Team settings", "./features/team/TeamWorkspace.tsx", /className="auth-modal modal-shell profile-modal team-modal team-settings-modal"\s+data-modal-variant="workspace"/],
  ["Add a team", "./features/team/TeamWorkspace.tsx", /className="auth-modal modal-shell profile-modal team-modal team-editor-modal"\s+data-modal-variant="standard"/],
  ["New shared project", "./features/team/TeamProjectsView.tsx", /className="auth-modal modal-shell profile-modal team-modal project-editor-modal"\s+data-modal-variant="standard"/],
  ["Remove cloud device", "./features/cloud-devices/CloudDeviceManagementPanel.tsx", /className="cloud-device-confirm__panel modal-shell" data-modal-variant="compact"/],
  ["Enable device sync", "./features/device-sync/DeviceSyncSetupModal.tsx", /className="auth-modal modal-shell device-sync-setup-modal" data-modal-variant="compact"/],
  ["Delete synced cloud data", "./features/device-sync/DeviceSyncPurgeConfirmation.tsx", /className="history-confirm__panel modal-shell" data-modal-variant="compact"/],
  ["Delete selected records", "./features/history/HistoryView.tsx", /className="history-confirm__panel modal-shell" data-modal-variant="compact"/],
  ["Automatic close consent", "./features/onboarding/AutomaticCloseConfirmDialog.tsx", /className="guide-close-confirm__panel modal-shell" data-modal-variant="compact"/],
  ["Command palette", "./features/command-bar/CommandBar.tsx", /className="cmd-box modal-shell"\s+data-modal-variant="utility"/],
  ["Edit drift alarm copy", "./features/companion/DriftAlarmCopySettings.tsx", /className="auth-modal modal-shell drift-copy-modal"\s+data-modal-variant="workspace"/],
  ["Restore AI analysis", "./features/dashboard/DashboardAiRecoveryOverlay.tsx", /className="dashboard-ai-recovery__panel modal-shell" data-modal-variant="workspace"/],
  ["Pro plan choice", "./features/billing/ProDecisionSheet.tsx", /className="pro-sheet__panel modal-shell"\s+data-modal-variant="workspace"/],
  ["Promo account handoff", "./features/billing/PromoHandoffAccountDialog.tsx", /className="auth-modal modal-shell"\s+data-modal-variant="standard"/],
  ["SSH agent sources", "./features/dev-signals/SshAgentSourcesModal.tsx", /className="auth-modal modal-shell agents-ssh-modal"\s+data-modal-variant="standard"/],
  ["Windows update", "./features/updates/AvailableUpdateDialog.tsx", /className="auth-modal modal-shell windows-update-prompt"\s+data-modal-variant="compact"/],
] as const;

const purposeBuiltDialogSurfaces = [
  ["Onboarding", "./features/onboarding/OnboardingModal.tsx", /className="onboarding-screen dc-onboarding-screen"\s+role="dialog"/],
  ["First-day preparation failure", "./features/onboarding/FirstDayPreparationScreen.tsx", /className="first-day-prep__panel"\s+role="alertdialog"/],
  ["Week activity inspector", "./features/dashboard/WeekActivityInspector.tsx", /className="week-activity-inspector"\s+style=\{layout\.style\}\s+role="dialog"/],
  ["Share card", "./features/share/ShareCardModal.tsx", /className="auth-modal share-card-modal"\s+role="dialog"/],
  ["Companion drift alarm", "./features/companion/CompanionDriftAlarmCard.tsx", /function CompanionDriftAlarmCard[\s\S]*role=\{isPreview \? "group" : moment\.correctionStatus \? undefined : "alertdialog"\}/],
  ["Companion automatic close", "./features/companion/CompanionDriftAlarmCard.tsx", /function CompanionAutomaticCloseCard[\s\S]*role=\{isPreview \? "group" : "alertdialog"\}/],
] as const;

describe("modal system v2 contract", () => {
  it("keeps the approved v3 shell radii and variant insets as semantic tokens", () => {
    const tokens = read("./styles/tokens-base.css");

    expect(tokens).toContain("--modal-radius-compact: 24px;");
    expect(tokens).toContain("--modal-radius-standard: 26px;");
    expect(tokens).toContain("--modal-radius-workspace: 26px;");
    expect(tokens).toContain("--modal-radius-expressive: 30px;");
    expect(tokens).toContain("--modal-radius-utility: 20px;");
    expect(tokens).toContain("--modal-inset-compact: 20px;");
    expect(tokens).toContain("--modal-inset-standard: 22px;");
    expect(tokens).toContain("--modal-inset-workspace: 22px;");
    expect(tokens).toContain("--modal-inset-expressive: 24px;");
  });

  /* The numbers above are one reviewed instance of a rule, and the rule is the
   * part that must not rot: a shell whose inset exceeds its radius stops
   * holding its own corner, which is exactly the gap v3 was opened to close.
   * Asserting the invariant means a future re-tune can move the values without
   * quietly re-introducing the flaw. */
  it("never lets a shell inset grow past its own corner radius", () => {
    const tokens = read("./styles/tokens-base.css");

    const px = (name: string): number => {
      const line = tokens.split("\n").find((entry) => entry.trim().startsWith("--modal-" + name + ":"));
      expect(line, "--modal-" + name + " should be declared").toBeDefined();
      return Number.parseFloat(line!.split(":")[1]);
    };

    for (const variant of ["compact", "standard", "workspace", "expressive"] as const) {
      expect(
        px("inset-" + variant),
        variant + " inset must stay inside its corner radius so the shell closes around its last element",
      ).toBeLessThanOrEqual(px("radius-" + variant));
    }
  });

  /* A fixed corner offset lines the close control up with nothing. Anchoring it
   * to the header's first line is what lets one rule serve both a title-only
   * header and a title + subtitle header, and anchoring `right` to the content
   * inset is what puts it on the same vertical line as the fields below it. */
  it("anchors the close control to the header's first line and the content inset", () => {
    const chrome = read("./styles/modal-chrome.css");

    expect(chrome).toContain("--modal-close-anchor: 1.44rem;");
    expect(chrome).toMatch(
      /\.modal-shell \.modal-x \{[^}]*top: var\(--modal-close-top\);[^}]*right: var\(--modal-shell-inset\);/,
    );
    // Headers that open on something taller than a text line restate the anchor.
    expect(chrome).toContain(".modal-shell:has(.profile-modal__crest)");
    expect(chrome).toMatch(/\.dashboard-ai-recovery__panel\.modal-shell \{[^}]*--modal-close-anchor:/);
  });

  /* Modal actions are a deliberately sized variant of the app action: shared
   * intent colours and typography, taller and rounder box. Both halves are
   * asserted so the split stays a decision rather than drift. */
  it("keeps the modal action on its own height and radius tokens", () => {
    const tokens = read("./styles/tokens-base.css");
    const chrome = read("./styles/modal-chrome.css");

    expect(tokens).toContain("--modal-action-height: 2.25rem;");
    expect(tokens).toContain("--modal-action-radius: 11px;");
    expect(chrome).toMatch(/\.modal-btn\s*\{[^}]*--btn-h: var\(--modal-action-height\);/);
    expect(chrome).toMatch(/\.modal-btn\s*\{[^}]*border-radius:\s*var\(--modal-action-radius\);/);
  });

  /* The filled action stays on the neutral ink ramp on hover. Jumping to the
   * brand accent read as a different button rather than the same one reacting,
   * and clashed with the user's own project colour in the editor dialog. */
  it("hovers the filled modal action along the neutral ramp, not the accent", () => {
    const chrome = read("./styles/modal-chrome.css");

    expect(chrome).toMatch(
      /\.modal-btn--primary:hover:not\(:disabled\)\s*\{[^}]*background: var\(--text-muted\);/,
    );
    expect(chrome).not.toMatch(
      /\.modal-btn--primary:hover:not\(:disabled\)\s*\{[^}]*background: var\(--accent\);/,
    );
  });

  it("classifies every shared production modal surface under one explicit variant", () => {
    expect(sharedModalSurfaces).toHaveLength(30);

    for (const [name, path, pattern] of sharedModalSurfaces) {
      expect(read(path), `${name} should use its modal-shell variant`).toMatch(pattern);
    }
  });

  it("keeps every purpose-built production dialog family explicit", () => {
    expect(purposeBuiltDialogSurfaces).toHaveLength(6);

    for (const [name, path, pattern] of purposeBuiltDialogSurfaces) {
      expect(read(path), `${name} should remain an explicit purpose-built dialog`).toMatch(pattern);
    }
  });

  it("registers every file that renders an animated modal panel", () => {
    const discovered = productionComponentFiles().filter((file) => ANIMATED_PANEL_MARKUP.test(read(file)));

    expect(discovered.slice().sort()).toEqual([...animatedModalPanelFiles].sort());
  });

  it("holds one shared entry and exit timing for every modal", () => {
    const presence = read("./components/modal-presence.css");

    // Opening is the slower half so the panel reads as arriving; closing is a
    // decision already made, so it accelerates away.
    expect(presence).toContain("--modal-motion-duration: 150ms;");
    expect(presence).toMatch(/\[data-modal-presence="exiting"\]\s*\{[^}]*--modal-motion-duration: 80ms;/);
    expect(presence).toContain("--modal-motion-ease: cubic-bezier(.16, 1, .3, 1);");
    expect(presence).toMatch(/\[data-modal-presence="exiting"\]\s*\{[^}]*--modal-motion-ease: cubic-bezier\(.4, 0, 1, 1\);/);
  });

  it("keeps a portaled modal panel inside a presence boundary it owns", () => {
    for (const file of animatedModalPanelFiles) {
      const source = read(file);
      if (!source.includes("createPortal")) continue;

      expect(source, `${file} portals past any caller boundary, so it must render its own ModalPresence`)
        .toContain("<ModalPresence");
    }
  });

  it("routes device-sync purge confirmation through the in-app modal", () => {
    const app = read("./App.tsx");

    expect(app).toContain("<DeviceSyncPurgeConfirmation");
    expect(app).not.toContain("window.confirm(");
  });

  it("normalizes shell radius, inset, close placement, and generic header rhythm centrally", () => {
    const chrome = read("./styles/modal-chrome.css");

    expect(chrome).toContain("border-radius: var(--modal-shell-radius);");
    expect(chrome).toContain("padding: var(--modal-shell-inset);");
    expect(chrome).toContain(".modal-shell .modal-x");
    expect(chrome).toMatch(/\.modal-x\s*\{[^}]*border-radius:\s*999px;/);
    expect(chrome).toMatch(/\.modal-btn\s*\{[^}]*border-radius:\s*var\(--modal-action-radius\);/);
    expect(chrome).toContain(".modal-shell .modal-head__copy h2");
    expect(chrome).toContain(".cloud-device-confirm__panel.modal-shell .cloud-device-confirm__eyebrow");
  });

  it("keeps both team creation and project editors on the compact standard width", () => {
    const teamStyles = read("./features/team/team.css");

    expect(teamStyles).toMatch(/\.team-editor-modal,\s*\.project-editor-modal\s*\{\s*max-width: 30rem;/);
  });

  it("keeps tall auth-family dialogs reachable at the minimum app height", () => {
    const chrome = read("./styles/modal-chrome.css");

    expect(chrome).toContain(".auth-modal__overlay {");
    expect(chrome).toContain("align-items: flex-start;");
    expect(chrome).toContain("overflow: auto;");
    expect(chrome).toContain(".auth-modal__overlay > .auth-modal {");
    expect(chrome).toContain("margin: auto;");
  });

  it("keeps the full-screen AI recovery surface exposed as a modal dialog", () => {
    const recovery = read("./features/dashboard/DashboardAiRecoveryOverlay.tsx");
    const recoveryStyles = read("./features/dashboard/dashboard.css");
    const planStyles = read("./styles/settings-polish.css");

    expect(recovery).toContain('role="dialog" aria-modal="true" aria-label={t("dashboard.aiRecovery.panelAria")}');
    expect(recovery).toContain('mode="checkout"');
    expect(recoveryStyles).toMatch(/\.dashboard-ai-recovery__panel\s*\{[^}]*width:\s*min\(45rem, 100%\);/);
    expect(planStyles).toMatch(/\.individual-plan-suite\s*\{[^}]*gap:\s*var\(--space-2\);[^}]*max-width:\s*42rem;/);
    expect(planStyles).toMatch(/@media \(max-width: 1080px\)\s*\{[^}]*\.dashboard-ai-recovery__plans \.individual-plan-cards[^}]*grid-template-columns:\s*1fr;/);
  });
});

describe("modal overlays", () => {
  /** A click whose press began inside a dialog targets the overlay when the
   * release lands outside it, so a bare overlay onClick closed dialogs while a
   * field's text was being selected and dropped what had been typed. */
  const featuresDir = fileURLToPath(new URL("./features/", import.meta.url));
  const sources = (readdirSync(featuresDir, { recursive: true }) as string[])
    .filter((path) => path.endsWith(".tsx") && !path.endsWith(".test.tsx"))
    .map((path) => ({ path, text: readFileSync(featuresDir + path, "utf8") }));

  it("dismiss through useOverlayDismiss instead of a bare onClick", () => {
    const bare = sources
      .filter(({ text }) => /className="(?:auth-modal__overlay[^"]*|cmd-overlay[^"]*|pro-sheet)"[^>]*\bonClick=/.test(text))
      .map(({ path }) => path);
    expect(bare).toEqual([]);
    expect(sources.filter(({ text }) => text.includes("useOverlayDismiss(")).length).toBeGreaterThanOrEqual(19);
  });
});
