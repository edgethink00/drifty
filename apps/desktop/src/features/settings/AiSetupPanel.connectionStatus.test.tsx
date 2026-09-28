// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_LOCAL_AI_SETUP } from "./localAiSetup";
import {
  invokeMock,
  renderPanel,
  resetManagedStatusMock,
  revealItemInDirMock,
  setManagedStatusMock,
} from "./AiSetupPanel.testHarness";

const { testCloudAiConnectionMock } = vi.hoisted(() => ({
  testCloudAiConnectionMock: vi.fn(),
}));

vi.mock("./cloudAiConnectionTest", () => ({
  testCloudAiConnection: testCloudAiConnectionMock,
}));

afterEach(cleanup);

describe("AiSetupPanel connection status", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    resetManagedStatusMock();
    revealItemInDirMock.mockClear();
    testCloudAiConnectionMock.mockClear();
    testCloudAiConnectionMock.mockResolvedValue({ kind: "success", message: "Cloud AI connected in 42 ms." });
  });

  it("shows the shared AI connection status in Model being used", () => {
    renderPanel({
      connectionStatus: {
        tone: "ok",
        label: "Connected",
        providerLabel: "Cloud AI",
        memoryLabel: null,
        issueKind: null,
      },
    });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    expect(within(modelBeingUsed).getByRole("status", { name: /AI status: Connected, Cloud AI/i })).toBeTruthy();
  });

  it("keeps connected Cloud status as the model card source of truth while showing a failed manual probe", async () => {
    testCloudAiConnectionMock.mockResolvedValueOnce({ kind: "error", issueKind: "provider", message: "Old provider error" });
    renderPanel({
      connectionStatus: {
        tone: "ok",
        label: "Connected",
        providerLabel: "Cloud AI",
        memoryLabel: null,
        issueKind: null,
      },
    });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /test ai connection/i }));

    await waitFor(() => expect(testCloudAiConnectionMock).toHaveBeenCalledTimes(1));
    expect(within(modelBeingUsed).getByRole("status", { name: /AI status: Connected, Cloud AI/i })).toBeTruthy();
    expect(within(modelBeingUsed).getByRole("alert").textContent).toContain("Old provider error");
  });

  it("clears a stale Cloud probe error when Cloud AI becomes connected", async () => {
    testCloudAiConnectionMock.mockResolvedValueOnce({ kind: "error", issueKind: "provider", message: "Old provider error" });
    const { setConnectionStatus } = renderPanel({
      connectionStatus: {
        tone: "error",
        label: "AI setup needed",
        providerLabel: "Open settings",
        memoryLabel: null,
        issueKind: null,
      },
    });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /test ai connection/i }));

    expect(await within(modelBeingUsed).findByText(/Old provider error/i)).toBeTruthy();
    act(() => {
      setConnectionStatus({
        tone: "ok",
        label: "Connected",
        providerLabel: "Cloud AI",
        memoryLabel: null,
        issueKind: null,
      });
    });

    expect(within(modelBeingUsed).getByRole("status", { name: /AI status: Connected, Cloud AI/i })).toBeTruthy();
    await waitFor(() => expect(within(modelBeingUsed).queryByText(/Old provider error/i)).toBeNull());
  });

  it("replaces a stale successful local probe with the current runtime failure", async () => {
    const modelId = "drifty-qwen3-5-2b-economy";
    setManagedStatusMock({
      state: "running",
      selectedModelId: modelId,
      installedModels: [{ id: modelId, artifactDir: "/tmp/qwen-2b" }],
      baseUrl: "http://127.0.0.1:39217/v1",
      model: "drifty-qwen3.5-2b-local",
      message: "Managed local AI runtime is running.",
      artifactDir: "/tmp/qwen-2b",
      progress: null,
      errorKind: null,
      memoryUsageBytes: 1_500_000_000,
    });
    const { setConnectionStatus } = renderPanel({
      connectionStatus: {
        tone: "ok",
        label: "Connected",
        providerLabel: "Qwen 3.5 2B",
        memoryLabel: "1.4 GB RAM",
        issueKind: null,
      },
      initialSetup: {
        ...DEFAULT_LOCAL_AI_SETUP,
        driftyRoute: "local",
        managedLocalModelId: modelId,
        managedLocalBaseUrl: "http://127.0.0.1:39217/v1",
        managedLocalModel: "drifty-qwen3.5-2b-local",
      },
    });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /test ai connection/i }));
    expect(await within(modelBeingUsed).findByText(/connected in 42 ms/i)).toBeTruthy();

    act(() => {
      setConnectionStatus({
        tone: "error",
        label: "Start failed",
        providerLabel: "Local AI",
        memoryLabel: "1.4 GB RAM",
        issueKind: "provider",
      });
    });

    await waitFor(() => expect(within(modelBeingUsed).queryByText(/connected in 42 ms/i)).toBeNull());
    expect(modelBeingUsed.querySelector(".ai-setup-current-model__status")?.textContent).toBe("Start failed");
  });
});
