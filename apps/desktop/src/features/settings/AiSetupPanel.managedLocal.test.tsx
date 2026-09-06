// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { invokeMock, renderPanel, resetManagedStatusMock, revealItemInDirMock } from "./AiSetupPanel.testHarness";

describe("AiSetupPanel managed local model setup", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    resetManagedStatusMock();
    revealItemInDirMock.mockClear();
  });

  it("keeps previously downloaded managed local models selectable after another model is installed", async () => {
    renderPanel();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));

    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /^Download Qwen 3\.5 4B managed local model$/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-qwen3-5-4b-default" }));

    // The dropdown stays open across the install, so the just-installed model and the
    // still-uninstalled Gemma model are both reachable without reopening the menu.
    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /^Download Gemma 4 12B managed local model$/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-gemma-4-12b-local" }));

    await waitFor(() => {
      const qwenOption = within(modelBeingUsed).getByRole("option", { name: /^Balanced · Qwen 3\.5 4B$/i });
      if (!(qwenOption instanceof HTMLButtonElement)) throw new Error("Installed managed model option should be a button.");
      expect(qwenOption.disabled).toBe(false);
    });
  });

  it("downloads a disabled managed local model from the global model picker action", async () => {
    renderPanel();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));
    const gemmaOption = within(modelBeingUsed).getByRole("option", { name: /^For higher-spec Macs · Gemma 4 12B$/i });
    if (!(gemmaOption instanceof HTMLButtonElement)) throw new Error("Disabled managed model option should be a button.");
    expect(gemmaOption.disabled).toBe(true);

    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /^Download Gemma 4 12B managed local model$/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-gemma-4-12b-local" }));
  });

  it("installs, reveals, and deletes the selected managed local model from the model dropdown", async () => {
    renderPanel();

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    fireEvent.click(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }));

    // Before install the model is not selectable and carries a Download action, not Delete / Show in Finder.
    expect(within(modelBeingUsed).queryByRole("button", { name: /^Delete Qwen 3\.5 4B managed local model$/i })).toBeNull();
    expect(within(modelBeingUsed).queryByRole("button", { name: /^Show Qwen 3\.5 4B in Finder$/i })).toBeNull();
    fireEvent.click(within(modelBeingUsed).getByRole("button", { name: /^Download Qwen 3\.5 4B managed local model$/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-qwen3-5-4b-default" }));

    // Once installed the row carries hover-revealed Show-in-Finder + Delete icon actions.
    const revealButton = await within(modelBeingUsed).findByRole("button", { name: /^Show Qwen 3\.5 4B in Finder$/i });
    fireEvent.click(revealButton);
    await waitFor(() => expect(revealItemInDirMock).toHaveBeenCalledWith("/Users/test/Library/Application Support/Drifty/managed-ai/models/drifty-qwen3-5-4b-default"));

    const deleteButton = await within(modelBeingUsed).findByRole("button", { name: /^Delete Qwen 3\.5 4B managed local model$/i });
    if (!(deleteButton instanceof HTMLButtonElement)) throw new Error("Delete control should be a button.");
    await waitFor(() => expect(deleteButton.disabled).toBe(false));
    fireEvent.click(deleteButton);

    // Deletion is destructive: the dropdown click only opens a confirmation dialog — nothing is deleted yet.
    expect(invokeMock).not.toHaveBeenCalledWith("managed_ai_delete", { modelId: "drifty-qwen3-5-4b-default" });
    const confirmDialog = screen.getByRole("dialog", { name: /Delete this model/i });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: /^Delete model$/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_delete", { modelId: "drifty-qwen3-5-4b-default" }));
  });
});
