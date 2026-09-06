// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PET_OUTING_PREFERENCE_CHANGED_EVENT,
  PET_OUTING_PREFERENCE_STORAGE_KEY,
  persistPetOutingPreference,
  resolveInitialPetOutingPreference,
  usePetOutingPreference,
} from "./petOutingPreference";

describe("pet outing preference", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps the previously shipped outing behavior until a user opts out", () => {
    expect(resolveInitialPetOutingPreference()).toBe(true);
    window.localStorage.setItem(PET_OUTING_PREFERENCE_STORAGE_KEY, "garbage");
    expect(resolveInitialPetOutingPreference()).toBe(true);
    window.localStorage.setItem(PET_OUTING_PREFERENCE_STORAGE_KEY, "0");
    expect(resolveInitialPetOutingPreference()).toBe(false);
  });

  it("persists updates and publishes them to another hook in the same document", () => {
    const first = renderHook(() => usePetOutingPreference());
    const second = renderHook(() => usePetOutingPreference());

    act(() => first.result.current[1](false));

    expect(first.result.current[0]).toBe(false);
    expect(second.result.current[0]).toBe(false);
    expect(window.localStorage.getItem(PET_OUTING_PREFERENCE_STORAGE_KEY)).toBe("0");

    act(() => persistPetOutingPreference(true));
    expect(first.result.current[0]).toBe(true);
    expect(second.result.current[0]).toBe(true);
  });

  it("picks up a change made after render but before subscriptions are installed", () => {
    const { result } = renderHook(() => {
      const preference = usePetOutingPreference();
      useLayoutEffect(() => { persistPetOutingPreference(false); }, []);
      return preference;
    });
    expect(result.current[0]).toBe(false);
  });

  it("accepts ordered cross-webview storage snapshots instead of collapsing to the final disk value", () => {
    const { result } = renderHook(() => usePetOutingPreference());
    window.localStorage.setItem(PET_OUTING_PREFERENCE_STORAGE_KEY, "1");

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_OUTING_PREFERENCE_STORAGE_KEY,
        oldValue: "1",
        newValue: "0",
      }));
    });
    expect(result.current[0]).toBe(false);

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_OUTING_PREFERENCE_STORAGE_KEY,
        oldValue: "0",
        newValue: "1",
      }));
    });
    expect(result.current[0]).toBe(true);
  });

  it("falls back safely when persistence is blocked and removes both listeners", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const remove = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() => usePetOutingPreference());

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    unmount();

    expect(remove).toHaveBeenCalledWith(PET_OUTING_PREFERENCE_CHANGED_EVENT, expect.any(Function));
    expect(remove).toHaveBeenCalledWith("storage", expect.any(Function));
  });
});
