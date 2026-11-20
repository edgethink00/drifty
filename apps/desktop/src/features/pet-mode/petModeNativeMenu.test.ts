import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  openNativeAutomaticCloseMenu,
  openNativePetModeMenu,
  openNativePetTurnOffSuggestionMenu,
} from "./petModeNativeMenu";

const runtime = vi.hoisted(() => ({ isTauri: true }));
const bridge = vi.hoisted(() => ({ getState: vi.fn(), dispatch: vi.fn() }));
vi.mock("./petModeBridge", () => ({
  getNativePetQuickControlsState: bridge.getState,
  triggerNativePetQuickControlsAction: bridge.dispatch,
}));
const nativeWindow = vi.hoisted(() => ({ label: "pet-mode" }));
const nativeMenu = vi.hoisted(() => ({
  close: vi.fn().mockResolvedValue(undefined),
  create: vi.fn(),
  popup: vi.fn().mockResolvedValue(undefined),
}));
const nativeItems = vi.hoisted(() => ({
  create: vi.fn(),
  nextRid: 0,
}));

vi.mock("../companion/watcherBridge", () => ({
  isTauriRuntime: () => runtime.isTauri,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => nativeWindow,
}));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: {
    new: nativeMenu.create,
  },
  MenuItem: { new: nativeItems.create },
  Submenu: { new: nativeItems.create },
}));

beforeEach(() => {
  bridge.getState.mockReset().mockResolvedValue({ automaticCloseSavedEnabled: true, automaticCloseOverride: null });
  bridge.dispatch.mockReset().mockResolvedValue(undefined);
  nativeItems.create.mockReset();
  nativeItems.create.mockImplementation(async (options) => ({
    ...options,
    rid: ++nativeItems.nextRid,
    kind: "MenuItem",
    close: vi.fn().mockResolvedValue(undefined),
  }));
  nativeMenu.popup.mockReset().mockResolvedValue(undefined);
  nativeMenu.close.mockReset().mockResolvedValue(undefined);
});

describe("openNativePetModeMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.isTauri = true;
    nativeMenu.create.mockResolvedValue({
      close: nativeMenu.close,
      popup: nativeMenu.popup,
    });
  });

  it("keeps six top-level actions and nests auto-close durations under their current status", async () => {
    const actions = {
      onOpenDashboard: vi.fn(),
      onOpenSettings: vi.fn(),
      onHideForOneHour: vi.fn(),
      onPresenceModeChange: vi.fn(),
      onTurnOffPet: vi.fn(),
    };

    await expect(openNativePetModeMenu(actions, {
      language: "en",
    })).resolves.toBe(true);

    const options = nativeMenu.create.mock.calls[0]?.[0];
    expect(options.items.map((item: { text?: string; item?: string }) => ({
      text: item.text ?? item.item,
    }))).toEqual([
      { text: "Open Drifty" },
      { text: "Pet Settings…" },
      { text: "Separator" },
      { text: "Auto-close · On" },
      { text: "Hide Pet for 1 Hour" },
      { text: "Show Only When Drifting" },
      { text: "Separator" },
      { text: "Turn Off Pet" },
    ]);
    expect(options.items[3].items.map((child: { text: string }) => child.text)).toEqual([
      "Pause for 15 Minutes", "Pause for 1 Hour", "Pause Until Midnight", "Pause Until Resumed",
    ]);
    options.items[1].action();
    expect(actions.onOpenSettings).toHaveBeenCalledOnce();
    options.items[5].action();
    expect(actions.onPresenceModeChange).toHaveBeenCalledWith("drift_only");
  });

  it("retains action resources until native selection and releases them after dismissal", async () => {
    const actions = {
      onOpenDashboard: vi.fn(), onOpenSettings: vi.fn(), onHideForOneHour: vi.fn(),
      onPresenceModeChange: vi.fn(), onTurnOffPet: vi.fn(),
    };
    let dismiss!: () => void;
    nativeMenu.popup.mockImplementationOnce(() => new Promise<void>((resolve) => { dismiss = resolve; }));
    const opened = openNativePetModeMenu(actions);
    await vi.waitFor(() => expect(nativeMenu.popup).toHaveBeenCalledOnce());
    const items = nativeMenu.create.mock.calls[0][0].items;
    const resources = items.filter((item: { rid?: number }) => typeof item.rid === "number");
    expect(resources).toHaveLength(6);
    resources.push(...items[3].items);
    for (const item of resources) expect(item.close).not.toHaveBeenCalled();
    items[3].items[1].action();
    expect(bridge.dispatch).toHaveBeenCalledWith("automaticClosePause60");
    items[1].action();
    expect(actions.onOpenSettings).toHaveBeenCalledOnce();
    dismiss();
    await expect(opened).resolves.toBe(true);
    for (const item of resources) expect(item.close).toHaveBeenCalledOnce();
    expect(nativeMenu.close).toHaveBeenCalledOnce();
  });

  it("releases partial construction and preserves a popup failure despite cleanup failure", async () => {
    const actions = {
      onOpenDashboard: vi.fn(), onOpenSettings: vi.fn(), onHideForOneHour: vi.fn(),
      onPresenceModeChange: vi.fn(), onTurnOffPet: vi.fn(),
    };
    const partial = { rid: 777, close: vi.fn().mockResolvedValue(undefined) };
    nativeItems.create.mockResolvedValueOnce(partial).mockRejectedValueOnce(new Error("item failed"));
    await expect(openNativePetModeMenu(actions)).rejects.toThrow("item failed");
    expect(partial.close).toHaveBeenCalledOnce();
    expect(nativeMenu.create).not.toHaveBeenCalled();

    nativeMenu.popup.mockRejectedValueOnce(new Error("popup failed"));
    nativeMenu.close.mockRejectedValueOnce(new Error("close failed"));
    await expect(openNativePetModeMenu(actions)).rejects.toThrow("popup failed");
    const resources = nativeMenu.create.mock.calls[0][0].items.filter((item: { rid?: number }) => typeof item.rid === "number");
    for (const item of resources) expect(item.close).toHaveBeenCalledOnce();
  });

  it("re-reads a running pause and restores the saved choice when the deadline passes", async () => {
    const actions = {
      onOpenDashboard: vi.fn(), onOpenSettings: vi.fn(), onHideForOneHour: vi.fn(),
      onPresenceModeChange: vi.fn(), onTurnOffPet: vi.fn(),
    };
    const deadline = new Date(2026, 10, 20, 15, 42).getTime();
    const now = vi.spyOn(Date, "now").mockReturnValue(deadline - 500);
    bridge.getState.mockResolvedValue({
      automaticCloseSavedEnabled: true,
      automaticCloseOverride: { enabled: false, kind: "15", endsAtMs: deadline },
    });
    try {
      await openNativePetModeMenu(actions, { language: "ko" });
      let submenu = nativeMenu.create.mock.calls[0][0].items[3];
      expect(submenu.text).toBe("자동 닫기 · 오후 3:42까지 멈춤");
      expect(submenu.items).toHaveLength(1);
      submenu.items[0].action();
      expect(bridge.dispatch).toHaveBeenCalledWith("automaticCloseRestore");
      now.mockReturnValue(deadline);
      await openNativePetModeMenu(actions, { language: "ko" });
      submenu = nativeMenu.create.mock.calls[1][0].items[3];
      expect(submenu.text).toBe("자동 닫기 · 켬");
      expect(submenu.items).toHaveLength(4);
    } finally {
      now.mockRestore();
    }
  });

  it("offers the way back once the pet only appears when drifting", async () => {
    const actions = {
      onOpenDashboard: vi.fn(),
      onOpenSettings: vi.fn(),
      onHideForOneHour: vi.fn(),
      onPresenceModeChange: vi.fn(),
      onTurnOffPet: vi.fn(),
    };

    await openNativePetModeMenu(actions, { language: "ko", presenceMode: "drift_only" });

    const options = nativeMenu.create.mock.calls[0]?.[0];
    expect(options.items[5].text).toBe("항상 함께 있기");
    options.items[5].action();
    expect(actions.onPresenceModeChange).toHaveBeenCalledWith("always");
  });

  it("localizes the native menu in Korean", async () => {
    await openNativePetModeMenu({
      onOpenDashboard: vi.fn(),
      onOpenSettings: vi.fn(),
      onHideForOneHour: vi.fn(),
      onPresenceModeChange: vi.fn(),
      onTurnOffPet: vi.fn(),
    }, { language: "ko" });

    const options = nativeMenu.create.mock.calls[0]?.[0];
    expect(options.items.map((item: { text?: string; item?: string }) => item.text ?? item.item)).toEqual([
      "Drifty 열기",
      "펫 설정…",
      "Separator",
      "자동 닫기 · 켬",
      "펫 1시간 숨기기",
      "딴짓할 때만 나타나기",
      "Separator",
      "펫 끄기",
    ]);
  });

  it("puts the quieter step before a full turn-off in the one-time suggestion", async () => {
    const actions = { onChooseDriftOnly: vi.fn(), onConfirmTurnOff: vi.fn() };

    await expect(openNativePetTurnOffSuggestionMenu(actions, { language: "ko" })).resolves.toBe(true);

    const options = nativeMenu.create.mock.calls[0]?.[0];
    expect(options.items.map((item: { text?: string; enabled?: boolean }) => [item.text, item.enabled ?? true])).toEqual([
      ["펫을 완전히 끌까요?", false],
      ["딴짓할 때만 나타나기", true],
      ["완전히 끄기", true],
    ]);
    options.items[1].action();
    expect(actions.onChooseDriftOnly).toHaveBeenCalledOnce();
    options.items[2].action();
    expect(actions.onConfirmTurnOff).toHaveBeenCalledOnce();
  });
});

describe("openNativeAutomaticCloseMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.isTauri = true;
    nativeMenu.create.mockResolvedValue({
      close: nativeMenu.close,
      popup: nativeMenu.popup,
    });
  });

  it("starts directly with four pause choices when the saved setting is on", async () => {
    const onAction = vi.fn();

    await openNativeAutomaticCloseMenu(onAction, {
      savedEnabled: true,
      override: null,
      language: "ko",
    });

    const options = nativeMenu.create.mock.calls[0]?.[0];
    expect(options.items.map((item: { text?: string; item?: string }) => item.text ?? item.item)).toEqual([
      "15분 멈추기",
      "1시간 멈추기",
      "자정까지 멈추기",
      "다시 켤 때까지 멈추기",
    ]);
    options.items[0].action();
    expect(onAction).toHaveBeenCalledWith("automaticClosePause15");
  });

  it("shows one permanent enable action when the saved setting is off", async () => {
    const onAction = vi.fn();

    await openNativeAutomaticCloseMenu(onAction, {
      savedEnabled: false,
      override: null,
      language: "ko",
    });

    const options = nativeMenu.create.mock.calls[0]?.[0];
    expect(options.items.map((item: { text?: string; item?: string }) => item.text ?? item.item)).toEqual([
      "자동 닫기 켜기",
    ]);
    options.items[0].action();
    expect(onAction).toHaveBeenCalledWith("automaticCloseTurnOn");
  });

  it("reduces a timed pause to one explicit resume action", async () => {
    const onAction = vi.fn();

    await openNativeAutomaticCloseMenu(onAction, {
      savedEnabled: true,
      override: { enabled: false, kind: "15", endsAtMs: Date.now() + 15 * 60_000 },
      language: "en",
    });

    const options = nativeMenu.create.mock.calls[0]?.[0];
    expect(options.items.map((item: { text?: string; item?: string }) => item.text ?? item.item)).toEqual([
      "Turn Back On Now",
    ]);
    options.items[0].action();
    expect(onAction).toHaveBeenCalledWith("automaticCloseRestore");
  });

  it("reduces a forever pause to one explicit restore action", async () => {
    const onAction = vi.fn();

    await openNativeAutomaticCloseMenu(onAction, {
      savedEnabled: true,
      override: { enabled: false, kind: "forever", endsAtMs: null },
      language: "en",
    });

    const options = nativeMenu.create.mock.calls[0]?.[0];
    expect(options.items.map((item: { text?: string; item?: string }) => item.text ?? item.item)).toEqual([
      "Turn Back On Now",
    ]);
    options.items[0].action();
    expect(onAction).toHaveBeenCalledWith("automaticCloseRestore");
  });

  it("reduces a legacy temporary enable to one explicit turn-off action", async () => {
    const onAction = vi.fn();

    await openNativeAutomaticCloseMenu(onAction, {
      savedEnabled: false,
      override: { enabled: true, kind: "15", endsAtMs: Date.now() + 15 * 60_000 },
      language: "en",
    });

    const options = nativeMenu.create.mock.calls[0]?.[0];
    expect(options.items.map((item: { text?: string; item?: string }) => item.text ?? item.item)).toEqual([
      "Turn Back Off Now",
    ]);
    options.items[0].action();
    expect(onAction).toHaveBeenCalledWith("automaticCloseRestore");
  });
});
