import { describe, expect, it } from "vitest";
import { mergeExcludedAppRecords, type ExcludedAppSyncRecord } from "./excludedAppsAccountSync";

function row(partial: Partial<ExcludedAppSyncRecord> & Pick<ExcludedAppSyncRecord, "id">): ExcludedAppSyncRecord {
  return {
    name: partial.name ?? partial.id,
    bundleId: partial.bundleId ?? partial.id,
    source: partial.source ?? "user",
    tombstone: partial.tombstone ?? false,
    updatedAt: partial.updatedAt ?? "2026-09-11T00:00:00.000Z",
    ...partial,
  };
}

describe("mergeExcludedAppRecords", () => {
  it("keeps the newer row per id and unions both sides", () => {
    const merged = mergeExcludedAppRecords(
      [
        row({ id: "com.1password.1password", source: "default", updatedAt: "2026-09-11T01:00:00.000Z" }),
        row({ id: "com.bank.app", name: "Bank", updatedAt: "2026-09-11T02:00:00.000Z" }),
      ],
      [
        row({ id: "com.1password.1password", source: "default", tombstone: true, updatedAt: "2026-09-11T03:00:00.000Z" }),
        row({ id: "com.wallet.app", name: "Wallet", updatedAt: "2026-09-11T02:30:00.000Z" }),
      ],
    );
    const byId = Object.fromEntries(merged.map((item) => [item.id, item]));
    expect(byId["com.1password.1password"]?.tombstone).toBe(true);
    expect(byId["com.bank.app"]?.name).toBe("Bank");
    expect(byId["com.wallet.app"]?.name).toBe("Wallet");
  });
});

