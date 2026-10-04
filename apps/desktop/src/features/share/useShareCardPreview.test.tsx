// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useShareCardPreview } from "./useShareCardPreview";

afterEach(() => vi.unstubAllGlobals());
it("keeps the visible image until decoding finishes and ignores an older selection", async () => {
  const requests: Array<{ resolve: () => void; reject: () => void }> = [];
  vi.stubGlobal("Image", class {
    src = "";
    decode = () => new Promise<void>((resolve, reject) => requests.push({ resolve, reject }));
  });
  const { result, rerender } = renderHook(({ src }) => useShareCardPreview(src), { initialProps: { src: "first" } });
  rerender({ src: "second" });
  expect(result.current).toMatchObject({ src: "first", pending: true });
  rerender({ src: "third" });
  await act(async () => requests[1].resolve());
  expect(result.current).toMatchObject({ src: "third", pending: false });
  await act(async () => requests[0].resolve());
  expect(result.current.src).toBe("third");
  rerender({ src: "broken" });
  await act(async () => requests[2].reject());
  expect(result.current).toEqual({ src: "third", pending: true, failed: true });
  rerender({ src: "recovered" });
  await act(async () => requests[3].resolve());
  expect(result.current).toEqual({ src: "recovered", pending: false, failed: false });
});
