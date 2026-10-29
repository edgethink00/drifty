import { describe, expect, it } from "vitest";
import { decodeScreenPage, decodeScreenDeletionPreview } from "./screenContextWire";

const cursor = {
  instance: "5c1c587e-6327-4da4-8290-663195343c62",
  revision: 3,
  observedAtMs: 1_000,
  id: "cbb9e134-ffbc-4384-b6b9-6b83cafbef14",
};

it("accepts only safe, nonnegative deletion aggregate counts and sizes", () => {
  expect(decodeScreenDeletionPreview({ recordCount: 2, imageBytes: 100 })).toEqual({ recordCount: 2, imageBytes: 100 });
  for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, "2", null]) {
    expect(() => decodeScreenDeletionPreview({ recordCount: invalid, imageBytes: 100 })).toThrow();
    expect(() => decodeScreenDeletionPreview({ recordCount: 2, imageBytes: invalid })).toThrow();
  }
});

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
