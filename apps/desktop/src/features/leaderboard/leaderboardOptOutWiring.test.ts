import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(fileURLToPath(new URL("../../App.tsx", import.meta.url)), "utf8");

describe("leaderboard leave wiring", () => {
  it("leaves the leaderboard in one step without a confirmation choice", () => {
    expect(appSource).toContain("onOptOut={() => void handleLeaderboardOptOut()}");
  });
});
