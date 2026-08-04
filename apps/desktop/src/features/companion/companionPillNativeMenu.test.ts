import { beforeEach, describe, expect, it, vi } from "vitest";
import { openNativeCompanionPillMenu } from "./companionPillNativeMenu";

const runtime = vi.hoisted(() => ({ isTauri: true }));
const nativeWindow = vi.hoisted(() => ({ label: "companion-pill" }));
const nativeMenu = vi.hoisted(() => ({
  close: vi.fn().mockResolvedValue(undefined),
  create: vi.fn(),
  popup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./watcherBridge", () => ({
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

describe("openNativeCompanionPillMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.isTauri = true;
    nativeMenu.create.mockResolvedValue({
      close: nativeMenu.close,
      popup: nativeMenu.popup,
    });
  });

  it("uses the macOS menu vocabulary and action hierarchy", async () => {
    const actions = {
      onOpenDashboard: vi.fn(),
      onOpenSettings: vi.fn(),
      onHideForOneHour: vi.fn(),
      onTurnOffCompanion: vi.fn(),
    };

    await expect(openNativeCompanionPillMenu(actions)).resolves.toBe(true);

    const options = nativeMenu.create.mock.calls[0]?.[0];
    expect(options.items.map((item: { text?: string; item?: string }) => item.text ?? item.item)).toEqual([
      "Open Dashboard",
      "Settings…",
      "Separator",
      "Hide for 1 Hour",
      "Turn Off Companion",
    ]);
    options.items[0].action();
    options.items[1].action();
    options.items[3].action();
    options.items[4].action();

    expect(actions.onOpenDashboard).toHaveBeenCalledOnce();
    expect(actions.onOpenSettings).toHaveBeenCalledOnce();
    expect(actions.onHideForOneHour).toHaveBeenCalledOnce();
    expect(actions.onTurnOffCompanion).toHaveBeenCalledOnce();
    expect(nativeMenu.popup).toHaveBeenCalledWith(undefined, nativeWindow);
    expect(nativeMenu.close).toHaveBeenCalledOnce();
  });

  it("does not create an imitation menu in a normal browser", async () => {
    runtime.isTauri = false;

    await expect(openNativeCompanionPillMenu({
      onOpenDashboard: vi.fn(),
      onOpenSettings: vi.fn(),
      onHideForOneHour: vi.fn(),
      onTurnOffCompanion: vi.fn(),
    })).resolves.toBe(false);

    expect(nativeMenu.create).not.toHaveBeenCalled();
  });
});
