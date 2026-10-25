// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDayNavigationSnapshot } from "./useDayNavigationSnapshot";

describe("Day presentation during navigation", () => {
  it("holds the committed day through consecutive requests and adopts a genuinely empty answer", () => {
    const ready = { day: "A", records: ["work"] };
    const { result, rerender } = renderHook(({ value, pending, scope }) => useDayNavigationSnapshot(value, pending, scope), {
      initialProps: { value: ready, pending: false, scope: "account:all:240" },
    });
    rerender({ value: { day: "B", records: [] }, pending: true, scope: "account:all:240" });
    expect(result.current).toEqual({ value: ready, holding: true });
    rerender({ value: { day: "C", records: [] }, pending: true, scope: "account:all:240" });
    expect(result.current.value).toBe(ready);
    rerender({ value: { day: "C", records: [] }, pending: false, scope: "account:all:240" });
    expect(result.current).toEqual({ value: { day: "C", records: [] }, holding: false });
  });

  it.each(["other-account:all:240", "account:local:240", "account:all:0"])("drops a held frame when its scope changes to %s", scope => {
    const { result, rerender } = renderHook(({ value, pending, scope }) => useDayNavigationSnapshot(value, pending, scope), {
      initialProps: { value: "old data", pending: false, scope: "account:all:240" },
    });
    rerender({ value: "new scope loading", pending: true, scope });
    expect(result.current).toEqual({ value: "new scope loading", holding: false });
  });
});
