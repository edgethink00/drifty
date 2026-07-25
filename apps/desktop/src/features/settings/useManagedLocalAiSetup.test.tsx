// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalAiSetupState } from "./localAiSetup";
import {
  fallbackManagedLocalAiStatus,
  installingManagedLocalAiStatus,
  MANAGED_LOCAL_AI_FALLBACK_CATALOG,
} from "./managedLocalAiClient";
import { useManagedLocalAiSetup } from "./useManagedLocalAiSetup";

const clientMocks = vi.hoisted(() => ({
  getManagedLocalAiStatus: vi.fn(),
  listManagedLocalAiModels: vi.fn(),
}));

vi.mock("./managedLocalAiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./managedLocalAiClient")>();
  return {
    ...actual,
    getManagedLocalAiStatus: clientMocks.getManagedLocalAiStatus,
    listManagedLocalAiModels: clientMocks.listManagedLocalAiModels,
  };
});

const setLocalAiSetup = vi.fn<Dispatch<SetStateAction<LocalAiSetupState>>>();

describe("useManagedLocalAiSetup background failures", () => {
  beforeEach(() => {
    clientMocks.getManagedLocalAiStatus.mockReset();
    clientMocks.listManagedLocalAiModels.mockReset();
    setLocalAiSetup.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("contains a string rejection from the detached catalog refresh", async () => {
    clientMocks.listManagedLocalAiModels.mockRejectedValue("catalog unavailable");
    clientMocks.getManagedLocalAiStatus.mockResolvedValue(fallbackManagedLocalAiStatus("status unavailable"));

    const { result } = renderHook(() => useManagedLocalAiSetup(true, setLocalAiSetup));

    await waitFor(() => expect(clientMocks.listManagedLocalAiModels).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.catalog).toEqual(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
  });

  it("contains a string rejection from a detached status poll", async () => {
    vi.useFakeTimers();
    clientMocks.listManagedLocalAiModels.mockResolvedValue(MANAGED_LOCAL_AI_FALLBACK_CATALOG);
    clientMocks.getManagedLocalAiStatus
      .mockResolvedValueOnce(installingManagedLocalAiStatus("drifty-qwen3-5-4b-default"))
      .mockRejectedValueOnce("status poll unavailable")
      .mockResolvedValueOnce({
        ...installingManagedLocalAiStatus("drifty-qwen3-5-4b-default"),
        state: "running",
        baseUrl: "http://127.0.0.1:11434",
        model: "drifty-qwen3-5-4b-default",
        message: "Managed local AI is ready.",
      });

    const { result } = renderHook(() => useManagedLocalAiSetup(true, setLocalAiSetup));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status?.state).toBe("installing");

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientMocks.getManagedLocalAiStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status?.state).toBe("installing");

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clientMocks.getManagedLocalAiStatus).toHaveBeenCalledTimes(3);
    expect(result.current.status?.state).toBe("running");
  });
});
