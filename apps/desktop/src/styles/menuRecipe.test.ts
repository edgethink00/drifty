import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * One recipe for menus and select lists (owner choice 2026-11-11, "all solid"):
 * every menu takes its corner, inset and surface from the --menu-* tokens and
 * none of them is glass. Before this there were six corner sizes, item text
 * from 11px to 14.4px and two glass menus.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const MENUS: ReadonlyArray<readonly [file: string, selector: string]> = [
  ["./settings.css", ".settings-select-control__menu"],
  ["./settings.css", '.settings-select-control[data-placement="selected"] .settings-select-control__menu'],
  ["./prototype-compat.css", ".account-popover"],
  ["./prototype-compat.css", ".account-menu-language-submenu"],
  ["./classification.css", ".classification-correction"],
  ["./settings-polish.css", ".classification-rule-card__menu"],
  ["../features/dashboard/timeline-zoom.css", ".timeline-zoom .settings-select-control__menu"],
  ["../features/history/history.css", ".history-row-menu"],
  ["../features/leaderboard/leaderboard-screen.css", ".lb7-menu"],
  ["../features/projects/projects.css", ".projects-page .pt-menu"],
  ["../features/projects/projects.css", ".project-switcher__menu"],
  ["../features/team/team.css", ".content--team .pt-menu"],
  ["../features/team/team.css", ".team-board-menu"],
  ["../features/team/team.css", ".content--team .team-switcher-menu"],
  ["../features/team/TeamInviteDialog.css", ".team-invite__menu"],
  ["../features/cloud-devices/CloudDeviceManagementPanel.css", ".cloud-device-row__menu"],
  ["../features/settings/AppExclusionSettingsRows.css", ".excluded-apps-chip-menu"],
  ["../features/settings/AiSetupProviderDetails.css", ".ai-setup-model-control .settings-select-control__menu"],
  ["../features/settings/DeveloperSettingsSection.css", ".developer-skill-picker__menu"],
  ["../features/memory/work-memory-page.css", ".work-memory-menu__list"],
  ["../features/chat/chat.css", ".chat-picker .settings-select-control__menu"],
  ["../features/chat/chat.css", ".chat-task-menu"],
  ["../features/chat/chat.css", ".chat-feedback__menu"],
];

/** The rule for an exact selector that sets the menu's corner. */
function menuRule(source: string, selector: string): string {
  const rules = [...source.matchAll(/([^{}@]+?)\s*\{([^{}]*)\}/g)]
    .filter((match) => match[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim() === selector)
    .map((match) => match[2])
    .filter((body) => body.includes("border-radius"));
  expect(rules, selector + " sets its corner once").toHaveLength(1);
  return rules[0];
}

describe("menu recipe", () => {
  it("defines the recipe once", () => {
    const tokens = read("./tokens-base.css");
    for (const declaration of ["--menu-radius: 12px;", "--menu-pad: 5px;", "--menu-surface: var(--surface);", "--menu-item-radius: var(--radius-sm);", "--menu-item-size: var(--text-sm);"]) {
      expect(tokens).toContain(declaration);
    }
  });

  it.each(MENUS)("%s %s uses the shared corner and is not glass", (file, selector) => {
    const rule = menuRule(read(file), selector);
    expect(rule).toContain("border-radius: var(--menu-radius);");
    expect(rule).not.toContain("blur(");
    expect(rule).not.toContain("--shell-floating-surface");
  });
});
