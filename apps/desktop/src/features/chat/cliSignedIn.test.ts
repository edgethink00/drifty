import { describe, expect, it } from "vitest";
import { parseCliSignedIn } from "./cliSignedIn";

describe("parseCliSignedIn", () => {
  it("reads only the signed-in answer each CLI reports", () => {
    expect(parseCliSignedIn("claude", '{"loggedIn": false, "projectsDirectory": "/tmp"}', "")).toBe(false);
    expect(parseCliSignedIn("claude", '{"loggedIn": true}', "")).toBe(true);
    expect(parseCliSignedIn("claude", "unknown command", "")).toBeNull();
    expect(parseCliSignedIn("codex", "", "Logged in using ChatGPT")).toBe(true);
    expect(parseCliSignedIn("codex", "", "Not logged in")).toBe(false);
    expect(parseCliSignedIn("codex", "", "error")).toBeNull();
  });
});
