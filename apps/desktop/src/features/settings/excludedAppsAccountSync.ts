import { trackerClient } from "../../lib/api/trackerClient";
import { supabase } from "../../lib/supabase/client";

export type ExcludedAppSyncRecord = {
  readonly id: string;
  readonly name: string;
  readonly bundleId?: string | null;
  readonly source: "default" | "user";
  readonly tombstone: boolean;
  readonly updatedAt: string;
};

function newer(left: string, right: string): boolean {
  return left >= right;
}

export function mergeExcludedAppRecords(
  local: readonly ExcludedAppSyncRecord[],
  remote: readonly ExcludedAppSyncRecord[],
): readonly ExcludedAppSyncRecord[] {
  const byId = new Map<string, ExcludedAppSyncRecord>();
  for (const row of local) byId.set(row.id, row);
  for (const row of remote) {
    const current = byId.get(row.id);
    if (!current || newer(row.updatedAt, current.updatedAt)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

function asRecord(row: {
  id: string;
  name: string;
  bundleId?: string | null;
  source: string;
  tombstone?: boolean;
  updatedAt?: string;
  createdAt?: string;
}): ExcludedAppSyncRecord {
  return {
    id: row.id,
    name: row.name,
    bundleId: row.bundleId ?? null,
    source: row.source === "default" ? "default" : "user",
    tombstone: Boolean(row.tombstone),
    updatedAt: row.updatedAt ?? row.createdAt ?? new Date(0).toISOString(),
  };
}

export async function syncExcludedAppsForAccount(accountId: string): Promise<void> {
  if (!supabase) return;
  const localRows = ((await trackerClient.getExcludedApps({ includeTombstones: true })) ?? []).map(asRecord);
  const { data, error } = await supabase
    .from("user_excluded_apps")
    .select("id, name, bundle_id, source, tombstone, updated_at")
    .eq("user_id", accountId);
  if (error) throw error;
  const remoteRows = (data ?? []).map((row) => asRecord({
    id: String(row.id),
    name: String(row.name),
    bundleId: row.bundle_id,
    source: String(row.source),
    tombstone: Boolean(row.tombstone),
    updatedAt: String(row.updated_at),
  }));
  const merged = mergeExcludedAppRecords(localRows, remoteRows);
  const localById = new Map(localRows.map((row) => [row.id, row]));
  const remoteById = new Map(remoteRows.map((row) => [row.id, row]));

  for (const row of merged) {
    const local = localById.get(row.id);
    if (!local || newer(row.updatedAt, local.updatedAt)) {
      await trackerClient.saveExcludedApp({
        id: row.id,
        name: row.name,
        bundleId: row.bundleId,
        source: row.source,
        tombstone: row.tombstone,
        updatedAt: row.updatedAt,
      });
    }
    const remote = remoteById.get(row.id);
    if (!remote || newer(row.updatedAt, remote.updatedAt)) {
      const { error: upsertError } = await supabase.from("user_excluded_apps").upsert({
        user_id: accountId,
        id: row.id,
        name: row.name,
        bundle_id: row.bundleId ?? null,
        source: row.source,
        tombstone: row.tombstone,
        updated_at: row.updatedAt,
      }, { onConflict: "user_id,id" });
      if (upsertError) throw upsertError;
    }
  }
}
