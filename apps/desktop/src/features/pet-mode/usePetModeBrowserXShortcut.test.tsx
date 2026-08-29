// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PET_MODE_BROWSER_X_SHORTCUT,
  PET_MODE_BROWSER_X_SHORTCUT_COOLDOWN_MS,
  canTriggerPetModeBrowserXShortcut,
  usePetModeBrowserXShortcut,
} from "./usePetModeBrowserXShortcut";

const shortcut = vi.hoisted(() => ({
  handler: null as ((event: { state: "Pressed" | "Released" }) => void) | null,
  register: vi.fn(),
  unregister: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: shortcut.register,
  unregister: shortcut.unregister,
}));

vi.mock("../companion/watcherBridge", () => ({
  isTauriRuntime: () => true,
}));

function Harness({ enabled, onTrigger, onError }: {
  readonly enabled: boolean;
  readonly onTrigger: () => void;
  readonly onError: () => void;
}) {
  usePetModeBrowserXShortcut({ enabled, onTrigger, onRegistrationError: onError });
  return null;
}

describe("usePetModeBrowserXShortcut", () => {
  beforeEach(() => {
    shortcut.handler = null;
    shortcut.register.mockReset().mockImplementation(async (_key, handler) => {
      shortcut.handler = handler;
    });
    shortcut.unregister.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it("registers only while armed and triggers only on the pressed edge", async () => {
    const onTrigger = vi.fn();
    const onError = vi.fn();
    const view = render(<Harness enabled={false} onTrigger={onTrigger} onError={onError} />);
    await act(async () => undefined);
    expect(shortcut.register).not.toHaveBeenCalled();

    view.rerender(<Harness enabled onTrigger={onTrigger} onError={onError} />);
    await act(async () => undefined);
    expect(shortcut.unregister).toHaveBeenCalledWith(PET_MODE_BROWSER_X_SHORTCUT);
    expect(shortcut.register).toHaveBeenCalledWith(PET_MODE_BROWSER_X_SHORTCUT, expect.any(Function));

    act(() => shortcut.handler?.({ state: "Released" }));
    expect(onTrigger).not.toHaveBeenCalled();
    act(() => shortcut.handler?.({ state: "Pressed" }));
    expect(onTrigger).toHaveBeenCalledTimes(1);

    view.rerender(<Harness enabled={false} onTrigger={onTrigger} onError={onError} />);
    await act(async () => undefined);
    expect(shortcut.unregister).toHaveBeenLastCalledWith(PET_MODE_BROWSER_X_SHORTCUT);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a registration conflict instead of leaving the shortcut armed", async () => {
    shortcut.register.mockRejectedValueOnce(new Error("shortcut occupied"));
    const onError = vi.fn();
    render(<Harness enabled onTrigger={vi.fn()} onError={onError} />);
    await act(async () => undefined);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("blocks repeats while busy and during the bounded cooldown", () => {
    expect(canTriggerPetModeBrowserXShortcut(false, 0, PET_MODE_BROWSER_X_SHORTCUT_COOLDOWN_MS)).toBe(true);
    expect(canTriggerPetModeBrowserXShortcut(true, 0, PET_MODE_BROWSER_X_SHORTCUT_COOLDOWN_MS * 2)).toBe(false);
    expect(canTriggerPetModeBrowserXShortcut(false, 1_000, 2_999)).toBe(false);
    expect(canTriggerPetModeBrowserXShortcut(false, 1_000, 3_000)).toBe(true);
  });
});
