// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PET_NAME_STORAGE_KEY, clipPetName, normalizePetName, petNameAsSubject, readPetName, usePetName, writePetName } from "./petName";

afterEach(() => window.localStorage.clear());

describe("desktop cat name", () => {
  it("adds the Korean subject particle that fits how the name ends", () => {
    expect(petNameAsSubject("콩", "ko")).toBe("콩이");
    expect(petNameAsSubject("보리", "ko")).toBe("보리가");
    expect(petNameAsSubject("Leo", "ko")).toBe("Leo가");
    expect(petNameAsSubject("Bob", "ko")).toBe("Bob이");
    expect(petNameAsSubject("Kong", "ko")).toBe("Kong이");
    expect(petNameAsSubject("나비3", "ko")).toBe("나비3이");
    expect(petNameAsSubject("나비2", "ko")).toBe("나비2가");
    // Other languages put the name in the sentence as it is.
    expect(petNameAsSubject("Bob", "en")).toBe("Bob");
    expect(petNameAsSubject("콩", "ja")).toBe("콩");
  });

  it("keeps at most twelve visible characters and tidies spaces", () => {
    expect(normalizePetName("  모모   보리  ")).toBe("모모 보리");
    expect(clipPetName("나비야나비야나비야나비야나비야")).toBe("나비야나비야나비야나비야");
    // An emoji made of several code points still counts as one character.
    expect(normalizePetName("🐈‍⬛".repeat(13))).toBe("🐈‍⬛".repeat(12));
  });

  it("keeps the name on this computer, removes it when emptied, and updates every reader", () => {
    const { result } = renderHook(() => usePetName());
    expect(result.current[0]).toBe("");
    act(() => writePetName("  Mochi "));
    expect(window.localStorage.getItem(PET_NAME_STORAGE_KEY)).toBe("Mochi");
    expect(result.current[0]).toBe("Mochi");
    act(() => result.current[1](""));
    expect(window.localStorage.getItem(PET_NAME_STORAGE_KEY)).toBeNull();
    expect(readPetName()).toBe("");
    expect(result.current[0]).toBe("");
  });
});
