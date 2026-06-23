// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { invokeMock, renderPanel, resetManagedStatusMock, revealItemInDirMock } from "./AiSetupPanel.testHarness";

const { testCloudAiConnectionMock } = vi.hoisted(() => ({
  testCloudAiConnectionMock: vi.fn(),
}));

vi.mock("./cloudAiConnectionTest", () => ({
  testCloudAiConnection: testCloudAiConnectionMock,
}));

describe("AiSetupPanel connection status", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    resetManagedStatusMock();
    revealItemInDirMock.mockClear();
    testCloudAiConnectionMock.mockClear();
    testCloudAiConnectionMock.mockResolvedValue({ kind: "success", message: "Cloud AI connected via Google in 42 ms." });
  });

  it("shows the shared AI connection status in Model being used", () => {
    renderPanel({
      connectionStatus: {
        tone: "ok",
        label: "Connected",
        providerLabel: "Cloud AI",
      },
    });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    expect(within(modelBeingUsed).getByRole("status", { name: /AI status: Connected, Cloud AI/i })).toBeTruthy();
  });

  it("keeps connected Cloud status as the model card source of truth while showing a failed manual probe", async () => {
    testCloudAiConnectionMock.mockResolvedValueOnce({ kind: "error", message: "Old provider error" });
    renderPanel({
      connectionStatus: {
        tone: "ok",
        label: "Connected",
        providerLabel: "Cloud AI",
      },
    });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /test ai connection/i }));

    await waitFor(() => expect(testCloudAiConnectionMock).toHaveBeenCalledTimes(1));
    expect(within(modelBeingUsed).getByRole("status", { name: /AI status: Connected, Cloud AI/i })).toBeTruthy();
    expect(within(modelBeingUsed).getByRole("alert").textContent).toContain("Old provider error");
  });

  it("clears a stale Cloud probe error when Cloud AI becomes connected", async () => {
    testCloudAiConnectionMock.mockResolvedValueOnce({ kind: "error", message: "Old provider error" });
    const { setConnectionStatus } = renderPanel({
      connectionStatus: {
        tone: "error",
        label: "Disconnected",
        providerLabel: "Setup needed",
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
      });
    });

    expect(within(modelBeingUsed).getByRole("status", { name: /AI status: Connected, Cloud AI/i })).toBeTruthy();
    await waitFor(() => expect(within(modelBeingUsed).queryByText(/Old provider error/i)).toBeNull());
  });
});
