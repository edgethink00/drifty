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

  it("shows downloader-reported progress for a managed local model", async () => {
    setManagedStatusMock({
      state: "installing",
      selectedModelId: "drifty-qwen3-5-4b-default",
      installedModels: [],
      baseUrl: null,
      model: null,
      message: "Downloading managed local model... (44%)",
      artifactDir: null,
      progress: {
        percent: 44,
        downloadedBytes: 1_200_000_000,
        totalBytes: 2_740_937_888,
      },
      errorKind: null,
      memoryUsageBytes: null,
    });
    renderPanel();

    const localSettings = await screen.findByRole("group", { name: /Local AI settings/i });
    const qwenDefault = within(localSettings).getByRole("article", { name: /Qwen 3\.5 4B managed local model/i });
    const downloadButton = within(qwenDefault).getByRole("button", { name: /^Downloading 44%$/i });
    if (!(downloadButton instanceof HTMLButtonElement)) throw new Error("Download progress action should be a button.");
    expect(downloadButton.disabled).toBe(true);
    expect(within(qwenDefault).getByText("1.2/2.7 GB")).toBeTruthy();
    expect(within(qwenDefault).queryByRole("progressbar")).toBeNull();
  });

  it("shows a retry action when a managed local model download fails", async () => {
    setManagedStatusMock({
      state: "error",
      selectedModelId: "drifty-qwen3-5-4b-default",
      installedModels: [],
      baseUrl: null,
      model: null,
      message: "Managed local model download failed: network unavailable",
      artifactDir: null,
      progress: null,
      errorKind: "download_failed",
      memoryUsageBytes: null,
    });
    renderPanel();

    const localSettings = await screen.findByRole("group", { name: /Local AI settings/i });
    const qwenDefault = within(localSettings).getByRole("article", { name: /Qwen 3\.5 4B managed local model/i });
    const retryButton = within(qwenDefault).getByRole("button", { name: /^Retry$/i });
    if (!(retryButton instanceof HTMLButtonElement)) throw new Error("Retry action should be a button.");
    expect(retryButton.disabled).toBe(false);
    expect(screen.getByText(/network unavailable/i)).toBeTruthy();

    fireEvent.click(retryButton);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-qwen3-5-4b-default" }));
  });

  it("shows non-model managed local errors above the cards without a retry action", async () => {
    setManagedStatusMock({
      state: "error",
      selectedModelId: null,
      installedModels: [],
      baseUrl: null,
      model: null,
      message: "Managed local AI storage failed: disk full",
      artifactDir: null,
      progress: null,
      errorKind: null,
      memoryUsageBytes: null,
    });
    renderPanel();

    const localSettings = await screen.findByRole("group", { name: /Local AI settings/i });

    expect(within(localSettings).getByText(/disk full/i)).toBeTruthy();
    expect(within(localSettings).queryByRole("button", { name: /^Retry$/i })).toBeNull();
  });
});
