// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomEndpointSetupPanel } from "./CustomEndpointSetupPanel";
import { OpenAiCompatibleModelListError } from "./openAiCompatibleModels";
import { PREVIEW_AI_MOCK_BASE_URL } from "./previewAiContract";

const { listModelsMock } = vi.hoisted(() => ({ listModelsMock: vi.fn() }));
vi.mock("./openAiCompatibleModels", async (importOriginal) => ({
  ...await importOriginal<typeof import("./openAiCompatibleModels")>(),
  listOpenAiCompatibleModels: listModelsMock,
}));

function renderPanel(onModelChange = vi.fn()) {
  render(
    <CustomEndpointSetupPanel
      baseUrl="http://localhost:11434/v1"
      apiKey="session-key"
      model="manual-model"
      sharingPartner="intelligence"
      baseUrlAriaLabel="Endpoint base URL"
      apiKeyAriaLabel="Endpoint API key"
      modelAriaLabel="Endpoint model"
      onBaseUrlChange={vi.fn()}
      onApiKeyChange={vi.fn()}
      onModelChange={onModelChange}
    />,
  );
  return onModelChange;
}

describe("CustomEndpointSetupPanel", () => {
  beforeEach(() => {
    listModelsMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("visibly labels the built-in preview endpoint", () => {
    render(
      <CustomEndpointSetupPanel
        baseUrl={PREVIEW_AI_MOCK_BASE_URL}
        apiKey=""
        model=""
        sharingPartner="classification"
        baseUrlAriaLabel="Endpoint base URL"
        apiKeyAriaLabel="Endpoint API key"
        modelAriaLabel="Endpoint model"
        onBaseUrlChange={vi.fn()}
        onApiKeyChange={vi.fn()}
        onModelChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Preview mock")).toBeTruthy();
    expect(screen.getByText(/shared with Classification;/)).toBeTruthy();
  });

  it("places the fetch strip between the connection fields and the model field", () => {
    renderPanel();

    const fetchButton = screen.getByRole("button", { name: "Fetch models" });
    const apiKeyInput = screen.getByLabelText("Endpoint API key");
    const modelPicker = screen.getByRole("combobox", { name: "Endpoint model" });
    expect(apiKeyInput.compareDocumentPosition(fetchButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fetchButton.compareDocumentPosition(modelPicker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("explains the fetch strip until a result replaces the hint", async () => {
    listModelsMock.mockResolvedValue({ models: [], totalCount: 0 });
    renderPanel();

    expect(screen.getByText("Loads the model list from this endpoint.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("No models were returned"));
    expect(screen.queryByText("Loads the model list from this endpoint.")).toBeNull();
  });

  it("uses one editable model control for manual IDs and fetched choices", async () => {
    listModelsMock.mockResolvedValue({ models: ["qwen2.5:7b", "qwen2.5:14b"], totalCount: 2 });
    const onModelChange = renderPanel();

    expect((screen.getByLabelText("Endpoint API key") as HTMLInputElement).type).toBe("password");
    const modelPicker = screen.getByRole("combobox", { name: "Endpoint model" });
    expect((modelPicker as HTMLInputElement).value).toBe("manual-model");
    expect(screen.queryByText("Manual model ID")).toBeNull();

    fireEvent.change(modelPicker, { target: { value: "typed-model" } });
    expect(onModelChange).toHaveBeenCalledWith("typed-model");

    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));

    expect(await screen.findByText("2 models found.")).toBeTruthy();
    expect(document.activeElement).toBe(modelPicker);
    fireEvent.click(within(screen.getByRole("listbox", { name: "Available endpoint models" })).getByRole("option", { name: "qwen2.5:14b" }));
    expect(onModelChange).toHaveBeenCalledWith("qwen2.5:14b");
    expect(listModelsMock).toHaveBeenCalledWith("http://localhost:11434/v1", "session-key");
  });

  it("keeps manual model input when the endpoint returns no models", async () => {
    listModelsMock.mockResolvedValue({ models: [], totalCount: 0 });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("No models were returned"));
    expect((screen.getByRole("combobox", { name: "Endpoint model" }) as HTMLInputElement).value).toBe("manual-model");
  });

  it("turns model-list failures into specific recoverable UI guidance", async () => {
    listModelsMock.mockRejectedValue(new OpenAiCompatibleModelListError("http", "provider detail", 401));
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(
      "Authentication failed (HTTP 401). Check the API key or permissions.",
    ));
    expect((screen.getByRole("combobox", { name: "Endpoint model" }) as HTMLInputElement).value).toBe("manual-model");
  });

  it("discards a fetched list when the connection changes before the response arrives", async () => {
    let resolveModels: (result: { readonly models: string[]; readonly totalCount: number }) => void = () => undefined;
    listModelsMock.mockReturnValue(new Promise((resolve) => { resolveModels = resolve; }));
    const props = {
      apiKey: "session-key",
      model: "manual-model",
      sharingPartner: "intelligence",
      baseUrlAriaLabel: "Endpoint base URL",
      apiKeyAriaLabel: "Endpoint API key",
      modelAriaLabel: "Endpoint model",
      onBaseUrlChange: vi.fn(),
      onApiKeyChange: vi.fn(),
      onModelChange: vi.fn(),
    } as const;
    const { rerender } = render(<CustomEndpointSetupPanel {...props} baseUrl="https://old.example/v1" />);

    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
    rerender(<CustomEndpointSetupPanel {...props} baseUrl="https://new.example/v1" />);
    await act(async () => resolveModels({ models: ["old-endpoint-model"], totalCount: 1 }));

    expect(screen.queryByText("1 model found.")).toBeNull();
    expect(screen.queryByRole("listbox", { name: "Available endpoint models" })).toBeNull();
    expect((screen.getByRole("button", { name: "Fetch models" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("supports keyboard selection from fetched model suggestions", async () => {
    listModelsMock.mockResolvedValue({ models: ["qwen2.5:7b", "qwen2.5:14b"], totalCount: 2 });
    const onModelChange = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
    const modelPicker = await screen.findByRole("combobox", { name: "Endpoint model" });
    await screen.findByRole("listbox", { name: "Available endpoint models" });
    fireEvent.keyDown(modelPicker, { key: "ArrowDown" });
    fireEvent.keyDown(modelPicker, { key: "Enter" });

    expect(onModelChange).toHaveBeenCalledWith("qwen2.5:14b");
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Available endpoint models" })).toBeNull());
  });

  it("opens the model menu upward when there is not enough viewport space below", async () => {
    listModelsMock.mockResolvedValue({ models: ["qwen2.5:7b", "qwen2.5:14b"], totalCount: 2 });
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function rectForModelMenu(this: HTMLElement) {
      if (this.classList.contains("ai-setup-model-control")) {
        return { x: 0, y: 700, top: 700, right: 400, bottom: 740, left: 0, width: 400, height: 40, toJSON: () => ({}) };
      }
      if (this.classList.contains("settings-select-control__menu")) {
        return { x: 0, y: 744, top: 744, right: 400, bottom: 844, left: 0, width: 400, height: 100, toJSON: () => ({}) };
      }
      return originalRect.call(this);
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
    const modelPicker = await screen.findByRole("combobox", { name: "Endpoint model" });

    await waitFor(() => expect(modelPicker.closest(".ai-setup-model-control")?.getAttribute("data-menu-placement")).toBe("top"));
  });

  it("keeps Escape inside the open model menu instead of bubbling to the dialog", async () => {
    listModelsMock.mockResolvedValue({ models: ["qwen2.5:7b"], totalCount: 1 });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
    const modelPicker = await screen.findByRole("combobox", { name: "Endpoint model" });
    const parentKeyDown = vi.fn();
    document.body.addEventListener("keydown", parentKeyDown);

    fireEvent.keyDown(modelPicker, { key: "Escape" });

    expect(screen.queryByRole("listbox", { name: "Available endpoint models" })).toBeNull();
    expect(parentKeyDown).not.toHaveBeenCalled();
    document.body.removeEventListener("keydown", parentKeyDown);
  });
});

describe("CustomEndpointSetupPanel base URL without /v1", () => {
  beforeEach(() => {
    listModelsMock.mockReset();
    window.localStorage.clear();
  });

  function StatefulPanel({
    initialBaseUrl,
    onBaseUrlChange,
    onAddressRepaired,
  }: {
    readonly initialBaseUrl: string;
    readonly onBaseUrlChange: (value: string) => void;
    readonly onAddressRepaired?: (from: string, to: string) => void;
  }) {
    const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
    return (
      <CustomEndpointSetupPanel
        baseUrl={baseUrl}
        apiKey=""
        model=""
        sharingPartner="classification"
        baseUrlAriaLabel="Endpoint base URL"
        apiKeyAriaLabel="Endpoint API key"
        modelAriaLabel="Endpoint model"
        onBaseUrlChange={(value) => {
          onBaseUrlChange(value);
          setBaseUrl(value);
        }}
        onApiKeyChange={vi.fn()}
        onModelChange={vi.fn()}
        {...(onAddressRepaired ? {
          onAddressRepaired: (from: string, to: string) => {
            onAddressRepaired(from, to);
            setBaseUrl(to);
          },
        } : {})}
      />
    );
  }

  function serveModelsOnlyUnderV1() {
    listModelsMock.mockImplementation(async (baseUrl: string) => {
      if (baseUrl === "http://localhost:10100/v1") return { models: ["gpt-6-luna", "gpt-6-luna--fast"], totalCount: 2 };
      throw new OpenAiCompatibleModelListError("invalid-json", "The endpoint returned invalid JSON.");
    });
  }

  it("switches to the /v1 address when the bare address answers with a web page, opens its models and offers undo", async () => {
    serveModelsOnlyUnderV1();
    const onBaseUrlChange = vi.fn();
    render(<StatefulPanel initialBaseUrl="http://localhost:10100" onBaseUrlChange={onBaseUrlChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));

    const listbox = await screen.findByRole("listbox", { name: "Available endpoint models" });
    expect(within(listbox).getAllByRole("option").map((option) => option.textContent)).toEqual(["gpt-6-luna", "gpt-6-luna--fast"]);
    expect(onBaseUrlChange).toHaveBeenCalledWith("http://localhost:10100/v1");
    expect((screen.getByLabelText("Endpoint base URL") as HTMLInputElement).value).toBe("http://localhost:10100/v1");
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("the base URL was changed to http://localhost:10100/v1");

    fireEvent.click(within(notice).getByRole("button", { name: "Undo" }));

    expect((screen.getByLabelText("Endpoint base URL") as HTMLInputElement).value).toBe("http://localhost:10100");
    listModelsMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Check the base URL; it usually ends in /v1."));
    expect(listModelsMock).toHaveBeenCalledTimes(1);
  });

  it("hands the repair to a caller that shows its own notice", async () => {
    serveModelsOnlyUnderV1();
    const onAddressRepaired = vi.fn();
    const onBaseUrlChange = vi.fn();
    render(<StatefulPanel initialBaseUrl="http://localhost:10100" onBaseUrlChange={onBaseUrlChange} onAddressRepaired={onAddressRepaired} />);

    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));

    await screen.findByRole("listbox", { name: "Available endpoint models" });
    expect(onAddressRepaired).toHaveBeenCalledWith("http://localhost:10100", "http://localhost:10100/v1");
    expect(onBaseUrlChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("keeps the original error when the address already has a path", async () => {
    listModelsMock.mockRejectedValue(new OpenAiCompatibleModelListError("invalid-json", "The endpoint returned invalid JSON."));
    render(<StatefulPanel initialBaseUrl="http://localhost:10100/api" onBaseUrlChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Check the base URL; it usually ends in /v1."));
    expect(listModelsMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the original error when /v1 has no models either", async () => {
    listModelsMock.mockRejectedValue(new OpenAiCompatibleModelListError("http", "The endpoint returned HTTP 404.", 404));
    const onBaseUrlChange = vi.fn();
    render(<StatefulPanel initialBaseUrl="http://localhost:10100/" onBaseUrlChange={onBaseUrlChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Fetch models" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(listModelsMock).toHaveBeenNthCalledWith(2, "http://localhost:10100/v1", "");
    expect(onBaseUrlChange).not.toHaveBeenCalled();
  });
});
