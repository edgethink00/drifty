import { beforeEach, describe, expect, it, vi } from "vitest";
import { openNativeAutomaticCloseMenu, openNativePetModeMenu } from "./petModeNativeMenu";

const runtime = vi.hoisted(() => ({ isTauri: true }));
const nativeWindow = vi.hoisted(() => ({ label: "pet-mode" }));
const nativeMenu = vi.hoisted(() => ({
  close: vi.fn().mockResolvedValue(undefined),
  create: vi.fn(),
  popup: vi.fn().mockResolvedValue(undefined),
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
}));

describe("openNativePetModeMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.isTauri = true;
    nativeMenu.create.mockResolvedValue({
      close: nativeMenu.close,
      popup: nativeMenu.popup,
    });
  });

  it("keeps visibility actions and links to automatic-close settings", async () => {
    const actions = {
      onOpenDashboard: vi.fn(),
      onOpenSettings: vi.fn(),
      onHideForOneHour: vi.fn(),
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
      { text: "Auto-close Settings…" },
      { text: "Hide Pet for 1 Hour" },
      { text: "Separator" },
      { text: "Turn Off Pet" },
    ]);
    options.items[3].action();
    expect(actions.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("localizes the native menu in Korean", async () => {
    await openNativePetModeMenu({
      onOpenDashboard: vi.fn(),
      onOpenSettings: vi.fn(),
      onHideForOneHour: vi.fn(),
      onTurnOffPet: vi.fn(),
    }, { language: "ko" });

    const options = nativeMenu.create.mock.calls[0]?.[0];
    expect(options.items.map((item: { text?: string; item?: string }) => item.text ?? item.item)).toEqual([
      "Drifty 열기",
      "펫 설정…",
      "Separator",
      "자동 닫기 설정…",
      "펫 1시간 숨기기",
      "Separator",
      "펫 끄기",
    ]);
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
      "자동 닫기 멈추기",
      "15분 멈추기",
      "1시간 멈추기",
      "자정까지 멈추기",
      "계속 멈추기",
      "Separator",
      "시간이 끝나면 자동으로 다시 켜집니다.",
    ]);
    options.items[1].action();
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
    expect(onAction).toHaveBeenCalledWith("toggleAutomaticClose");
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
