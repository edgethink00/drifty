// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getAppIconVariant, setAppIconVariant } from "../../lib/api/appIconClient";
import { readRevertedLooks, writeRevertedLooks } from "./proLooks";
import { useProLooksController, type ProLooksControllerInput } from "./useProLooksController";

vi.mock("../../lib/api/appIconClient", async (importActual) => ({
  ...(await importActual<typeof import("../../lib/api/appIconClient")>()),
  getAppIconVariant: vi.fn(), setAppIconVariant: vi.fn(), previewAppIcon: vi.fn(async () => undefined),
}));
const getIcon = vi.mocked(getAppIconVariant);
const setIcon = vi.mocked(setAppIconVariant);
function input(overrides: Partial<ProLooksControllerInput> = {}): ProLooksControllerInput {
  return { access: { state: "upgrade" }, appIconsSupported: true, coat: "ivory", setCoat: vi.fn(), flowOpen: false,
    requestSignIn: vi.fn(), startTrial: vi.fn().mockResolvedValue(undefined), openProSheet: vi.fn(), openAccountSettings: vi.fn(), ...overrides };
}
beforeEach(() => { window.localStorage.clear(); getIcon.mockReset(); setIcon.mockReset(); });
afterEach(cleanup);

it("stops a failed automatic fallback and permits a later explicit retry", async () => {
  getIcon.mockResolvedValue("peek");
  setIcon.mockRejectedValue(new Error("write failed"));
  const stable = input();
  const { result, rerender } = renderHook((props) => useProLooksController(props), { initialProps: stable });
  await waitFor(() => expect(result.current.appIconFailure).not.toBeNull());
  rerender({ ...stable });
  await act(async () => {});
  expect(setIcon).toHaveBeenCalledExactlyOnceWith("classic");
  expect(result.current.appIcon).toBe("peek");
  expect(readRevertedLooks()).toEqual({ icon: "peek" });
  setIcon.mockResolvedValue("classic");
  act(() => result.current.pick({ kind: "icon", id: "classic" }));
  await waitFor(() => expect(result.current.appIconFailure).toBeNull());
  expect(setIcon).toHaveBeenCalledTimes(2);
  expect(result.current.appIcon).toBe("classic");
  expect(readRevertedLooks()).toBeNull();
});

it("keeps a failed restoration remembered until a confirmed explicit save", async () => {
  writeRevertedLooks({ icon: "peek", coat: "sage" });
  getIcon.mockResolvedValue("classic");
  setIcon.mockRejectedValue(new Error("write failed"));
  const stable = input({ access: { state: "open", trialEndsAt: null, trialing: false } });
  const { result } = renderHook(() => useProLooksController(stable));
  await waitFor(() => expect(result.current.appIconFailure).not.toBeNull());
  expect(setIcon).toHaveBeenCalledExactlyOnceWith("peek");
  expect(result.current.appIcon).toBe("classic");
  expect(readRevertedLooks()).toEqual({ icon: "peek" });
  expect(stable.setCoat).toHaveBeenCalledWith("sage");
  setIcon.mockResolvedValue("peek");
  act(() => result.current.pick({ kind: "icon", id: "peek" }));
  await waitFor(() => expect(readRevertedLooks()).toBeNull());
  expect(result.current.appIcon).toBe("peek");
});

it("keeps the remembered icon during an in-flight restoration and clears only on success", async () => {
  writeRevertedLooks({ icon: "peek" });
  getIcon.mockResolvedValue("classic");
  let finish: ((icon: "peek") => void) | undefined;
  setIcon.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const stable = input({ access: { state: "open", trialEndsAt: null, trialing: false } });
  const { rerender } = renderHook((props) => useProLooksController(props), { initialProps: stable });
  await waitFor(() => expect(setIcon).toHaveBeenCalledExactlyOnceWith("peek"));
  rerender({ ...stable });
  expect(readRevertedLooks()).toEqual({ icon: "peek" });
  await act(async () => finish?.("peek"));
  expect(readRevertedLooks()).toBeNull();
});

it("ignores an older failure after a newer selection and reads back uncertain saves", async () => {
  getIcon.mockResolvedValue("classic");
  let rejectOld: ((error: Error) => void) | undefined;
  setIcon.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; })).mockResolvedValue("retro");
  const stable = input({ access: { state: "open", trialEndsAt: null, trialing: false } });
  const { result } = renderHook(() => useProLooksController(stable));
  await waitFor(() => expect(result.current.appIcon).toBe("classic"));
  act(() => result.current.pick({ kind: "icon", id: "peek" }));
  act(() => result.current.pick({ kind: "icon", id: "retro" }));
  await waitFor(() => expect(result.current.appIcon).toBe("retro"));
  await act(async () => rejectOld?.(new Error("late reply")));
  expect(result.current.appIconFailure).toBeNull();
  expect(readRevertedLooks()).toBeNull();
  setIcon.mockRejectedValue(new Error("lost acknowledgement"));
  getIcon.mockResolvedValue("peek");
  act(() => result.current.pick({ kind: "icon", id: "peek" }));
  await waitFor(() => expect(result.current.appIconFailure).not.toBeNull());
  expect(result.current.appIcon).toBe("peek");
});
