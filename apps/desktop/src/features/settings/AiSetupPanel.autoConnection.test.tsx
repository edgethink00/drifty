// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { invokeMock, renderPanel, resetManagedStatusMock, revealItemInDirMock } from "./AiSetupPanel.testHarness";

describe("AiSetupPanel automatic local connection test", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    resetManagedStatusMock();
    revealItemInDirMock.mockClear();
  });

  it("tests an installed managed local model selected from the global model picker", async () => {
    const { onLocalAiConnectionTestResult } = renderPanel();

    const localSettings = await screen.findByRole("group", { name: /Local AI settings/i });
    const qwenDefault = within(localSettings).getByRole("article", { name: /Qwen 3\.5 4B managed local model/i });
    fireEvent.click(within(qwenDefault).getByRole("button", { name: /^Download$/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-qwen3-5-4b-default" }));

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    const modelSelect = within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i });
    fireEvent.click(modelSelect);
    const qwenOption = within(modelBeingUsed).getByRole("option", { name: /^Qwen 3\.5 4B$/i });
    if (!(qwenOption instanceof HTMLButtonElement)) throw new Error("Installed managed model option should be a button.");
    expect(qwenOption.disabled).toBe(false);
    fireEvent.click(qwenOption);

    expect(modelSelect.textContent).toContain("Qwen 3.5 4B");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("ai_classification_openai_chat", expect.objectContaining({
      request: expect.objectContaining({
        baseUrl: "http://127.0.0.1:39217/v1",
        model: "drifty-qwen3.5-4b-local",
      }),
    })));
    expect(await screen.findByText(/connected in 42 ms/i)).toBeTruthy();
    expect(onLocalAiConnectionTestResult).toHaveBeenCalledWith(expect.objectContaining({
      provider: "managed_local",
      driftyRoute: "local",
      managedLocalModelId: "drifty-qwen3-5-4b-default",
    }), {
      kind: "success",
      message: "Connected in 42 ms.",
    });
  });
});
