// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
import { AvailableUpdateDialog } from "./AvailableUpdateDialog";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
const makeProps = () => ({ updateChannel: "stable" as const, backgroundUpdatesEnabled: true, policy: null, update: { version: "1.10.9" }, updaterChecking: false, updaterError: null, updaterInstalling: false, onBackgroundUpdatesEnabledChange: vi.fn(), onDismiss: vi.fn(), onInstall: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); invokeMock.mockResolvedValue({ confirmed: false, backgroundUpdatesEnabled: true }); });
afterEach(() => cleanup());
describe("native update dialog", () => {
  it.each(["en", "ko"] as const)("passes the app language %s independently of OS defaults", async language => {
    const props = makeProps();
    render(<LocalizationTestProvider language={language}><AvailableUpdateDialog {...props} /></LocalizationTestProvider>);
    await waitFor(() => expect(props.onDismiss).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("update_prompt_show_native", { backgroundUpdatesEnabled: true, language, message: null, version: "1.10.9", urgent: false });
    expect(props.onInstall).not.toHaveBeenCalled();
  });
  it("installs only after native confirmation and preserves the checkbox choice", async () => {
    invokeMock.mockResolvedValue({ confirmed: true, backgroundUpdatesEnabled: false });
    const props = makeProps(); render(<AvailableUpdateDialog {...props} />);
    await waitFor(() => expect(props.onInstall).toHaveBeenCalledTimes(1));
    expect(props.onBackgroundUpdatesEnabledChange).toHaveBeenCalledWith(false);
  });
  it("does not duplicate the native prompt in StrictMode", async () => {
    const props = makeProps(); render(<StrictMode><AvailableUpdateDialog {...props} /></StrictMode>);
    await waitFor(() => expect(props.onDismiss).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
  it.each(["1.10.9", "1.11.0"])("one confirmation belongs to one installer when another channel offers %s", async otherVersion => {
    let confirm!: (result: { confirmed: boolean; backgroundUpdatesEnabled: boolean }) => void;
    invokeMock.mockReturnValueOnce(new Promise(resolve => { confirm = resolve; }));
    const stable = makeProps();
    const developer = { ...makeProps(), updateChannel: "developer" as const, update: { version: otherVersion } };
    render(<StrictMode><AvailableUpdateDialog {...stable} /><AvailableUpdateDialog {...developer} /></StrictMode>);
    await waitFor(() => expect(developer.onDismiss).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await act(async () => confirm({ confirmed: true, backgroundUpdatesEnabled: true }));
    expect(stable.onInstall).toHaveBeenCalledTimes(1);
    expect(developer.onInstall).not.toHaveBeenCalled();
    expect(developer.onBackgroundUpdatesEnabledChange).not.toHaveBeenCalled();
  });
  it("preserves a channel confirmation when an auth gate remounts the dialog", async () => {
    let confirm!: (result: { confirmed: boolean; backgroundUpdatesEnabled: boolean }) => void;
    invokeMock.mockReturnValueOnce(new Promise(resolve => { confirm = resolve; }));
    const beforeAuth = makeProps();
    const view = render(<AvailableUpdateDialog {...beforeAuth} />);
    view.unmount();
    const afterAuth = makeProps();
    render(<StrictMode><AvailableUpdateDialog {...afterAuth} /></StrictMode>);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await act(async () => confirm({ confirmed: true, backgroundUpdatesEnabled: true }));
    expect(beforeAuth.onInstall).not.toHaveBeenCalled();
    expect(afterAuth.onInstall).toHaveBeenCalledTimes(1);
    expect(afterAuth.onDismiss).toHaveBeenCalledTimes(1);
  });
  it("allows another controller to prompt after the owner closes", async () => {
    const first = makeProps();
    const view = render(<AvailableUpdateDialog {...first} />);
    await waitFor(() => expect(first.onDismiss).toHaveBeenCalledTimes(1));
    view.unmount();
    const next = makeProps();
    invokeMock.mockResolvedValueOnce({ confirmed: true, backgroundUpdatesEnabled: true });
    render(<AvailableUpdateDialog {...next} />);
    await waitFor(() => expect(next.onInstall).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
  it("waits until checking and installation are idle", async () => {
    const props = makeProps();
    const { rerender } = render(<AvailableUpdateDialog {...props} updaterChecking />);
    expect(invokeMock).not.toHaveBeenCalled();
    rerender(<AvailableUpdateDialog {...props} updaterInstalling />);
    expect(invokeMock).not.toHaveBeenCalled();
    rerender(<AvailableUpdateDialog {...props} />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
  });
});
