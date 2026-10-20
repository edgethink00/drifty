// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { invokeMock, renderPanel, resetManagedStatusMock, revealItemInDirMock } from "./AiSetupPanel.testHarness";

describe("AiSetupPanel custom endpoint setup", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    resetManagedStatusMock();
    revealItemInDirMock.mockClear();
  });

  it("keeps custom endpoint setup in its own row and stores it as self hosted", async () => {
    renderPanel();
    const sectionChoices = screen.getByRole("group", { name: /AI setup choices/i });

    fireEvent.click(within(sectionChoices).getByRole("button", { name: /^Custom endpoint setup row$/i }));
    const endpointSettings = screen.getByRole("group", { name: /^Custom endpoint settings$/i });
    fireEvent.change(within(endpointSettings).getByLabelText(/^Custom endpoint base URL$/i), { target: { value: "http://localhost:8080/v1" } });
    fireEvent.change(within(endpointSettings).getByLabelText(/^Custom endpoint model$/i), { target: { value: "gemma-4-12b-it" } });

    const modelBeingUsed = screen.getByRole("region", { name: /^Model being used$/i });
    expect(within(modelBeingUsed).getByRole("combobox", { name: /^AI provider$/i }).textContent).toContain("Custom endpoint");
    expect(within(modelBeingUsed).getByRole("combobox", { name: /^AI model$/i }).textContent).toContain("Custom endpoint");
    expect(within(endpointSettings).getByDisplayValue("http://localhost:8080/v1")).toBeTruthy();
    expect(within(endpointSettings).getByDisplayValue("gemma-4-12b-it")).toBeTruthy();
  });

  it("clears stale connection success while the shared endpoint is invalid and retests after recovery", async () => {
    renderPanel({
      initialSetup: {
        provider: "self_hosted",
        driftyRoute: "cloud",
        managedLocalModelId: "drifty-qwen3-5-4b-default",
        managedLocalBaseUrl: "",
        managedLocalModel: "",
        openRouterApiKey: "",
        openRouterModel: "deepseek/deepseek-v4-flash",
        openRouterFallbackModels: [],
        openaiApiKey: "",
        openaiModel: "gpt-6-luna",
        anthropicApiKey: "",
        anthropicModel: "claude-haiku-5-5",
        selfHostedBaseUrl: "https://models.example/v1",
        selfHostedApiKey: "",
        selfHostedModel: "classification-model",
      },
    });
    expect(await screen.findByText("Connected in 42 ms.")).toBeTruthy();
    const endpointSettings = screen.getByRole("group", { name: /^Custom endpoint settings$/i });
    const baseUrlInput = within(endpointSettings).getByLabelText(/^Custom endpoint base URL$/i);

    fireEvent.change(baseUrlInput, { target: { value: "not-a-valid-url" } });

    await waitFor(() => expect(screen.queryByText("Connected in 42 ms.")).toBeNull());
    fireEvent.change(baseUrlInput, { target: { value: "https://models.example/v1" } });
    await waitFor(() => expect(invokeMock.mock.calls.filter(([command]) => command === "ai_classification_openai_chat")).toHaveLength(2));
  });
});
