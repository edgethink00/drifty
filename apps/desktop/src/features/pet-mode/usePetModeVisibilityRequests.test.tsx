// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePetModeVisibilityRequests } from "./usePetModeVisibilityRequests";

describe("usePetModeVisibilityRequests", () => {
  it("preserves a force-reveal request when batched off/on requests return to the same preference", () => {
    const setPetModeEnabled = vi.fn();
    const { result } = renderHook(() => usePetModeVisibilityRequests(true, setPetModeEnabled));

    act(() => {
      result.current.togglePetModeEnabled();
      result.current.togglePetModeEnabled();
    });

    expect(setPetModeEnabled.mock.calls).toEqual([[false], [true]]);
    expect(result.current.petModeRevealRevision).toBe(1);
  });

  it("treats every explicit enabled request as show-it-now intent", () => {
    const setPetModeEnabled = vi.fn();
    const { result } = renderHook(() => usePetModeVisibilityRequests(true, setPetModeEnabled));

    act(() => {
      result.current.requestPetModeEnabled(true);
      result.current.requestPetModeEnabled(true);
    });

    expect(setPetModeEnabled.mock.calls).toEqual([[true], [true]]);
    expect(result.current.petModeRevealRevision).toBe(2);
  });

  it("does not create a reveal request when disabling the pet", () => {
    const setPetModeEnabled = vi.fn();
    const { result } = renderHook(() => usePetModeVisibilityRequests(true, setPetModeEnabled));

    act(() => {
      result.current.requestPetModeEnabled(false);
    });

    expect(setPetModeEnabled).toHaveBeenCalledWith(false);
    expect(result.current.petModeRevealRevision).toBe(0);
  });

  it("clears a temporary visibility suppression on every explicit reveal", () => {
    const setPetModeEnabled = vi.fn();
    const onReveal = vi.fn();
    const { result } = renderHook(() => (
      usePetModeVisibilityRequests(true, setPetModeEnabled, onReveal)
    ));

    act(() => {
      result.current.requestPetModeEnabled(true);
      result.current.requestPetModeEnabled(false);
      result.current.togglePetModeEnabled();
    });

    expect(onReveal).toHaveBeenCalledTimes(2);
  });
});
