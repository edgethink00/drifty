import { beforeEach, describe, expect, it, vi } from "vitest";
import { mergeExcludedAppRecords, syncExcludedAppsForAccount, type ExcludedAppSyncRecord } from "./excludedAppsAccountSync";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getExcludedApps: vi.fn(),
  saveExcludedApp: vi.fn(),
  remoteRead: vi.fn(),
  remoteWrite: vi.fn(),
}));

vi.mock("../../lib/api/trackerClient", () => ({ trackerClient: {
  getExcludedApps: mocks.getExcludedApps,
  saveExcludedApp: mocks.saveExcludedApp,
} }));
vi.mock("../../lib/supabase/client", () => ({ supabase: {
  auth: { getSession: mocks.getSession },
  from: () => ({ select: () => ({ eq: mocks.remoteRead }), upsert: mocks.remoteWrite }),
} }));

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

describe("syncExcludedAppsForAccount account boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "account-a" } } }, error: null });
    mocks.getExcludedApps.mockResolvedValue([row({ id: "local-app" })]);
    mocks.remoteRead.mockResolvedValue({ data: [{
      id: "remote-app", name: "Remote app", bundle_id: "remote.app", source: "user",
      tombstone: false, updated_at: "2026-09-12T00:00:00.000Z",
    }], error: null });
    mocks.remoteWrite.mockResolvedValue({ error: null });
  });

  it("discards an old account's exclusion response after the controller scope changes", async () => {
    let current = true;
    mocks.remoteRead.mockImplementationOnce(async () => {
      current = false;
      return { data: [{ id: "old-bank", name: "Old bank", source: "user", updated_at: "2026-09-12T00:00:00Z" }], error: null };
    });
    await expect(syncExcludedAppsForAccount("account-a", () => current)).rejects.toThrow(/account scope changed/i);
    expect(mocks.saveExcludedApp).not.toHaveBeenCalled();
    expect(mocks.remoteWrite).not.toHaveBeenCalled();
  });

  it("checks live authentication even before React observes the changed account", async () => {
    mocks.remoteRead.mockImplementationOnce(async () => {
      mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "account-b" } } }, error: null });
      return { data: [], error: null };
    });
    await expect(syncExcludedAppsForAccount("account-a")).rejects.toThrow(/account scope changed/i);
    expect(mocks.saveExcludedApp).not.toHaveBeenCalled();
    expect(mocks.remoteWrite).not.toHaveBeenCalled();
  });

  it("stops remaining writes when the account changes during a local save", async () => {
    let current = true;
    mocks.saveExcludedApp.mockImplementationOnce(async () => { current = false; });
    await expect(syncExcludedAppsForAccount("account-a", () => current)).rejects.toThrow(/account scope changed/i);
    expect(mocks.saveExcludedApp).toHaveBeenCalledTimes(1);
    expect(mocks.remoteWrite).not.toHaveBeenCalled();
  });

  it("merges both sides while the authenticated scope remains current", async () => {
    await syncExcludedAppsForAccount("account-a", () => true);
    expect(mocks.saveExcludedApp).toHaveBeenCalledWith(expect.objectContaining({ id: "remote-app" }));
    expect(mocks.remoteWrite).toHaveBeenCalledWith(expect.objectContaining({ user_id: "account-a", id: "local-app" }), expect.anything());
  });
});
