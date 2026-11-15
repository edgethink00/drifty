import { describe, expect, it } from "vitest";
import { cliCommands, shortCliVersion } from "./cliInstall";

describe("CLI install helpers", () => {
  it("shows only the version number the CLIs report", () => {
    expect(shortCliVersion("2.1.322 (Claude Code)")).toBe("2.1.322");
    expect(shortCliVersion("codex-cli 0.166.0-alpha.6")).toBe("0.166.0");
    expect(shortCliVersion(null)).toBeNull();
  });

  it("gives Windows the PowerShell installer for Claude Code", () => {
    expect(cliCommands("claude_cli", true).install).toContain("install.ps1");
    expect(cliCommands("claude_cli", false).install).toContain("install.sh");
  });
});
