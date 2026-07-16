// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { invokeMock, renderPanel, resetManagedStatusMock, revealItemInDirMock, setManagedStatusMock } from "./AiSetupPanel.testHarness";

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
});
