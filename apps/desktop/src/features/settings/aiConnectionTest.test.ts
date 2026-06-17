import { beforeEach, describe, expect, it, vi } from "vitest";

import { testLocalAiConnection } from "./aiConnectionTest";
import { DEFAULT_LOCAL_AI_SETUP } from "./localAiSetup";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("testLocalAiConnection", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("preserves native string errors from managed local connection tests", async () => {
    invokeMock.mockRejectedValue("error sending request for url (http://127.0.0.1:39217/v1/chat/completions)");

    const result = await testLocalAiConnection({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "managed_local",
      driftyRoute: "local",
      managedLocalBaseUrl: "http://127.0.0.1:39217/v1",
      managedLocalModel: "drifty-qwen3.5-2b-local",
    });

    expect(result).toEqual({
      kind: "error",
      message: "error sending request for url (http://127.0.0.1:39217/v1/chat/completions)",
    });
  });
});
