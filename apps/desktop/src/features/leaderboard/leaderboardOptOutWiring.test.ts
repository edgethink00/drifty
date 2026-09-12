import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(fileURLToPath(new URL("../../App.tsx", import.meta.url)), "utf8");

describe("leaderboard leave wiring", () => {
  it("forwards the leave-confirm privacy choice into the opt-out handler", () => {
    expect(appSource).toContain("onOptOut={(options) => void handleLeaderboardOptOut(options)}");
  });
});
