import type {
  ClassificationRule,
  ClassificationRuleInput,
  Project,
  ProjectAnchor,
  TrackerApi,
} from "@drifty/domain";
import { supabase } from "../../lib/supabase/client";
import { trackerClient } from "../../lib/api/trackerClient";
import { stableJson } from "../settings/categoryDefinitionLedger";
import { mergeDefinitionRecords, type DefinitionRecord } from "../settings/categoryDefinitionsAccountSync";
import { PROJECT_RULE_DEFINITIONS_SYNCED_EVENT, SYNC_DEFINITION_LEDGER_KEY, type ProjectRuleDefinitionsSyncedDetail } from "./projectRuleSyncEvent";

/**
 * Projects and app & site rules across one account's devices (owner decision
 * 2026-10-16, Project and rule sync). Like category definitions, they go to
 * the account only from a device with device sync on.
 *
 * Both live in the tracker, which stamps its own edit times, so the tracker
 * also keeps a ledger of what this device last sent or took for each item: a project or rule
 * whose content no longer matches its ledger entry was changed here, and one
 * that is gone was deleted here. The newer edit of an item wins everywhere; a
 * deleted item travels as a row without a value. A project is keyed by its id;
 * a rule by its unique app or site key (the tracker's syncKey), so two devices
 * that each made a rule for the same site share one row.
 */
export const PROJECT_DEFINITIONS_TABLE = "user_project_definitions";
export const CLASSIFICATION_RULES_TABLE = "user_classification_rules";
// The ledger lives in the tracker's own sync state (SYNC_DEFINITION_LEDGER_KEY),
// beside the projects and rules it describes: a tracker database that starts
// over starts with no ledger, so its empty lists are never read as deletions
// to send, and an account change clears it with the other sync state.

const PROJECT_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const RULE_KEY = /^[0-9a-f]{64}$/;
const PROJECT_VALUE_LIMIT = 16_384;
const RULE_VALUE_LIMIT = 4_096;
const PAGE_SIZE = 1000;
const UPSERT_CHUNK = 500;

type LedgerEntry = { readonly at: string; readonly hash: string | null };
type Ledger = { projects: Record<string, LedgerEntry>; rules: Record<string, LedgerEntry> };

type SyncTracker = Pick<TrackerApi,
  | "getProjects" | "saveProject" | "deleteProject" | "saveProjectAnchors" | "deleteProjectAnchor"
  | "getClassificationRules" | "saveClassificationRule" | "deleteClassificationRule" | "applyClassificationRules"
  | "getSyncState" | "setSyncState">;

type LocalItem = { readonly value: Record<string, unknown>; readonly updatedAt: string | null };

function isoTime(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

/** A short content fingerprint; it only tells whether an item changed since the last pass. */
function contentHash(value: unknown): string {
  const text = stableJson(value);
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return (second >>> 0).toString(16).padStart(8, "0") + (first >>> 0).toString(16).padStart(8, "0");
}

function parseLedger(raw: string | undefined): Ledger {
  const empty: Ledger = { projects: {}, rules: {} };
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
    const section = (value: unknown, pattern: RegExp): Record<string, LedgerEntry> => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const entries: Record<string, LedgerEntry> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        const record = entry as { at?: unknown; hash?: unknown } | null;
        const at = isoTime(record?.at);
        if (!pattern.test(key) || !at) continue;
        entries[key] = { at, hash: typeof record?.hash === "string" ? record.hash : null };
      }
      return entries;
    };
    const stored = parsed as { projects?: unknown; rules?: unknown };
    return { projects: section(stored.projects, PROJECT_KEY), rules: section(stored.rules, RULE_KEY) };
  } catch {
    return empty;
  }
}

function sortedAnchors(anchors: readonly ProjectAnchor[]): ProjectAnchor[] {
  return anchors
    .map(({ kind, value, source }) => ({ kind, value, source }))
    .sort((left, right) => (left.kind + "\u0000" + left.value).localeCompare(right.kind + "\u0000" + right.value));
}

/** What a project carries to the account. */
export function projectSyncValue(project: Project): Record<string, unknown> {
  return {
    name: project.name,
    description: project.description,
    color: project.color,
    status: project.status,
    anchors: sortedAnchors(project.anchors ?? []),
    ...(isoTime(project.createdAt) ? { createdAt: isoTime(project.createdAt) } : {}),
  };
}

/** What a rule carries to the account. */
export function ruleSyncValue(rule: ClassificationRule): Record<string, unknown> {
  return {
    targetKind: rule.targetKind,
    targetValue: rule.targetValue,
    matchScope: rule.matchScope ?? "surface",
    detailKind: rule.detailKind ?? null,
    detailValue: rule.detailValue ?? null,
    category: rule.category,
    productivity: rule.productivity,
    enabled: rule.enabled !== false,
    confidence: typeof rule.confidence === "number" ? rule.confidence : null,
  };
}

function localProjects(projects: readonly Project[]): Map<string, LocalItem> {
  return new Map(projects.filter((project) => PROJECT_KEY.test(project.id)).map((project) => [
    project.id,
    { value: projectSyncValue(project), updatedAt: isoTime(project.updatedAt) },
  ]));
}

function localRules(rules: readonly ClassificationRule[]): Map<string, LocalItem> {
  return new Map(rules.flatMap((rule): [string, LocalItem][] => rule.syncKey && RULE_KEY.test(rule.syncKey)
    ? [[rule.syncKey, { value: ruleSyncValue(rule), updatedAt: isoTime(rule.updatedAt) }]]
    : []));
}

/**
 * This device's items as sync rows. An item unchanged since the last pass
 * keeps the time in the ledger; a new or changed one takes the tracker's edit
 * time (or now, when that is not after the last pass, as for a keyword
 * change); one deleted since the last pass is a row without a value, dated now.
 */
export function localSyncRecords(
  items: ReadonlyMap<string, LocalItem>,
  ledger: Readonly<Record<string, LedgerEntry>>,
  now: string,
): DefinitionRecord[] {
  const records: DefinitionRecord[] = [];
  for (const key of new Set([...items.keys(), ...Object.keys(ledger)])) {
    const item = items.get(key);
    const entry = ledger[key];
    if (item) {
      const unchanged = entry && entry.hash === contentHash(item.value);
      const at = unchanged
        ? entry.at
        : item.updatedAt && (!entry || item.updatedAt > entry.at) ? item.updatedAt : now;
      records.push({ key, value: item.value, updatedAt: at });
    } else if (entry) {
      records.push({ key, value: null, updatedAt: entry.hash === null ? entry.at : now });
    }
  }
  return records;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function readableAnchors(value: unknown): ProjectAnchor[] | null {
  if (!Array.isArray(value)) return null;
  const anchors: ProjectAnchor[] = [];
  for (const anchor of value) {
    const entry = anchor as { kind?: unknown; value?: unknown; source?: unknown } | null;
    if (!entry || !["app", "domain", "keyword"].includes(entry.kind as string) || !isString(entry.value) || !entry.value.trim()) continue;
    anchors.push({ kind: entry.kind as ProjectAnchor["kind"], value: entry.value, source: entry.source === "harvested" ? "harvested" : "manual" });
  }
  return anchors;
}

async function applyProject(tracker: SyncTracker, key: string, value: DefinitionRecord["value"], local: Project | undefined): Promise<boolean> {
  if (!value) {
    if (local) await tracker.deleteProject(key);
    return true;
  }
  const anchors = readableAnchors(value.anchors ?? []);
  if (!isString(value.name) || !value.name.trim() || anchors === null) return false;
  if (value.status !== undefined && value.status !== "active" && value.status !== "archived") return false;
  await tracker.saveProject({
    id: key,
    name: value.name,
    description: isString(value.description) ? value.description : "",
    ...(isString(value.color) ? { color: value.color } : {}),
    status: value.status === "archived" ? "archived" : "active",
    ...(isoTime(value.createdAt) ? { createdAt: isoTime(value.createdAt)! } : {}),
  });
  const wanted = new Map(anchors.map((anchor) => [anchor.kind + "\u0000" + anchor.value, anchor]));
  const current = new Map((local?.anchors ?? []).map((anchor) => [anchor.kind + "\u0000" + anchor.value, anchor]));
  for (const [anchorKey, anchor] of current) {
    if (!wanted.has(anchorKey)) await tracker.deleteProjectAnchor(key, anchor.kind, anchor.value);
  }
  const missing = [...wanted].filter(([anchorKey]) => !current.has(anchorKey)).map(([, anchor]) => anchor);
  if (missing.length > 0) await tracker.saveProjectAnchors(key, missing);
  return true;
}

async function applyRule(tracker: SyncTracker, value: DefinitionRecord["value"], local: ClassificationRule | undefined): Promise<boolean> {
  if (!value) {
    if (local) await tracker.deleteClassificationRule(local.id);
    return true;
  }
  if ((value.targetKind !== "app" && value.targetKind !== "site") || !isString(value.targetValue) || !isString(value.category) || !isString(value.productivity)) {
    return false;
  }
  const input: ClassificationRuleInput = {
    targetKind: value.targetKind,
    targetValue: value.targetValue,
    matchScope: value.matchScope === "detail" ? "detail" : "surface",
    detailKind: isString(value.detailKind) ? value.detailKind as ClassificationRuleInput["detailKind"] : null,
    detailValue: isString(value.detailValue) ? value.detailValue : null,
    category: value.category as ClassificationRuleInput["category"],
    productivity: value.productivity as ClassificationRuleInput["productivity"],
    enabled: value.enabled !== false,
    confidence: typeof value.confidence === "number" ? value.confidence : null,
  };
  await tracker.saveClassificationRule(input);
  return true;
}

function remoteRecord(row: { key?: unknown; value?: unknown; updated_at?: unknown }, pattern: RegExp): DefinitionRecord | null {
  const updatedAt = isoTime(row.updated_at);
  if (!isString(row.key) || !pattern.test(row.key) || !updatedAt) return null;
  const value = row.value && typeof row.value === "object" && !Array.isArray(row.value) ? row.value as Record<string, unknown> : null;
  return { key: row.key, value, updatedAt };
}

function fitsLimit(record: DefinitionRecord, limit: number): boolean {
  return record.value === null || new TextEncoder().encode(JSON.stringify(record.value)).length <= limit;
}

function nextLedgerSection(
  local: readonly DefinitionRecord[],
  applied: ReadonlyMap<string, DefinitionRecord>,
  itemsAfter: ReadonlyMap<string, LocalItem>,
): Record<string, LedgerEntry> {
  const section: Record<string, LedgerEntry> = {};
  for (const record of local) {
    if (!applied.has(record.key)) section[record.key] = { at: record.updatedAt, hash: record.value === null ? null : contentHash(record.value) };
  }
  for (const [key, record] of applied) {
    const item = itemsAfter.get(key);
    if (item) section[key] = { at: record.updatedAt, hash: contentHash(item.value) };
    else if (record.value === null) section[key] = { at: record.updatedAt, hash: null };
    // A taken item the tracker keeps under another key gets no entry, so it
    // is never mistaken for a deletion here.
  }
  return section;
}

type Group = {
  readonly table: string;
  readonly pattern: RegExp;
  readonly limit: number;
};

const PROJECTS: Group = { table: PROJECT_DEFINITIONS_TABLE, pattern: PROJECT_KEY, limit: PROJECT_VALUE_LIMIT };
const RULES: Group = { table: CLASSIFICATION_RULES_TABLE, pattern: RULE_KEY, limit: RULE_VALUE_LIMIT };

/**
 * One pass for an account: read its project and rule rows, merge them with
 * this device's, write the account's newer ones here and send this device's
 * newer ones. Stops if the signed-in account changes on the way.
 */
export async function syncProjectsAndRulesForAccount(
  accountId: string,
  isCurrent: () => boolean = () => true,
  tracker: SyncTracker = trackerClient,
  now: () => Date = () => new Date(),
): Promise<void> {
  if (!supabase) return;
  const client = supabase;
  const assertCurrentAccount = async () => {
    if (!isCurrent()) throw new Error("Device sync account scope changed.");
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session?.user.id !== accountId || !isCurrent()) {
      throw new Error("Device sync account scope changed.");
    }
  };
  const readRemote = async (group: Group): Promise<DefinitionRecord[]> => {
    const records: DefinitionRecord[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      await assertCurrentAccount();
      const { data, error } = await client
        .from(group.table)
        .select("key, value, updated_at")
        .eq("user_id", accountId)
        .order("key", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as { key?: unknown; value?: unknown; updated_at?: unknown }[];
      for (const row of rows) {
        const record = remoteRecord(row, group.pattern);
        if (record) records.push(record);
      }
      if (rows.length < PAGE_SIZE) return records;
    }
  };

  await assertCurrentAccount();
  const remoteProjects = await readRemote(PROJECTS);
  const remoteRules = await readRemote(RULES);
  const at = now().toISOString();
  const ledger = parseLedger((await tracker.getSyncState()).state[SYNC_DEFINITION_LEDGER_KEY]);
  const projectsBefore = await tracker.getProjects();
  const rulesBefore = await tracker.getClassificationRules();
  const localProjectRecords = localSyncRecords(localProjects(projectsBefore), ledger.projects, at);
  const localRuleRecords = localSyncRecords(localRules(rulesBefore), ledger.rules, at);
  const projectMerge = mergeDefinitionRecords(localProjectRecords, remoteProjects);
  const ruleMerge = mergeDefinitionRecords(localRuleRecords, remoteRules);

  await assertCurrentAccount();
  const projectById = new Map(projectsBefore.map((project) => [project.id, project]));
  const ruleByKey = new Map(rulesBefore.flatMap((rule) => rule.syncKey ? [[rule.syncKey, rule] as const] : []));
  const appliedProjects = new Map<string, DefinitionRecord>();
  const appliedRules = new Map<string, DefinitionRecord>();
  for (const record of projectMerge.toLocal) {
    try {
      if (await applyProject(tracker, record.key, record.value, projectById.get(record.key))) appliedProjects.set(record.key, record);
    } catch (error) {
      console.warn("synced project skipped", error);
    }
  }
  for (const record of ruleMerge.toLocal) {
    try {
      if (await applyRule(tracker, record.value, ruleByKey.get(record.key))) appliedRules.set(record.key, record);
    } catch (error) {
      console.warn("synced rule skipped", error);
    }
  }
  if (appliedRules.size > 0) await tracker.applyClassificationRules();

  // The ledger records every item as it now stands here: this device's with
  // the time it was sent at, the account's with the account's time, so neither
  // is sent again until it changes.
  const projectsAfter = appliedProjects.size > 0 ? localProjects(await tracker.getProjects()) : localProjects(projectsBefore);
  const rulesAfter = appliedRules.size > 0 ? localRules(await tracker.getClassificationRules()) : localRules(rulesBefore);
  await tracker.setSyncState({
    [SYNC_DEFINITION_LEDGER_KEY]: JSON.stringify({
      projects: nextLedgerSection(localProjectRecords, appliedProjects, projectsAfter),
      rules: nextLedgerSection(localRuleRecords, appliedRules, rulesAfter),
    }),
  });
  if ((appliedProjects.size > 0 || appliedRules.size > 0) && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ProjectRuleDefinitionsSyncedDetail>(PROJECT_RULE_DEFINITIONS_SYNCED_EVENT, {
      detail: { projects: appliedProjects.size > 0, rules: appliedRules.size > 0 },
    }));
  }

  for (const [group, records] of [[PROJECTS, projectMerge.toRemote], [RULES, ruleMerge.toRemote]] as const) {
    const sendable = records.filter((record) => fitsLimit(record, group.limit));
    for (let start = 0; start < sendable.length; start += UPSERT_CHUNK) {
      await assertCurrentAccount();
      const { error } = await client.from(group.table).upsert(
        sendable.slice(start, start + UPSERT_CHUNK).map((record) => ({ user_id: accountId, key: record.key, value: record.value, updated_at: record.updatedAt })),
        { onConflict: "user_id,key" },
      );
      if (error) throw error;
    }
  }
  await assertCurrentAccount();
}

