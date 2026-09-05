import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const sharedModalSurfaces = [
  ["Sign in", "./features/auth/AuthModal.tsx", /className="auth-modal modal-shell" data-modal-variant="standard"/],
  ["Send feedback", "./features/feedback/FeedbackModal.tsx", /className="auth-modal modal-shell feedback-modal"\s+data-modal-variant="standard"/],
  ["Delete account", "./features/auth/AccountDeletionModal.tsx", /className="auth-modal modal-shell account-deletion-modal"\s+data-modal-variant="compact"/],
  ["Delete history", "./features/settings/DeleteHistoryModal.tsx", /className="auth-modal modal-shell delete-history-modal"\s+data-modal-variant="compact"/],
  ["Public profile", "./features/profile/ProfileModals.tsx", /className="auth-modal modal-shell profile-modal" data-modal-variant="standard"/],
  ["Edit profile", "./features/profile/ProfileModals.tsx", /className="auth-modal modal-shell profile-modal profile-editor-modal" data-modal-variant="workspace"/],
  ["Profile embed", "./features/profile/ProfileEmbedsModal.tsx", /className="auth-modal modal-shell profile-modal profile-embeds-modal"\s+data-modal-variant="workspace"/],
  ["Rank embed", "./features/leaderboard/RankEmbedsModal.tsx", /className="auth-modal modal-shell profile-modal rank-embeds-modal"\s+data-modal-variant="workspace"/],
  ["New project", "./features/projects/ProjectEditorModal.tsx", /className="auth-modal modal-shell project-editor-modal"\s+data-modal-variant="standard"/],
  ["Debug log", "./features/settings/DebugLogModal.tsx", /className="auth-modal modal-shell debug-log-modal"\s+data-modal-variant="workspace"/],
  ["OpenRouter models", "./features/settings/AiSetupModelDialogs.tsx", /className="auth-modal modal-shell model-picker-modal" data-modal-variant="standard"/],
  ["Delete local model", "./features/settings/DeleteManagedModelModal.tsx", /className="auth-modal modal-shell ai-delete-model-modal"\s+data-modal-variant="compact"/],
  ["Invite to team", "./features/team/TeamWorkspace.tsx", /className="auth-modal modal-shell profile-modal team-modal"\s+data-modal-variant="standard"/],
  ["Team settings", "./features/team/TeamWorkspace.tsx", /className="auth-modal modal-shell profile-modal team-modal team-settings-modal"\s+data-modal-variant="workspace"/],
  ["Add a team", "./features/team/TeamWorkspace.tsx", /className="auth-modal modal-shell profile-modal team-modal team-editor-modal"\s+data-modal-variant="standard"/],
  ["New shared project", "./features/team/TeamProjectsView.tsx", /className="auth-modal modal-shell profile-modal team-modal project-editor-modal"\s+data-modal-variant="standard"/],
  ["Remove cloud device", "./features/cloud-devices/CloudDeviceManagementPanel.tsx", /className="cloud-device-confirm__panel modal-shell" data-modal-variant="compact"/],
  ["Delete synced cloud data", "./features/device-sync/DeviceSyncPurgeConfirmation.tsx", /className="history-confirm__panel modal-shell" data-modal-variant="compact"/],
  ["Delete selected records", "./features/history/HistoryView.tsx", /className="history-confirm__panel modal-shell" data-modal-variant="compact"/],
  ["Extreme nudge consent", "./features/onboarding/OnboardingDesignCodeContent.tsx", /className="dc-onb-confirm modal-shell"\s+data-modal-variant="expressive"/],
  ["Command palette", "./features/command-bar/CommandBar.tsx", /className="cmd-box modal-shell"\s+data-modal-variant="utility"/],
  ["Edit drift alarm copy", "./features/companion/DriftAlarmCopySettings.tsx", /className="auth-modal modal-shell drift-copy-modal"\s+data-modal-variant="workspace"/],
  ["Restore AI analysis", "./features/dashboard/DashboardAiRecoveryOverlay.tsx", /className="dashboard-ai-recovery__panel modal-shell" data-modal-variant="workspace"/],
  ["Upgrade to Pro", "./features/billing/UpgradePlanModal.tsx", /className="dashboard-ai-recovery__panel modal-shell"\s+data-modal-variant="workspace"/],
  ["Promo account handoff", "./features/billing/PromoHandoffAccountDialog.tsx", /className="auth-modal modal-shell"\s+data-modal-variant="standard"/],
  ["SSH agent sources", "./features/dev-signals/SshAgentSourcesModal.tsx", /className="auth-modal modal-shell agents-ssh-modal"\s+data-modal-variant="standard"/],
] as const;

const purposeBuiltDialogSurfaces = [
  ["Onboarding", "./features/onboarding/OnboardingModal.tsx", /className="onboarding-screen dc-onboarding-screen"\s+role="dialog"/],
  ["First-day preparation failure", "./features/onboarding/FirstDayPreparationScreen.tsx", /className="first-day-prep__panel"\s+role="alertdialog"/],
  ["Week activity inspector", "./features/dashboard/WeekActivityInspector.tsx", /className="week-activity-inspector"\s+style=\{layout\.style\}\s+role="dialog"/],
  ["Share card", "./features/share/ShareCardModal.tsx", /className="auth-modal profile-modal share-card-modal"\s+role="dialog"/],
  ["Companion drift alarm", "./features/companion/CompanionDriftAlarmCard.tsx", /function CompanionDriftAlarmCard[\s\S]*role=\{isPreview \? "group" : moment\.correctionStatus \? undefined : "alertdialog"\}/],
  ["Companion automatic close", "./features/companion/CompanionDriftAlarmCard.tsx", /function CompanionAutomaticCloseCard[\s\S]*role=\{isPreview \? "group" : "alertdialog"\}/],
] as const;

describe("modal system v2 contract", () => {
  it("keeps the approved 125% shell radii and variant insets as semantic tokens", () => {
    const tokens = read("./styles/tokens-base.css");

    expect(tokens).toContain("--modal-radius-compact: 22.5px;");
    expect(tokens).toContain("--modal-radius-standard: 25px;");
    expect(tokens).toContain("--modal-radius-workspace: 25px;");
    expect(tokens).toContain("--modal-radius-expressive: 30px;");
    expect(tokens).toContain("--modal-radius-utility: 20px;");
    expect(tokens).toContain("--modal-inset-compact: 24px;");
    expect(tokens).toContain("--modal-inset-standard: 32px;");
    expect(tokens).toContain("--modal-inset-workspace: 24px;");
    expect(tokens).toContain("--modal-inset-expressive: 28px;");
  });

  it("classifies every shared production modal surface under one explicit variant", () => {
    expect(sharedModalSurfaces).toHaveLength(26);

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
    expect(chrome).toMatch(/\.modal-btn\s*\{[^}]*border-radius:\s*var\(--radius-sm\);/);
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
    expect(recoveryStyles).not.toMatch(/\.dashboard-ai-recovery--trial-ended \.dashboard-ai-recovery__panel,\s*\.dashboard-ai-recovery--cloud-billing/);
    expect(planStyles).toMatch(/\.individual-plan-suite\s*\{[^}]*gap:\s*var\(--space-2\);[^}]*max-width:\s*42rem;/);
    expect(planStyles).toMatch(/@media \(max-width: 1080px\)\s*\{[^}]*\.dashboard-ai-recovery__plans \.individual-plan-cards[^}]*grid-template-columns:\s*1fr;/);
  });
});
