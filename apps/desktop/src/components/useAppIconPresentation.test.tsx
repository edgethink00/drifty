// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAppIconPresentation } from "./useAppIconPresentation";
import { calibratedAppIcon } from "./appIconPresentation";
vi.mock("./appIconPresentation", () => ({ calibratedAppIcon: vi.fn() }));

it("does not apply an old icon's async crop after the source changes", async () => {
  let first!: (value: string) => void;
  let second!: (value: string) => void;
  vi.mocked(calibratedAppIcon).mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
  const { result, rerender } = renderHook(({ source }) => useAppIconPresentation(source), { initialProps: { source: "first" } });
  rerender({ source: "second" });
  await act(async () => { first("cropped-first"); });
  expect(result.current).toBe("second");
  await act(async () => { second("cropped-second"); });
  expect(result.current).toBe("cropped-second");
});

describe("missing app icons", () => {
  it("keeps a resolved miss available for the letter fallback", () => {
    const { result } = renderHook(() => useAppIconPresentation(null));
    expect(result.current).toBeNull();
  });
});
