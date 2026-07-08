// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { invokeMock, renderPanel, resetManagedStatusMock, revealItemInDirMock, setManagedStatusMock } from "./AiSetupPanel.testHarness";

describe("AiSetupPanel managed local model setup", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    resetManagedStatusMock();
    revealItemInDirMock.mockClear();
  });

  it("normalizes missing desktop runtime errors into user-facing setup copy", async () => {
    setManagedStatusMock({
      state: "error",
      selectedModelId: null,
      installedModels: [],
      baseUrl: null,
      model: null,
      message: "Cannot read properties of undefined (reading 'invoke')",
      artifactDir: null,
      progress: null,
      errorKind: null,
      memoryUsageBytes: null,
    });

    renderPanel();

    const localSettings = await screen.findByRole("group", { name: /Local AI settings/i });
    expect(within(localSettings).getByText(/local model controls need the desktop runtime/i)).toBeTruthy();
    expect(within(localSettings).queryByText(/cannot read properties/i)).toBeNull();
  });

  it("keeps previously downloaded managed local models selectable after another model is installed", async () => {
    renderPanel();

    const localSettings = await screen.findByRole("group", { name: /Local AI settings/i });
    const qwenDefault = within(localSettings).getByRole("article", { name: /Qwen 3\.5 4B managed local model/i });
    fireEvent.click(within(qwenDefault).getByRole("button", { name: /^Download$/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-qwen3-5-4b-default" }));

    const gemma = within(localSettings).getByRole("article", { name: /Gemma 4 12B managed local model/i });
    fireEvent.click(within(gemma).getByRole("button", { name: /^Download$/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-gemma-4-12b-local" }));

    expect(within(qwenDefault).getByRole("button", { name: /^Show in Finder$/i })).toBeTruthy();
    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));
    const qwenOption = within(modelBeingUsed).getByRole("option", { name: /^Qwen 3\.5 4B$/i });
    if (!(qwenOption instanceof HTMLButtonElement)) throw new Error("Installed managed model option should be a button.");
    expect(qwenOption.disabled).toBe(false);
  });

  it("downloads a disabled managed local model from the global model picker action", async () => {
    renderPanel();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));
    const gemmaOption = within(modelBeingUsed).getByRole("option", { name: /^Gemma 4 12B$/i });
    if (!(gemmaOption instanceof HTMLButtonElement)) throw new Error("Disabled managed model option should be a button.");
    expect(gemmaOption.disabled).toBe(true);

    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /^Download Gemma 4 12B managed local model$/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-gemma-4-12b-local" }));
  });

  it("installs and deletes the selected managed local model from the Drifty row", async () => {
    renderPanel();

    const localSettings = await screen.findByRole("group", { name: /Local AI settings/i });
    const qwenDefault = within(localSettings).getByRole("article", { name: /Qwen 3\.5 4B managed local model/i });
    expect(within(qwenDefault).queryByRole("button", { name: /delete qwen 3\.5 4b managed local model/i })).toBeNull();
    expect(within(qwenDefault).queryByRole("button", { name: /^Start$/i })).toBeNull();
    fireEvent.click(within(qwenDefault).getByRole("button", { name: /^Download$/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-qwen3-5-4b-default" }));
    const showInFinderButton = within(qwenDefault).getByRole("button", { name: /^Show in Finder$/i });
    fireEvent.click(showInFinderButton);
    await waitFor(() => expect(revealItemInDirMock).toHaveBeenCalledWith("/Users/test/Library/Application Support/Drifty/managed-ai/models/drifty-qwen3-5-4b-default"));
    expect(within(qwenDefault).queryByRole("button", { name: /^Start$/i })).toBeNull();
    const deleteButton = within(qwenDefault).getByRole("button", { name: /delete qwen 3\.5 4b managed local model/i });
    if (!(deleteButton instanceof HTMLButtonElement)) throw new Error("Delete control should be a button.");
    await waitFor(() => expect(deleteButton.disabled).toBe(false));
    fireEvent.click(deleteButton);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_delete", { modelId: "drifty-qwen3-5-4b-default" }));
  });
});
