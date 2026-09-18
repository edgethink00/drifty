// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeMock, renderPanel, resetManagedStatusMock, revealItemInDirMock, setManagedStatusMock } from "./AiSetupPanel.testHarness";

afterEach(cleanup);

describe("AiSetupPanel managed local progress", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    resetManagedStatusMock();
    revealItemInDirMock.mockClear();
  });

  it("shows downloader-reported progress on the model dropdown download action", async () => {
    setManagedStatusMock({
      state: "installing",
      selectedModelId: "drifty-qwen3-5-4b-default",
      installedModels: [],
      baseUrl: null,
      model: null,
      message: "Downloading managed local model... (44%)",
      progress: {
        percent: 44,
        downloadedBytes: 1_200_000_000,
        totalBytes: 2_740_937_888,
      },
      artifactDir: null,
      errorKind: null,
      memoryUsageBytes: null,
    });
    renderPanel();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));

    await waitFor(() => {
      const downloadButton = within(modelBeingUsed).getByRole("button", { name: /^Download Qwen 3\.5 4B managed local model$/i });
      if (!(downloadButton instanceof HTMLButtonElement)) throw new Error("Download progress action should be a button.");
      expect(downloadButton.textContent).toBe("Downloading 44%");
      expect(downloadButton.disabled).toBe(true);
    });
  });

  it("shows a retry action on the download button when a managed local model download fails", async () => {
    setManagedStatusMock({
      state: "error",
      selectedModelId: "drifty-qwen3-5-4b-default",
      installedModels: [],
      baseUrl: null,
      model: null,
      message: "Managed local model download failed: network unavailable",
      progress: null,
      artifactDir: null,
      errorKind: "download_failed",
      memoryUsageBytes: null,
    });
    renderPanel();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));

    let retryButton: HTMLButtonElement | null = null;
    await waitFor(() => {
      const button = within(modelBeingUsed).getByRole("button", { name: /^Download Qwen 3\.5 4B managed local model$/i });
      if (!(button instanceof HTMLButtonElement)) throw new Error("Retry action should be a button.");
      expect(button.textContent).toBe("Retry");
      expect(button.disabled).toBe(false);
      retryButton = button;
    });
    fireEvent.click(retryButton!);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-qwen3-5-4b-default" }));
  });

  it("routes the installed-model Retry button directly to managed runtime start", async () => {
    setManagedStatusMock({
      state: "error",
      selectedModelId: "drifty-qwen3-5-2b-economy",
      installedModels: [{
        id: "drifty-qwen3-5-2b-economy",
        artifactDir: "/Users/test/Library/Application Support/Drifty/managed-ai/models/drifty-qwen3-5-2b-economy",
      }],
      baseUrl: "http://127.0.0.1:39217/v1",
      model: "drifty-qwen3.5-2b-local",
      message: "Managed local AI port is unavailable: port 39217 is already in use.",
      artifactDir: "/Users/test/Library/Application Support/Drifty/managed-ai/models/drifty-qwen3-5-2b-economy",
      progress: null,
      errorKind: "runtime_port_conflict",
      memoryUsageBytes: null,
    });
    renderPanel();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));
    const retry = await within(modelBeingUsed).findByRole("button", {
      name: /^Retry starting Qwen 3\.5 2B$/i,
    });
    fireEvent.click(retry);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_start", {
      modelId: "drifty-qwen3-5-2b-economy",
    }));
    expect(invokeMock).not.toHaveBeenCalledWith("managed_ai_install", expect.anything());
  });

  it("blocks a second installed-model selection while the current runtime is starting", async () => {
    setManagedStatusMock({
      state: "starting",
      selectedModelId: "drifty-qwen3-5-2b-economy",
      installedModels: [
        {
          id: "drifty-qwen3-5-2b-economy",
          artifactDir: "/Users/test/Library/Application Support/Drifty/managed-ai/models/drifty-qwen3-5-2b-economy",
        },
        {
          id: "drifty-qwen3-5-4b-default",
          artifactDir: "/Users/test/Library/Application Support/Drifty/managed-ai/models/drifty-qwen3-5-4b-default",
        },
      ],
      baseUrl: "http://127.0.0.1:39217/v1",
      model: "drifty-qwen3.5-2b-local",
      message: "Starting managed local AI runtime...",
      progress: null,
      artifactDir: "/Users/test/Library/Application Support/Drifty/managed-ai/models/drifty-qwen3-5-2b-economy",
      errorKind: null,
      memoryUsageBytes: null,
    });
    renderPanel();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));

    await waitFor(() => {
      for (const label of [/^Qwen 3\.5 2B · Lightweight$/i, /^Qwen 3\.5 4B · Balanced$/i]) {
        const option = within(modelBeingUsed).getByRole("option", { name: label });
        if (!(option instanceof HTMLButtonElement)) throw new Error("Managed model option should be a button.");
        expect(option.disabled).toBe(true);
      }
    });
  });
});
