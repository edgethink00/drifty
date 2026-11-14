import { describe, expect, it } from "vitest";
import { MAX_SCREEN_TEXT_LENGTH, normalizeScreenText, redactScreenTextSecrets, screenTextExcerpt } from "./screenText";

describe("screen text excerpts for classification", () => {
  it("removes credential shapes before text can leave the computer", () => {
    const raw = [
      "export OPENAI_API_KEY=sk-proj-abcdefghijklmnop1234",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
      "git remote https://alice:hunter2pass@github.com/acme/app.git",
      "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    ].join("\n");
    const redacted = redactScreenTextSecrets(raw);
    for (const secret of ["sk-proj-abcdefghijklmnop1234", "abcdefghijklmnopqrstuvwxyz012345", "hunter2pass", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"]) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain("OPENAI_API_KEY=[redacted]");
    expect(redacted).toContain("https://alice:[redacted]@github.com");
  });

  it("collapses whitespace, cuts near the limit at a word and passes its own provider check", () => {
    const raw = ("Quarterly roadmap review notes\n\n" + "launch checklist item ".repeat(40)).trim();
    const excerpt = screenTextExcerpt(raw)!;
    expect(excerpt.length).toBeLessThanOrEqual(MAX_SCREEN_TEXT_LENGTH);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).not.toMatch(/\s{2,}/);
    expect(normalizeScreenText(excerpt)).toBe(excerpt);
  });

  it("drops screens with too little readable text", () => {
    expect(screenTextExcerpt("  OK  \n ✓ ")).toBeUndefined();
    expect(screenTextExcerpt("password: hunter2hunter2")).toBeUndefined();
    expect(screenTextExcerpt("회의록 정리: 출시 일정과 담당자 확인")).toBe("회의록 정리: 출시 일정과 담당자 확인");
  });

  it("rejects instead of truncating at the provider boundary", () => {
    expect(normalizeScreenText("a".repeat(MAX_SCREEN_TEXT_LENGTH + 1))).toBeUndefined();
    expect(normalizeScreenText(" padded ")).toBeUndefined();
    expect(normalizeScreenText(42)).toBeUndefined();
    expect(normalizeScreenText("Sprint board")).toBe("Sprint board");
  });
});

