import { describe, expect, it } from "vitest";

import { connectionForChoice, providerForSection, sectionForProvider, setupCardForChoice, type ConnectionChoice } from "./aiSetupProviderSelection";
import { DEFAULT_LOCAL_AI_SETUP } from "./localAiSetup";

describe("connection choices from a lock screen", () => {
  const current = { ...DEFAULT_LOCAL_AI_SETUP, provider: "openrouter_byok" as const, openaiApiKey: "sk-keep", openaiModel: "gpt-6-luna" };

  it.each([
    ["openrouter", "openrouter_byok"],
    ["openai", "openai"],
    ["anthropic", "anthropic"],
    ["self_hosted", "self_hosted"],
  ] as const)("switches the connection to %s and keeps the saved credentials", (choice, provider) => {
    expect(connectionForChoice(current, choice)).toEqual({ ...current, provider });
  });

  it("selects Drifty Cloud as the route", () => {
    expect(connectionForChoice({ ...current, driftyRoute: "local" }, "cloud")).toMatchObject({ provider: "managed_local", driftyRoute: "cloud" });
  });

  it("opens the card that holds each keyed choice's credentials", () => {
    const keyed: Exclude<ConnectionChoice, "cloud">[] = ["openrouter", "openai", "anthropic", "self_hosted"];
    expect(keyed.map(setupCardForChoice)).toEqual(["openrouter", "openai", "anthropic", "custom"]);
  });

  it("maps every provider to a card and back", () => {
    for (const provider of ["managed_local", "openrouter_byok", "openai", "anthropic", "self_hosted"] as const) {
      expect(providerForSection(sectionForProvider(provider))).toBe(provider);
    }
  });
});
