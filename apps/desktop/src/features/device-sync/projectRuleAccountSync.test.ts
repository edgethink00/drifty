// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassificationRule, ClassificationRuleInput, Project, ProjectAnchor, ProjectInput, SyncedDefinitionInput, SyncedDefinitionResult } from "@drifty/domain";

// One account's rows per table, kept as the server does: an older edit never overwrites a newer one.
const server = vi.hoisted(() => {
  type Row = { user_id: string; key: string; value: unknown; updated_at: string };
  const tables = new Map<string, Map<string, Row>>();
  const state = { userId: "user-1", upserts: 0, onUpsert: null as null | (() => void) };
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: state.userId } } }, error: null }) },
    from: (name: string) => ({
      select: () => ({
        eq: (_column: string, userId: string) => ({
          order: () => ({
            range: async (from: number, to: number) => ({
              data: [...table(name).values()].filter((row) => row.user_id === userId)
                .sort((left, right) => left.key.localeCompare(right.key)).slice(from, to + 1)
                .map(({ key, value, updated_at }) => ({ key, value, updated_at })),
              error: null,
            }),
          }),
        }),
      }),
      upsert: async (input: Row[]) => {
        state.upserts += 1;
        state.onUpsert?.();
        for (const row of input) {
          const current = table(name).get(row.user_id + "/" + row.key);
          if (!current || row.updated_at >= current.updated_at) table(name).set(row.user_id + "/" + row.key, { ...row });
        }
        return { error: null };
      },
    }),
  };
  return { tables, table, state, client };
});
vi.mock("../../lib/supabase/client", () => ({ supabase: server.client }));

import { projectSyncValue, ruleSyncValue, syncProjectsAndRulesForAccount } from "./projectRuleAccountSync";
import { prepareDeviceSyncAccountScope } from "./deviceSyncAccountScope";
import { PROJECT_RULE_DEFINITIONS_SYNCED_EVENT, SYNC_DEFINITION_LEDGER_KEY } from "./projectRuleSyncEvent";

type SyncTracker = NonNullable<Parameters<typeof syncProjectsAndRulesForAccount>[2]>;

/** A tracker that keeps projects and rules the way the Python tracker does. */
function device() {
  const projects = new Map<string, Project>();
  const rules = new Map<string, ClassificationRule>();
  const state: Record<string, string> = { sync_account_id: "user-1" };
  let nextId = 0;
  const now = () => new Date().toISOString();
  const ruleKey = (rule: ClassificationRuleInput) => createHash("sha256").update([
    rule.targetKind, rule.targetValue.trim().toLowerCase().replace(/^www\./, ""), rule.matchScope ?? "surface",
    rule.detailKind ?? "", (rule.detailValue ?? "").trim().toLowerCase(),
  ].join("\u001f")).digest("hex");
  const tracker = {
    getProjects: async () => [...projects.values()].map((project) => ({ ...project, anchors: [...project.anchors] })),
    saveProject: async (input: ProjectInput) => {
      const id = input.id ?? "p-" + (nextId += 1);
      const existing = projects.get(id);
      const project: Project = {
        id,
        name: input.name,
        description: input.description,
        color: input.color ?? "#6366f1",
        status: input.status ?? "active",
        anchors: existing?.anchors ?? [],
        createdAt: existing?.createdAt ?? input.createdAt ?? now(),
        updatedAt: now(),
      };
      projects.set(id, project);
      return { ...project, anchors: [...project.anchors] };
    },
    deleteProject: async (id: string) => ({ deleted: projects.delete(id) ? 1 : 0 }),
    saveProjectAnchors: async (id: string, anchors: ProjectAnchor[]) => {
      const project = projects.get(id)!;
      for (const anchor of anchors) {
        if (!project.anchors.some((existing) => existing.kind === anchor.kind && existing.value === anchor.value)) project.anchors.push(anchor);
      }
      return project.anchors;
    },
    deleteProjectAnchor: async (id: string, kind: string, value: string) => {
      const project = projects.get(id)!;
      project.anchors = project.anchors.filter((anchor) => anchor.kind !== kind || anchor.value !== value);
      return { deleted: 1 };
    },
    getClassificationRules: async () => [...rules.values()].map((rule) => ({ ...rule })),
    saveClassificationRule: async (input: ClassificationRuleInput) => {
      const key = ruleKey(input);
      const existing = [...rules.values()].find((rule) => rule.syncKey === key);
      const id = existing?.id ?? input.id ?? "r-" + (nextId += 1);
      const rule: ClassificationRule = {
        id,
        targetKind: input.targetKind,
        targetValue: input.targetValue,
        matchScope: input.matchScope ?? "surface",
        detailKind: input.detailKind ?? null,
        detailValue: input.detailValue ?? null,
        category: input.category,
        productivity: input.productivity,
        enabled: input.enabled ?? true,
        confidence: input.confidence ?? null,
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now(),
        syncKey: key,
      };
      rules.set(id, rule);
      return rule;
    },
    deleteClassificationRule: async (id: string) => ({ deleted: rules.delete(id) ? 1 : 0 }),
    applyClassificationRules: vi.fn(async () => ({ matchedCount: 0, appliedCount: 0, skippedCount: 0 })),
    purgeRemoteSegments: vi.fn(async () => ({ purged: 0 })),
    getSyncState: async () => ({ state: { ...state }, counterSeq: 0, pendingDeletions: 0 }),
    setSyncState: async (entries: Record<string, string | null>) => {
      for (const [key, value] of Object.entries(entries)) {
        if (value === null) delete state[key];
        else state[key] = value;
      }
      return { written: Object.keys(entries).length };
    },
    // Contract fixture only. Actual transaction atomicity/CAS/rollback is
    // exercised against SQLite in test_synced_definition_import.py.
    async applySyncedDefinition(input: SyncedDefinitionInput): Promise<SyncedDefinitionResult> {
      const ledgerRaw = state[SYNC_DEFINITION_LEDGER_KEY] ?? "{}";
      const current = input.kind === "project" ? projects.get(input.key) ?? null : [...rules.values()].find((rule) => rule.syncKey === input.key) ?? null;
      if (state.sync_account_id !== input.accountId) return { applied: false, value: current, ledger: ledgerRaw, reason: "account_changed" };
      if (JSON.stringify(current) !== JSON.stringify(input.expected)) return { applied: false, value: current, ledger: ledgerRaw, reason: "local_changed" };
      if (input.kind === "project") {
        if (input.value) {
          if (typeof input.value.name !== "string" || !input.value.name.trim() || (input.value.status !== undefined && !["active", "archived"].includes(input.value.status as string))) throw new Error("invalid project");
          await tracker.saveProject({ id: input.key, name: input.value.name, description: input.value.description as string ?? "", color: input.value.color as string, status: input.value.status as ProjectInput["status"], createdAt: input.value.createdAt as string });
          projects.get(input.key)!.anchors = structuredClone(input.value.anchors as ProjectAnchor[] ?? []);
        } else await tracker.deleteProject(input.key);
      } else {
        if (input.value) await tracker.saveClassificationRule(input.value as unknown as ClassificationRuleInput);
        else if (current) await tracker.deleteClassificationRule(current.id);
      }
      const value = input.kind === "project" ? projects.get(input.key) ?? null : [...rules.values()].find((rule) => rule.syncKey === input.key) ?? null;
      const ledger = JSON.parse(ledgerRaw);
      ledger.projects ??= {};
      ledger.rules ??= {};
      ledger[input.kind === "project" ? "projects" : "rules"][input.key] = {
        at: input.updatedAt, value: value === null ? null : input.kind === "project" ? projectSyncValue(value as Project) : ruleSyncValue(value as ClassificationRule),
      };
      if (input.kind === "rule") ledger.rulesNeedApply = true;
      state[SYNC_DEFINITION_LEDGER_KEY] = JSON.stringify(ledger);
      return { applied: true, value: structuredClone(value), ledger: state[SYNC_DEFINITION_LEDGER_KEY] };
    },
  };
  return { tracker, projects, rules, state, sync: () => syncProjectsAndRulesForAccount("user-1", () => true, tracker as unknown as SyncTracker) };
}

const at = (time: string) => vi.setSystemTime(new Date("2026-10-16T" + time + ":00Z"));
const projectNames = (projects: Map<string, Project>) => [...projects.values()].map((project) => project.name).sort();
const site = (targetValue: string, productivity: ClassificationRuleInput["productivity"] = "focus"): ClassificationRuleInput =>
  ({ targetKind: "site", targetValue, category: "learning", productivity });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Pause before the write takes effect, rather than only delaying its response. */
function pauseWrite<Args extends unknown[], Result>(write: (...args: Args) => Promise<Result>) {
  const entered = deferred();
  const release = deferred();
  return {
    entered: entered.promise,
    release: release.resolve,
    write: async (...args: Args) => {
      entered.resolve();
      await release.promise;
      return write(...args);
    },
  };
}

async function definitionScopeFixture() {
  const source = device();
  const target = device();
  await target.tracker.saveProject({ id: "p-local", name: "Keep local", description: "" });
  await target.tracker.saveProject({ id: "p-first", name: "Before sync", description: "" });
  await target.tracker.saveProjectAnchors("p-first", [
    { kind: "keyword", value: "old-one", source: "manual" },
    { kind: "keyword", value: "old-two", source: "manual" },
  ]);
  at("09:05");
  await source.tracker.saveProject({ id: "p-first", name: "Remote first", description: "" });
  await source.tracker.saveProjectAnchors("p-first", [{ kind: "domain", value: "remote.example.com", source: "manual" }]);
  await source.tracker.saveProject({ id: "p-next", name: "Remote next", description: "" });
  await source.tracker.saveClassificationRule(site("first.example.com"));
  await source.tracker.saveClassificationRule(site("next.example.com"));
  await source.sync();
  server.state.upserts = 0;
  target.state.sync_account_id = "user-1";
  target.state[SYNC_DEFINITION_LEDGER_KEY] = JSON.stringify({ projects: {}, rules: {} });
  at("09:10");
  return { ...target, source };
}

describe("projects and rules across devices", () => {
  beforeEach(() => {
    server.tables.clear();
    server.state.userId = "user-1";
    server.state.upserts = 0;
    server.state.onUpsert = null;
    vi.useFakeTimers({ toFake: ["Date"] });
    at("09:00");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("brings a project and a rule to the other device, applies the rule there, and then sends nothing", async () => {
    const mac = device();
    const windows = device();
    const project = await mac.tracker.saveProject({ name: "Drifty", description: "The tracker app", color: "#3f7cac" });
    await mac.tracker.saveProjectAnchors(project.id, [{ kind: "keyword", value: "drifty", source: "manual" }]);
    await mac.tracker.saveClassificationRule(site("docs.example.com"));
    at("09:05");
    await mac.sync();
    const synced = vi.fn();
    window.addEventListener(PROJECT_RULE_DEFINITIONS_SYNCED_EVENT, synced);
    at("09:10");
    await windows.sync();
    window.removeEventListener(PROJECT_RULE_DEFINITIONS_SYNCED_EVENT, synced);

    expect(windows.projects.get(project.id)).toMatchObject({
      name: "Drifty", description: "The tracker app", color: "#3f7cac", createdAt: project.createdAt,
      anchors: [{ kind: "keyword", value: "drifty", source: "manual" }],
    });
    expect([...windows.rules.values()]).toEqual([expect.objectContaining({ targetValue: "docs.example.com", category: "learning", productivity: "focus" })]);
    expect(windows.tracker.applyClassificationRules).toHaveBeenCalledTimes(1);
    expect(synced.mock.calls[0][0].detail).toEqual({ projects: true, rules: true });

    server.state.upserts = 0;
    at("09:20");
    await windows.sync();
    await mac.sync();
    await windows.sync();
    expect(server.state.upserts).toBe(0);
    expect(windows.tracker.applyClassificationRules).toHaveBeenCalledTimes(1);
  });

  it("takes the newer edit both ways, keywords and a rule's productivity included", async () => {
    const mac = device();
    const windows = device();
    const project = await mac.tracker.saveProject({ name: "Drifty", description: "" });
    await mac.tracker.saveClassificationRule(site("example.com"));
    at("09:05");
    await mac.sync();
    await windows.sync();

    at("09:30");
    await windows.tracker.saveProject({ id: project.id, name: "Drifty app", description: "" });
    await windows.tracker.saveClassificationRule(site("example.com", "neutral"));
    at("09:31");
    await windows.sync();
    at("09:32");
    await mac.sync();
    expect(mac.projects.get(project.id)?.name).toBe("Drifty app");
    expect([...mac.rules.values()][0].productivity).toBe("neutral");

    at("09:33");
    await mac.tracker.saveProjectAnchors(project.id, [{ kind: "domain", value: "drifty.so", source: "manual" }]);
    await mac.sync();
    at("09:40");
    await windows.sync();
    expect(windows.projects.get(project.id)?.anchors).toEqual([{ kind: "domain", value: "drifty.so", source: "manual" }]);
    expect(windows.projects.get(project.id)?.name).toBe("Drifty app");
  });

  it("deletes a project and a rule on the other device and never brings them back", async () => {
    const mac = device();
    const windows = device();
    const project = await mac.tracker.saveProject({ name: "Old client", description: "" });
    const rule = await mac.tracker.saveClassificationRule(site("old.example.com"));
    at("09:05");
    await mac.sync();
    await windows.sync();
    expect(projectNames(windows.projects)).toEqual(["Old client"]);

    at("10:00");
    await mac.tracker.deleteProject(project.id);
    await mac.tracker.deleteClassificationRule(rule.id);
    await mac.sync();
    at("10:05");
    await windows.sync();
    await mac.sync();
    await windows.sync();

    expect(windows.projects.size).toBe(0);
    expect(windows.rules.size).toBe(0);
    expect(mac.projects.size).toBe(0);
    expect([...server.table("user_project_definitions").values()].map((row) => row.value)).toEqual([null]);
  });

  it("keeps each device's own new items and shares one row for a rule both made", async () => {
    const mac = device();
    const windows = device();
    await mac.tracker.saveProject({ id: "p-mac", name: "Thesis", description: "" });
    await windows.tracker.saveProject({ id: "p-win", name: "Side app", description: "" });
    await mac.tracker.saveClassificationRule(site("www.example.com"));
    at("09:10");
    await windows.tracker.saveClassificationRule(site("example.com", "neutral"));
    at("09:20");
    await mac.sync();
    await windows.sync();
    await mac.sync();

    expect(projectNames(mac.projects)).toEqual(["Side app", "Thesis"]);
    expect(projectNames(windows.projects)).toEqual(["Side app", "Thesis"]);
    expect(server.table("user_classification_rules").size).toBe(1);
    expect([...mac.rules.values()].map((rule) => rule.productivity)).toEqual(["neutral"]);
  });

  it("never reads a tracker that starts over as having deleted everything", async () => {
    const mac = device();
    await mac.tracker.saveProject({ id: "p-1", name: "Drifty", description: "" });
    at("09:05");
    await mac.sync();

    const reset = device();
    at("09:10");
    await reset.sync();

    expect(projectNames(reset.projects)).toEqual(["Drifty"]);
    expect([...server.table("user_project_definitions").values()][0].value).toMatchObject({ name: "Drifty" });
  });

  it("skips a row this version cannot read and sends nothing back for it", async () => {
    server.table("user_project_definitions").set("user-1/p-bad", { user_id: "user-1", key: "p-bad", value: { name: "" }, updated_at: "2026-10-16T08:00:00.000Z" });
    const windows = device();
    await windows.sync();
    await windows.sync();

    expect(windows.projects.size).toBe(0);
    expect(server.state.upserts).toBe(0);
  });

  it("stops before sending when the account changes on the way", async () => {
    const mac = device();
    await mac.tracker.saveProject({ id: "p-1", name: "Drifty", description: "" });
    const getProjects = mac.tracker.getProjects;
    mac.tracker.getProjects = async () => {
      server.state.userId = "user-2";
      return getProjects();
    };

    await expect(mac.sync()).rejects.toThrow("account scope changed");
    expect(server.state.upserts).toBe(0);
  });


  it("drains one atomic import before account reset and cancels subsequent items", async () => {
    const target = await definitionScopeFixture();
    const paused = pauseWrite(target.tracker.applySyncedDefinition);
    const apply = vi.spyOn(target.tracker, "applySyncedDefinition").mockImplementationOnce(paused.write);
    const synced = vi.fn();
    window.addEventListener(PROJECT_RULE_DEFINITIONS_SYNCED_EVENT, synced);
    let current = true;
    const outcome = syncProjectsAndRulesForAccount("user-1", () => current, target.tracker).catch((error: unknown) => error);
    await paused.entered;
    current = false;
    server.state.userId = "user-2";
    const reset = prepareDeviceSyncAccountScope(target.tracker, "user-2");
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(target.state.sync_account_id).toBe("user-1");
    } finally {
      paused.release();
      await Promise.all([outcome, reset]);
      window.removeEventListener(PROJECT_RULE_DEFINITIONS_SYNCED_EVENT, synced);
    }
    expect(await outcome).toEqual(expect.objectContaining({ message: "Device sync account scope changed." }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(target.state.sync_account_id).toBe("user-2");
    expect(target.state[SYNC_DEFINITION_LEDGER_KEY]).toBeUndefined();
    expect(target.projects.get("p-first")?.anchors).toEqual([{ kind: "domain", value: "remote.example.com", source: "manual" }]);
    expect(target.projects.has("p-local")).toBe(true);
    expect(target.projects.has("p-next")).toBe(false);
    expect(synced).not.toHaveBeenCalled();
    expect(server.state.upserts).toBe(0);
    await syncProjectsAndRulesForAccount("user-2", () => true, target.tracker);
    expect([...server.table("user_project_definitions").values()].filter((row) => row.user_id === "user-2").map((row) => row.key).sort()).toEqual(["p-first", "p-local"]);
  });

  it("re-enables an interrupted atomic project import without echoing partial anchors", async () => {
    const target = await definitionScopeFixture();
    const expected = structuredClone(server.table("user_project_definitions").get("user-1/p-first"));
    const paused = pauseWrite(target.tracker.applySyncedDefinition);
    vi.spyOn(target.tracker, "applySyncedDefinition").mockImplementationOnce(paused.write);
    let current = true;
    const outcome = syncProjectsAndRulesForAccount("user-1", () => current, target.tracker).catch((error: unknown) => error);
    await paused.entered;
    current = false;
    paused.release();
    await outcome;
    expect(target.projects.get("p-first")?.anchors).toEqual([{ kind: "domain", value: "remote.example.com", source: "manual" }]);
    await target.sync();
    await target.source.sync();
    expect(server.table("user_project_definitions").get("user-1/p-first")).toEqual(expected);
    expect(target.source.projects.get("p-first")?.anchors).toEqual([{ kind: "domain", value: "remote.example.com", source: "manual" }]);
  });

  it.each(["edit", "delete"] as const)("preserves a user %s after atomic commit but before its response", async (action) => {
    const target = await definitionScopeFixture();
    const committed = deferred();
    const release = deferred();
    const apply = target.tracker.applySyncedDefinition;
    vi.spyOn(target.tracker, "applySyncedDefinition").mockImplementationOnce(async (input) => {
      const result = await apply(input);
      committed.resolve();
      await release.promise;
      return result;
    });
    let current = true;
    const outcome = syncProjectsAndRulesForAccount("user-1", () => current, target.tracker).catch((error: unknown) => error);
    await committed.promise;
    current = false;
    at("09:15");
    if (action === "edit") {
      await target.tracker.saveProject({ id: "p-first", name: "My concurrent edit", description: "Keep this exact text" });
      await target.tracker.saveProjectAnchors("p-first", [{ kind: "keyword", value: "my-new-anchor", source: "manual" }]);
    } else await target.tracker.deleteProject("p-first");
    release.resolve();
    await outcome;
    await target.sync();
    await target.source.sync();
    if (action === "edit") {
      expect(target.projects.get("p-first")?.name).toBe("My concurrent edit");
      expect(target.source.projects.get("p-first")?.name).toBe("My concurrent edit");
      expect(target.source.projects.get("p-first")?.anchors.some((anchor) => anchor.value === "my-new-anchor")).toBe(true);
    } else {
      expect(target.projects.has("p-first")).toBe(false);
      expect(target.source.projects.has("p-first")).toBe(false);
      expect(server.table("user_project_definitions").get("user-1/p-first")?.value).toBeNull();
    }
  });

  it("skips a changed local version instead of overwriting the user's newer edit", async () => {
    const target = await definitionScopeFixture();
    const apply = target.tracker.applySyncedDefinition;
    vi.spyOn(target.tracker, "applySyncedDefinition").mockImplementationOnce(async (input) => {
      at("09:15");
      await target.tracker.saveProject({ id: "p-first", name: "Newer before import", description: "Keep" });
      return apply(input);
    });
    await target.sync();
    expect(target.projects.get("p-first")?.name).toBe("Newer before import");
    await target.sync();
    await target.source.sync();
    expect(target.source.projects.get("p-first")?.name).toBe("Newer before import");
  });

  it("propagates a native account mismatch without overwriting that account's ledger", async () => {
    const target = await definitionScopeFixture();
    const apply = target.tracker.applySyncedDefinition;
    vi.spyOn(target.tracker, "applySyncedDefinition").mockImplementationOnce(async (input) => {
      target.state.sync_account_id = "user-2";
      target.state[SYNC_DEFINITION_LEDGER_KEY] = "next-account-ledger";
      return apply(input);
    });
    await expect(target.sync()).rejects.toThrow("Device sync account scope changed.");
    expect(target.state[SYNC_DEFINITION_LEDGER_KEY]).toBe("next-account-ledger");
    expect(target.projects.get("p-first")?.name).toBe("Before sync");
    expect(server.state.upserts).toBe(0);
  });

  it("keeps a committed import acknowledged if the later renderer ledger write fails", async () => {
    const target = await definitionScopeFixture();
    const expected = structuredClone(server.table("user_project_definitions").get("user-1/p-first"));
    vi.spyOn(target.tracker, "setSyncState").mockRejectedValueOnce(new Error("renderer journal unavailable"));
    await expect(target.sync()).rejects.toThrow("renderer journal unavailable");
    await target.sync();
    await target.source.sync();
    expect(server.table("user_project_definitions").get("user-1/p-first")).toEqual(expected);
    expect(target.source.projects.get("p-first")?.anchors).toEqual([{ kind: "domain", value: "remote.example.com", source: "manual" }]);
  });

  it.each(["save", "delete"] as const)("applies a singleton rule %s interrupted after atomic commit exactly once", async (action) => {
    const source = device();
    const target = device();
    at("09:05");
    const rule = await source.tracker.saveClassificationRule(site("only.example.com"));
    await source.sync();
    if (action === "delete") {
      await target.sync();
      target.tracker.applyClassificationRules.mockClear();
      at("09:10");
      await source.tracker.deleteClassificationRule(rule.id);
      await source.sync();
    }
    const paused = pauseWrite(target.tracker.applySyncedDefinition);
    vi.spyOn(target.tracker, "applySyncedDefinition").mockImplementationOnce(paused.write);
    let current = true;
    const outcome = syncProjectsAndRulesForAccount("user-1", () => current, target.tracker).catch((error: unknown) => error);
    await paused.entered;
    current = false;
    paused.release();
    await outcome;
    expect(target.rules.size).toBe(action === "save" ? 1 : 0);
    expect(target.tracker.applyClassificationRules).not.toHaveBeenCalled();
    await target.sync();
    expect(target.tracker.applyClassificationRules).toHaveBeenCalledTimes(1);
    await target.sync();
    expect(target.tracker.applyClassificationRules).toHaveBeenCalledTimes(1);
  });

  it("retries failed rule application without resaving or repeating completed work", async () => {
    const source = device();
    const target = device();
    at("09:05");
    await source.tracker.saveClassificationRule(site("only.example.com"));
    await source.sync();
    const apply = vi.spyOn(target.tracker, "applySyncedDefinition");
    target.tracker.applyClassificationRules.mockRejectedValueOnce(new Error("apply unavailable"));
    await expect(target.sync()).rejects.toThrow("apply unavailable");
    expect(apply).toHaveBeenCalledTimes(1);
    await target.sync();
    await target.sync();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(target.tracker.applyClassificationRules).toHaveBeenCalledTimes(2);
  });

  it("recovers a new same-account scope after the cancelled atomic import drains", async () => {
    const target = await definitionScopeFixture();
    const paused = pauseWrite(target.tracker.applySyncedDefinition);
    vi.spyOn(target.tracker, "applySyncedDefinition").mockImplementationOnce(paused.write);
    let current = true;
    const old = syncProjectsAndRulesForAccount("user-1", () => current, target.tracker).catch((error: unknown) => error);
    await paused.entered;
    current = false;
    const next = target.sync();
    paused.release();
    await Promise.all([old, next]);
    expect(target.projects.has("p-next")).toBe(true);
    expect(target.rules.size).toBe(2);
  });

  it("notifies a project committed natively even if its response was lost", async () => {
    const source = device();
    const target = device();
    await source.tracker.saveProject({ id: "p-notify", name: "Committed", description: "" });
    await source.sync();
    const original = target.tracker.applySyncedDefinition;
    vi.spyOn(target.tracker, "applySyncedDefinition").mockImplementationOnce(async (input) => {
      await original(input);
      throw new Error("response lost");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const notified = vi.fn();
    window.addEventListener(PROJECT_RULE_DEFINITIONS_SYNCED_EVENT, notified);
    try {
      await target.sync();
      expect(notified).toHaveBeenCalledTimes(1);
      expect(notified.mock.calls[0][0].detail).toEqual({ projects: true, rules: false });
    } finally { window.removeEventListener(PROJECT_RULE_DEFINITIONS_SYNCED_EVENT, notified); }
  });

});
