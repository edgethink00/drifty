// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { WindowsBlurSettingsRow } from "./WindowsBlurSettingsRow";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.windowMaterial;
  delete document.documentElement.dataset.windowsNativeBlur;
  delete document.documentElement.dataset.windowsBlurSystemBlocked;
});

async function nativeMaterial(material: string, active: boolean) {
  await act(async () => {
    document.documentElement.dataset.windowMaterial = material;
    if (active) document.documentElement.dataset.windowsNativeBlur = "active";
    else delete document.documentElement.dataset.windowsNativeBlur;
  });
}

describe("Windows blur status", () => {
  it("reports runtime source loss while keeping the user's opt-in and explaining recovery", async () => {
    await nativeMaterial("translucent", true);
    const onEnabledChange = vi.fn();
    render(<WindowsBlurSettingsRow enabled onEnabledChange={onEnabledChange} />);
    expect(screen.getByRole("status").textContent).toBe("Blur active");

    // Match the native health monitor's direct DOM update, without rerendering
    // React or changing the persisted opt-in preference.
    await nativeMaterial("solid", false);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("blur is not active");
    expect(status.textContent).toContain("quit and reopen Drifty");
    const toggle = screen.getByRole("switch", { name: "Toggle Window blur" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.getAttribute("aria-describedby")?.split(" ")).toContain(status.id);
    expect(onEnabledChange).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });

  it("requires both a translucent window and healthy native blur before claiming active", async () => {
    await nativeMaterial("translucent", false);
    render(<WindowsBlurSettingsRow enabled onEnabledChange={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toBe("Checking blur availability…");
    await nativeMaterial("solid", true);
    expect(screen.getByRole("status").textContent).toContain("blur is not active");
    await nativeMaterial("translucent", true);
    expect(screen.getByRole("status").textContent).toBe("Blur active");
  });

  it("uses the current material on mount and makes off override a previous active marker", async () => {
    await nativeMaterial("solid", false);
    const change = vi.fn();
    const { rerender } = render(<WindowsBlurSettingsRow enabled onEnabledChange={change} />);
    expect(screen.getByRole("status").textContent).toContain("blur is not active");
    await nativeMaterial("translucent", true);
    rerender(<WindowsBlurSettingsRow enabled={false} onEnabledChange={change} />);
    expect(screen.getByRole("status").textContent).toBe("Off · opaque window");
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("reports system settings separately and resumes active status when they allow it", async () => {
    await nativeMaterial("translucent", true);
    render(<WindowsBlurSettingsRow enabled onEnabledChange={vi.fn()} />);
    await act(async () => { document.documentElement.dataset.windowsBlurSystemBlocked = "true"; });
    expect(screen.getByRole("status").textContent).toContain("Windows transparency or contrast settings");
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    await act(async () => { document.documentElement.dataset.windowsBlurSystemBlocked = "false"; });
    expect(screen.getByRole("status").textContent).toBe("Blur active");
  });

  it("localizes fallback and recovery in Korean", async () => {
    await nativeMaterial("solid", false);
    render(<LocalizationTestProvider language="ko"><WindowsBlurSettingsRow enabled onEnabledChange={vi.fn()} /></LocalizationTestProvider>);
    expect(screen.getByText("윈도우 배경 블러")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Drifty를 완전히 종료한 뒤 다시 열어");
    expect(screen.getByRole("switch", { name: "윈도우 배경 블러 켜기/끄기" }).getAttribute("aria-checked")).toBe("true");
  });

  it("disconnects its native material observer when leaving Appearance", () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const { unmount } = render(<WindowsBlurSettingsRow enabled onEnabledChange={vi.fn()} />);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    disconnect.mockRestore();
  });
});
