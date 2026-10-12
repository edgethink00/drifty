import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// docs/analytics/pro-funnel.md records the pending-checkout opt-out race as not
// reachable because the only writer of this preference sits in Settings >
// Privacy, behind the Pro sheet that cannot be dismissed while checkout opens.
// A new writer elsewhere reopens that live release check.
describe("product analytics preference writers", () => {
  it("are limited to the Privacy settings row", () => {
    const srcRoot = fileURLToPath(new URL("../../", import.meta.url));
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)
          && /\bwriteProductAnalyticsEnabled\(/.test(readFileSync(full, "utf8"))) {
          callers.push(path.relative(srcRoot, full));
        }
      }
    };
    walk(srcRoot);
    expect(callers.sort()).toEqual([
      "features/settings/DriftySharingRows.tsx",
      "lib/analytics/productAnalyticsPreference.ts",
    ]);
  });
});
