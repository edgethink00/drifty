// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAiSetupController } from "./useAiSetupController";
import type { LocalAiSetupState } from "./localAiSetup";
import type { AiConnectionTestResult } from "./aiConnectionTest";

const mocks = vi.hoisted(() => ({
  onLocalAiConnectionTestResult: null as ((setup: unknown, result: unknown) => void) | null,
  latestSetup: null as unknown,
  listModels: vi.fn(),
  testConnection: vi.fn(),
}));

vi.mock("./useAiConnectionTestRunner", () => ({
  useAiConnectionTestRunner: (options: { localAiSetup: unknown; onLocalAiConnectionTestResult: (setup: unknown, result: unknown) => void }) => {
    mocks.onLocalAiConnectionTestResult = options.onLocalAiConnectionTestResult;
    mocks.latestSetup = options.localAiSetup;
    return { result: null, running: false, runningFingerprint: null, clearResult: () => undefined, run: async () => undefined, runAuto: async () => undefined };
  },
}));
vi.mock("./aiConnectionTest", () => ({ testLocalAiConnection: mocks.testConnection }));
vi.mock("./openAiCompatibleModels", () => ({ listOpenAiCompatibleModels: mocks.listModels }));
vi.mock("./customEndpointApiKeyStore", () => ({
  loadCustomEndpointApiKey: vi.fn(async () => null),
  saveCustomEndpointApiKey: vi.fn(async () => undefined),
}));
vi.mock("./openRouterApiKeyStore", () => ({
  loadOpenRouterApiKey: vi.fn(async () => null),
  saveOpenRouterApiKey: vi.fn(async () => undefined),
}));
vi.mock("./managedLocalAiClient", () => ({
  getManagedLocalAiStatus: vi.fn(async () => { throw new Error("managed-local status unavailable in test"); }),
}));

const WEB_PAGE_FAILURE: AiConnectionTestResult = {
  kind: "error",
  issueKind: "provider",
  message: "The endpoint returned a web page instead of an API response. Check the base URL; it usually ends in /v1.",
  detail: { httpStatus: 200, responseKind: "html" },
};

describe("useAiSetupController custom endpoint address repair", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.listModels.mockReset();
    mocks.testConnection.mockReset();
    mocks.listModels.mockImplementation(async (baseUrl: string) => {
      if (baseUrl === "http://localhost:10100/v1") return { models: ["gpt-6-luna--fast"], totalCount: 1 };
      throw new Error("The endpoint returned invalid JSON.");
    });
    mocks.testConnection.mockResolvedValue({ kind: "success", message: "Connected in 9 ms." });
  });

  afterEach(() => window.localStorage.clear());

  async function renderWithBareAddress() {
    const rendered = renderHook(() => useAiSetupController());
    await act(async () => {
      rendered.result.current.setLocalAiSetup((current: LocalAiSetupState) => ({
        ...current,
        provider: "self_hosted",
        selfHostedBaseUrl: "http://localhost:10100",
        selfHostedModel: "gpt-6-luna--fast",
      }));
    });
    return rendered;
  }

  function reportTest(result: AiConnectionTestResult) {
    if (!mocks.onLocalAiConnectionTestResult) throw new Error("connection test callback not captured");
    mocks.onLocalAiConnectionTestResult(mocks.latestSetup, result);
  }

  it("switches to the verified /v1 address after a background test sees a web page, and undo restores it for good", async () => {
    const { result } = await renderWithBareAddress();

    await act(async () => { reportTest(WEB_PAGE_FAILURE); });
    await waitFor(() => expect(result.current.localAiSetup.selfHostedBaseUrl).toBe("http://localhost:10100/v1"));

    expect(mocks.testConnection).toHaveBeenCalledWith(expect.objectContaining({ selfHostedBaseUrl: "http://localhost:10100/v1", selfHostedModel: "gpt-6-luna--fast" }), expect.any(Function));
    expect(result.current.customEndpointAddressRepair).toEqual({ from: "http://localhost:10100", to: "http://localhost:10100/v1" });

    await act(async () => { result.current.undoCustomEndpointAddressRepair(); });
    expect(result.current.localAiSetup.selfHostedBaseUrl).toBe("http://localhost:10100");
    expect(result.current.customEndpointAddressRepair).toBeNull();

    mocks.listModels.mockClear();
    await act(async () => { reportTest(WEB_PAGE_FAILURE); });
    expect(mocks.listModels).not.toHaveBeenCalled();
    expect(result.current.localAiSetup.selfHostedBaseUrl).toBe("http://localhost:10100");
  });

  it("keeps the entered address when the candidate fails the connection test", async () => {
    mocks.testConnection.mockResolvedValue({ kind: "error", issueKind: "provider", message: "Provider returned HTTP 401." });
    const { result } = await renderWithBareAddress();

    await act(async () => { reportTest(WEB_PAGE_FAILURE); });
    await waitFor(() => expect(mocks.testConnection).toHaveBeenCalled());

    expect(result.current.localAiSetup.selfHostedBaseUrl).toBe("http://localhost:10100");
    expect(result.current.customEndpointAddressRepair).toBeNull();
  });

  it("tries a failing address only once per model and key while the app runs", async () => {
    mocks.testConnection.mockResolvedValue({ kind: "error", issueKind: "provider", message: "Provider returned HTTP 401." });
    const { result } = await renderWithBareAddress();

    await act(async () => { reportTest(WEB_PAGE_FAILURE); });
    await waitFor(() => expect(mocks.testConnection).toHaveBeenCalledTimes(1));
    await act(async () => { reportTest(WEB_PAGE_FAILURE); });
    await act(async () => { reportTest(WEB_PAGE_FAILURE); });

    expect(mocks.listModels).toHaveBeenCalledTimes(1);
    expect(mocks.testConnection).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.setLocalAiSetup((current: LocalAiSetupState) => ({ ...current, selfHostedModel: "gpt-6-luna" }));
    });
    await act(async () => { reportTest(WEB_PAGE_FAILURE); });
    await waitFor(() => expect(mocks.listModels).toHaveBeenCalledTimes(2));
  });

  it("does not touch the address after an authentication failure", async () => {
    const { result } = await renderWithBareAddress();

    await act(async () => {
      reportTest({ kind: "error", issueKind: "provider", message: "Provider returned HTTP 401.", detail: { httpStatus: 401, responseKind: "http_error" } });
    });

    expect(mocks.listModels).not.toHaveBeenCalled();
    expect(result.current.localAiSetup.selfHostedBaseUrl).toBe("http://localhost:10100");
  });
});
