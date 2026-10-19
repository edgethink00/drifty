import type {
  ClassificationRule,
  Project,
  ProjectAnchor,
  TrackerApi,
} from "@drifty/domain";
import { supabase } from "../../lib/supabase/client";
import { trackerClient } from "../../lib/api/trackerClient";
import { stableJson } from "../settings/categoryDefinitionLedger";
import { mergeDefinitionRecords, type DefinitionRecord } from "../settings/categoryDefinitionsAccountSync";
import { PROJECT_RULE_DEFINITIONS_SYNCED_EVENT, SYNC_DEFINITION_LEDGER_KEY, type ProjectRuleDefinitionsSyncedDetail } from "./projectRuleSyncEvent";
import { withDeviceSyncAccountScope } from "./deviceSyncAccountScope";

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

type LedgerEntry = { readonly at: string; readonly hash: string | null; readonly hashVersion?: 2 };
type Ledger = { projects: Record<string, LedgerEntry>; rules: Record<string, LedgerEntry>; rulesNeedApply?: boolean };

type SyncTracker = Pick<TrackerApi,
  | "getProjects" | "getClassificationRules" | "applySyncedDefinition" | "applyClassificationRules"
  | "getSyncState" | "setSyncState">;

type LocalItem = { readonly value: Record<string, unknown>; readonly updatedAt: string | null; readonly legacyHash?: string };
type RunCurrent = <T>(operation: () => Promise<T>) => Promise<T>;
class AccountScopeChangedError extends Error {
  constructor() { super("Device sync account scope changed."); }
}

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
        const record = entry as { at?: unknown; hash?: unknown; value?: unknown; hashVersion?: unknown } | null;
        const at = isoTime(record?.at);
        if (!pattern.test(key) || !at) continue;
        let hash = typeof record?.hash === "string" ? record.hash : null;
        let hashVersion: 2 | undefined = record?.hashVersion === 2 ? 2 : undefined;
        if (record && Object.prototype.hasOwnProperty.call(record, "value")) hashVersion = 2;
        if (record && Object.prototype.hasOwnProperty.call(record, "value") && record.value && typeof record.value === "object" && !Array.isArray(record.value)) {
          const value = { ...record.value } as Record<string, unknown>;
          if (pattern === PROJECT_KEY) {
            const anchors = value.anchors;
            if (!Array.isArray(anchors) || !anchors.every((anchor) => anchor && typeof anchor.kind === "string" && typeof anchor.value === "string")) continue;
            value.anchors = sortedAnchors(anchors);
            if (isoTime(value.createdAt)) value.createdAt = isoTime(value.createdAt);
          }
          hash = contentHash(value);
        }
        entries[key] = { at, hash, ...(hashVersion ? { hashVersion } : {}) };
      }
      return entries;
    };
    const stored = parsed as { projects?: unknown; rules?: unknown; rulesNeedApply?: unknown };
    return { projects: section(stored.projects, PROJECT_KEY), rules: section(stored.rules, RULE_KEY), rulesNeedApply: stored.rulesNeedApply === true };
  } catch {
    return empty;
  }
}

function compareAnchors(left: ProjectAnchor, right: ProjectAnchor): number {
  // Locale collation can tie distinct identities such as é and e + ◌́.
  for (const field of ["kind", "value", "source"] as const) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  return 0;
}

function sortedAnchors(anchors: readonly ProjectAnchor[]): ProjectAnchor[] {
  return anchors.map(({ kind, value, source }) => ({ kind, value, source })).sort(compareAnchors);
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
  return new Map(projects.filter((project) => PROJECT_KEY.test(project.id)).map((project) => {
    const value = projectSyncValue(project);
    // Existing hash-only ACKs used locale ordering. Recognize their unchanged
    // content once without turning a representation change into a new edit.
    const legacyValue = { ...value, anchors: (project.anchors ?? [])
      .map(({ kind, value, source }) => ({ kind, value, source }))
      .sort((left, right) => (left.kind + "\u0000" + left.value).localeCompare(right.kind + "\u0000" + right.value)) };
    return [project.id, { value, updatedAt: isoTime(project.updatedAt), legacyHash: contentHash(legacyValue) }];
  }));
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
      const unchanged = entry && (entry.hash === contentHash(item.value)
        || (entry.hashVersion !== 2 && item.legacyHash !== undefined && entry.hash === item.legacyHash));
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

function remoteRecord(row: { key?: unknown; value?: unknown; updated_at?: unknown }, pattern: RegExp): DefinitionRecord | null {
  const updatedAt = isoTime(row.updated_at);
  if (!isString(row.key) || !pattern.test(row.key) || !updatedAt) return null;
  let value = row.value && typeof row.value === "object" && !Array.isArray(row.value) ? row.value as Record<string, unknown> : null;
  if (pattern === PROJECT_KEY && value) {
    const anchors = value.anchors;
    if (Array.isArray(anchors) && anchors.every((anchor) => anchor && typeof anchor.kind === "string" && typeof anchor.value === "string" && typeof anchor.source === "string")) {
      // Older writers used locale/insertion order. Compare identities in the
      // same total order without dropping unknown fields before validation.
      value = { ...value, anchors: [...anchors].sort(compareAnchors) };
    }
    if (isoTime(value.createdAt)) value = { ...value, createdAt: isoTime(value.createdAt) };
  }
  return { key: row.key, value, updatedAt };
}

function fitsLimit(record: DefinitionRecord, limit: number): boolean {
  return record.value === null || new TextEncoder().encode(JSON.stringify(record.value)).length <= limit;
}

function acknowledgeLocalRecords(
  local: readonly DefinitionRecord[],
  inbound: ReadonlySet<string>,
  existing: Readonly<Record<string, LedgerEntry>>,
): Record<string, LedgerEntry> {
  const section = { ...existing };
  for (const record of local) {
    // Inbound ACKs belong to the native transaction, including a committed
    // command whose response was lost. Never replace them with our old view.
    if (!inbound.has(record.key)) section[record.key] = { at: record.updatedAt, hash: record.value === null ? null : contentHash(record.value), hashVersion: 2 };
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
  const assertCurrentScope = () => {
    if (!isCurrent()) throw new AccountScopeChangedError();
  };
  const assertCurrentAccount = async () => {
    assertCurrentScope();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session?.user.id !== accountId || !isCurrent()) {
      throw new AccountScopeChangedError();
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
  // A post-await guard alone cannot recall a dispatched tracker write. Drain
  // that write before an account reset, and cancel each subsequent command.
  // Remote definition reads and upserts stay outside the queue.
  const { projectMerge, ruleMerge } = await withDeviceSyncAccountScope(async () => {
    const runCurrent: RunCurrent = async (operation) => {
      await assertCurrentAccount();
      // No await between this check and dispatch: OFF/ON and account changes
      // invalidate the controller's captured scope even for the same account.
      assertCurrentScope();
      const result = await operation();
      assertCurrentScope();
      return result;
    };
    const at = now().toISOString();
    let ledger = parseLedger((await runCurrent(() => tracker.getSyncState())).state[SYNC_DEFINITION_LEDGER_KEY]);
    const ledgerAtStart = ledger;
    const projectsBefore = await runCurrent(() => tracker.getProjects());
    const rulesBefore = await runCurrent(() => tracker.getClassificationRules());
    const localProjectRecords = localSyncRecords(localProjects(projectsBefore), ledger.projects, at);
    const localRuleRecords = localSyncRecords(localRules(rulesBefore), ledger.rules, at);
    const projectMerge = mergeDefinitionRecords(localProjectRecords, remoteProjects);
    const ruleMerge = mergeDefinitionRecords(localRuleRecords, remoteRules);

    const projectById = new Map(projectsBefore.map((project) => [project.id, project]));
    const ruleByKey = new Map(rulesBefore.flatMap((rule) => rule.syncKey ? [[rule.syncKey, rule] as const] : []));
    const appliedProjects = new Map<string, DefinitionRecord>();
    const appliedRules = new Map<string, DefinitionRecord>();
    const saveProgress = () => tracker.setSyncState({ [SYNC_DEFINITION_LEDGER_KEY]: JSON.stringify(ledger) });
    for (const [kind, records] of [["project", projectMerge.toLocal], ["rule", ruleMerge.toLocal]] as const) {
      for (const record of records) {
        try {
          await runCurrent(async () => {
            const result = await tracker.applySyncedDefinition({
              accountId, kind, key: record.key, value: record.value, updatedAt: record.updatedAt,
              expected: kind === "project" ? projectById.get(record.key) ?? null : ruleByKey.get(record.key) ?? null,
            });
            if (result.reason === "account_changed") throw new AccountScopeChangedError();
            ledger = parseLedger(result.ledger);
            if (result.applied) {
              (kind === "project" ? appliedProjects : appliedRules).set(record.key, record);
            }
          });
        } catch (error) {
          if (error instanceof AccountScopeChangedError) throw error;
          await assertCurrentAccount();
          console.warn(`synced ${kind} skipped`, error);
        }
      }
    }
    // A native command can commit before its response is lost. Refresh only
    // its durable metadata, never arbitrary project/rule content to ACK it.
    ledger = parseLedger((await runCurrent(() => tracker.getSyncState())).state[SYNC_DEFINITION_LEDGER_KEY]);
    const projectsCommitted = projectMerge.toLocal.some((record) => {
      const entry = ledger.projects[record.key];
      const before = ledgerAtStart.projects[record.key];
      return entry?.at === record.updatedAt && (!before || before.at !== entry.at || before.hash !== entry.hash);
    });
    const rulesApplied = ledger.rulesNeedApply === true;
    if (rulesApplied) {
      await runCurrent(async () => {
        await tracker.applyClassificationRules();
        ledger.rulesNeedApply = false;
        await saveProgress();
      });
    }

    ledger.projects = acknowledgeLocalRecords(localProjectRecords, new Set(projectMerge.toLocal.map((record) => record.key)), ledger.projects);
    ledger.rules = acknowledgeLocalRecords(localRuleRecords, new Set(ruleMerge.toLocal.map((record) => record.key)), ledger.rules);
    await runCurrent(saveProgress);
    await assertCurrentAccount();
    assertCurrentScope();
    if ((appliedProjects.size > 0 || projectsCommitted || appliedRules.size > 0 || rulesApplied) && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<ProjectRuleDefinitionsSyncedDetail>(PROJECT_RULE_DEFINITIONS_SYNCED_EVENT, {
        detail: { projects: appliedProjects.size > 0 || projectsCommitted, rules: appliedRules.size > 0 || rulesApplied },
      }));
    }
    return { projectMerge, ruleMerge };
  });

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

