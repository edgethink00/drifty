import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENGLISH_TRANSLATIONS } from "../localization/translations";
import { localizedExcludedIdentityLabel } from "../localization/activityTranslations";

const inspectorSource = readFileSync(
  fileURLToPath(new URL("./WeekActivityInspector.tsx", import.meta.url)),
  "utf8",
);

describe("week inspector excluded labels", () => {
  it("translates excluded identities instead of rendering the empty model label", () => {
    const t = (key: keyof typeof ENGLISH_TRANSLATIONS) => ENGLISH_TRANSLATIONS[key];
    expect(localizedExcludedIdentityLabel({
      id: "excluded",
      label: "",
      exclusionSource: "user",
    }, t)).toBe("Excluded · My settings");
    expect(inspectorSource).toContain("localizedExcludedIdentityLabel(primaryIdentity");
    expect(inspectorSource).toContain("event.appName.trim() || primaryLabel");
  });
});
