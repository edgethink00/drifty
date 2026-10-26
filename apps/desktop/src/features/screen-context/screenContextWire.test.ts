import { describe, expect, it } from "vitest";
import { decodeScreenPage } from "./screenContextWire";

const cursor = {
  instance: "5c1c587e-6327-4da4-8290-663195343c62",
  revision: 3,
  observedAtMs: 1_000,
  id: "cbb9e134-ffbc-4384-b6b9-6b83cafbef14",
};

describe("screen evidence page cursors", () => {
  it("preserves newest-first pagination and accepts legacy chronological cursors", () => {
    const newest = { ...cursor, order: "newest_first" };
    expect(decodeScreenPage({ records: [], nextCursor: newest }).nextCursor).toEqual(newest);
    expect(decodeScreenPage({ records: [], nextCursor: cursor }).nextCursor).toEqual(cursor);
  });

  it("refuses an unknown page direction before another native read", () => {
    expect(() => decodeScreenPage({ records: [], nextCursor: { ...cursor, order: "sideways" } })).toThrow();
  });
});
