// @vitest-environment node
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassificationRuleInput, ProjectInput, ProjectAnchor, SyncedDefinitionInput } from "@drifty/domain";

const server = vi.hoisted(() => {
  type Row = { user_id: string; key: string; value: unknown; updated_at: string };
  const tables = new Map<string, Map<string, Row>>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "qa-atomic" } } }, error: null }) },
    from: (name: string) => ({
      select: () => ({ eq: (_key: string, id: string) => ({ order: () => ({ range: async (from: number, to: number) => ({
        data: [...table(name).values()].filter((row) => row.user_id === id).sort((a, b) => a.key.localeCompare(b.key)).slice(from, to + 1), error: null,
      }) }) }) }),
      upsert: async (rows: Row[]) => {
        for (const row of rows) {
          const key = row.user_id + "/" + row.key;
          const previous = table(name).get(key);
          if (!previous || previous.updated_at <= row.updated_at) table(name).set(key, structuredClone(row));
        }
        return { error: null };
      },
    }),
  };
  return { tables, table, client };
});
vi.mock("../../lib/supabase/client", () => ({ supabase: server.client }));
import legacyAck from "./projectRuleAccountSync.legacy-ack.fixture.json";
import { syncProjectsAndRulesForAccount } from "./projectRuleAccountSync";

type SyncTracker = NonNullable<Parameters<typeof syncProjectsAndRulesForAccount>[2]>;
const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const python = String.raw`
import sys,json
from pathlib import Path
from app.storage.db import TrackerDatabase
db=TrackerDatabase(Path(sys.argv[1]))
handlers={
 'getProjects': db.get_projects, 'getClassificationRules': db.get_classification_rules,
 'getSyncState': db.get_sync_state, 'applySyncedDefinition': db.apply_synced_definition,
 'applyClassificationRules': db.apply_classification_rules,
 'setSyncState': lambda entries: {'written':db.set_sync_state(entries)},
 'saveProject': db.save_project, 'deleteProject': lambda key: {'deleted':db.delete_project(key)},
 'saveProjectAnchors': db.save_project_anchors, 'saveClassificationRule':db.save_classification_rule,
}
for line in sys.stdin:
 request=json.loads(line)
 try: print(json.dumps({'id':request['id'],'value':handlers[request['method']](*request['args'])}),flush=True)
 except Exception as error: print(json.dumps({'id':request['id'],'error':str(error)}),flush=True)
db.close()
`;
const guests: { process: ChildProcessWithoutNullStreams; directory: string }[] = [];

async function nativeDevice() {
  const directory = await mkdtemp(join(tmpdir(), "drifty-definition-atomic-"));
  const child = spawn(process.env.PYTHON ?? "python3", ["-u", "-c", python, join(directory, "tracker.sqlite")], {
    env: { ...process.env, PYTHONPATH: join(repository, "services/tracker-python") }, stdio: "pipe",
  });
  guests.push({ process: child, directory });
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const response = JSON.parse(line) as { id: number; value?: unknown; error?: string };
    const waiter = pending.get(response.id);
    pending.delete(response.id);
    if (response.error) waiter?.reject(new Error(response.error));
    else waiter?.resolve(response.value);
  });
  let stderr = "";
  child.stderr.on("data", (value: Buffer) => { stderr += value.toString(); });
  child.on("error", (error) => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); });
  child.on("exit", (code) => {
    for (const waiter of pending.values()) waiter.reject(new Error(`Synthetic SQLite RPC exited (${code}): ${stderr}`));
    pending.clear(); lines.close();
  });
  function call<T>(method: string, ...args: unknown[]): Promise<T> {
    const id = ++sequence;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      child.stdin.write(JSON.stringify({ id, method, args }) + "\n");
    });
  }
  const tracker: SyncTracker = {
    getProjects: () => call("getProjects"), getClassificationRules: () => call("getClassificationRules"),
    getSyncState: () => call("getSyncState"), setSyncState: (entries) => call("setSyncState", entries),
    applySyncedDefinition: (input) => call("applySyncedDefinition", input), applyClassificationRules: () => call("applyClassificationRules"),
  };
  await tracker.setSyncState({ sync_account_id: "qa-atomic" });
  return {
    tracker,
    saveProject: (input: ProjectInput) => call("saveProject", input),
    deleteProject: (id: string) => call("deleteProject", id),
    saveAnchors: (id: string, anchors: ProjectAnchor[]) => call("saveProjectAnchors", id, anchors),
    saveRule: (input: ClassificationRuleInput) => call("saveClassificationRule", input),
    sync: () => syncProjectsAndRulesForAccount("qa-atomic", () => true, tracker),
  };
}

afterEach(async () => {
  for (const guest of guests.splice(0)) {
    guest.process.stdin.end();
    if (guest.process.exitCode === null) await new Promise<void>((resolve) => { guest.process.once("exit", () => resolve()); });
    await rm(guest.directory, { recursive: true, force: true });
  }
  server.tables.clear();
  vi.restoreAllMocks();
});

describe("actual TypeScript sync to Python SQLite", () => {
  it("consumes a durable native value ACK after cancellation without date or Unicode-anchor drift", async () => {
    const source = await nativeDevice();
    const target = await nativeDevice();
    await source.saveProject({ id: "p-native", name: "Atomic project", description: "Synthetic only" });
    await source.saveAnchors("p-native", [
      { kind: "keyword", value: "école", source: "manual" },
      { kind: "keyword", value: "é", source: "manual" },
      { kind: "keyword", value: "e\u0301", source: "manual" },
      { kind: "keyword", value: "Zoo", source: "manual" },
      { kind: "keyword", value: "alpha", source: "manual" },
    ]);
    await source.sync();
    const originalRow = structuredClone(server.table("user_project_definitions").get("qa-atomic/p-native"));
    let current = true;
    const original = target.tracker.applySyncedDefinition;
    const apply = vi.spyOn(target.tracker, "applySyncedDefinition").mockImplementationOnce(async (input) => {
      const result = await original(input);
      current = false;
      return result;
    });
    await expect(syncProjectsAndRulesForAccount("qa-atomic", () => current, target.tracker)).rejects.toThrow("scope changed");
    const state = await target.tracker.getSyncState();
    expect(JSON.parse(state.state.sync_definition_ledger).projects["p-native"].value.name).toBe("Atomic project");
    await target.sync();
    await target.sync();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(server.table("user_project_definitions").get("qa-atomic/p-native")).toEqual(originalRow);
  });

  it.each(["edit", "delete"] as const)("preserves a real native user %s after atomic commit and before response delivery", async (action) => {
    const source = await nativeDevice();
    const target = await nativeDevice();
    await source.saveProject({ id: "p-native", name: "Original remote", description: "" });
    await source.saveAnchors("p-native", [{ kind: "domain", value: "remote.example.com", source: "manual" }]);
    await source.sync();
    let current = true;
    const original = target.tracker.applySyncedDefinition;
    vi.spyOn(target.tracker, "applySyncedDefinition").mockImplementationOnce(async (input: SyncedDefinitionInput) => {
      const result = await original(input);
      current = false;
      if (action === "edit") {
        await target.saveProject({ id: "p-native", name: "My native edit", description: "Keep this edit" });
        await target.saveAnchors("p-native", [{ kind: "keyword", value: "mine", source: "manual" }]);
      } else await target.deleteProject("p-native");
      return result;
    });
    await expect(syncProjectsAndRulesForAccount("qa-atomic", () => current, target.tracker)).rejects.toThrow("scope changed");
    await target.sync();
    await source.sync();
    const projects = await source.tracker.getProjects();
    if (action === "edit") {
      expect(projects[0].name).toBe("My native edit");
      expect(projects[0].anchors.some((anchor) => anchor.value === "mine")).toBe(true);
    } else {
      expect(projects).toEqual([]);
      expect(server.table("user_project_definitions").get("qa-atomic/p-native")?.value).toBeNull();
    }
  });

  it("consumes the native pending flag for a singleton rule exactly once after OFF/ON", async () => {
    const source = await nativeDevice();
    const target = await nativeDevice();
    await source.saveRule({ targetKind: "site", targetValue: "only.example.com", category: "learning", productivity: "focus" });
    await source.sync();
    let current = true;
    const original = target.tracker.applySyncedDefinition;
    vi.spyOn(target.tracker, "applySyncedDefinition").mockImplementationOnce(async (input) => {
      const result = await original(input);
      current = false;
      return result;
    });
    const apply = vi.spyOn(target.tracker, "applyClassificationRules");
    await expect(syncProjectsAndRulesForAccount("qa-atomic", () => current, target.tracker)).rejects.toThrow("scope changed");
    expect((await target.tracker.getClassificationRules())).toHaveLength(1);
    expect(apply).not.toHaveBeenCalled();
    await target.sync();
    await target.sync();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("retains an atomic ACK after response loss so a later native deletion stays deleted", async () => {
    const source = await nativeDevice();
    const target = await nativeDevice();
    await source.saveProject({ id: "p-native", name: "Original remote", description: "" });
    await source.sync();
    const original = target.tracker.applySyncedDefinition;
    vi.spyOn(target.tracker, "applySyncedDefinition").mockImplementationOnce(async (input) => {
      await original(input);
      await target.deleteProject("p-native");
      throw new Error("synthetic native response lost after commit");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await target.sync();
    await target.sync();
    await source.sync();
    expect(await target.tracker.getProjects()).toEqual([]);
    expect(await source.tracker.getProjects()).toEqual([]);
    expect(server.table("user_project_definitions").get("qa-atomic/p-native")?.value).toBeNull();
  });

  it("recovers the committed pending rule flag when its import response is lost", async () => {
    const source = await nativeDevice();
    const target = await nativeDevice();
    await source.saveRule({ targetKind: "site", targetValue: "only.example.com", category: "learning", productivity: "focus" });
    await source.sync();
    const original = target.tracker.applySyncedDefinition;
    vi.spyOn(target.tracker, "applySyncedDefinition").mockImplementationOnce(async (input) => {
      await original(input);
      throw new Error("synthetic native response lost after commit");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const apply = vi.spyOn(target.tracker, "applyClassificationRules");
    await target.sync();
    await target.sync();
    expect(apply).toHaveBeenCalledTimes(1);
  });


  it("keeps an intervening newer remote edit when composed and decomposed anchors collate equally", async () => {
    const target = await nativeDevice();
    const base = Date.now();
    const value = {
      name: "Unicode", description: "Synthetic only", color: "#6366f1", status: "active",
      anchors: [{ kind: "keyword", value: "é", source: "manual" }, { kind: "keyword", value: "e\u0301", source: "manual" }],
      createdAt: new Date(base - 120_000).toISOString(),
    };
    server.table("user_project_definitions").set("qa-atomic/p-native", { user_id: "qa-atomic", key: "p-native", value, updated_at: new Date(base - 120_000).toISOString() });
    let current = true;
    const original = target.tracker.applySyncedDefinition;
    vi.spyOn(target.tracker, "applySyncedDefinition").mockImplementationOnce(async (input) => {
      const result = await original(input);
      current = false;
      return result;
    });
    await expect(syncProjectsAndRulesForAccount("qa-atomic", () => current, target.tracker)).rejects.toThrow("scope changed");
    const row = server.table("user_project_definitions").get("qa-atomic/p-native")!;
    row.value = { ...value, name: "Newer remote edit" };
    row.updated_at = new Date(base - 60_000).toISOString();
    await target.sync();
    expect((row.value as { name: string }).name).toBe("Newer remote edit");
    expect((server.table("user_project_definitions").get("qa-atomic/p-native")!.value as { name: string }).name).toBe("Newer remote edit");
    expect((await target.tracker.getProjects())[0].name).toBe("Newer remote edit");
  });


  it("does not repeatedly import a server row written with an older anchor order", async () => {
    const target = await nativeDevice();
    const at = new Date(Date.now() - 120_000).toISOString();
    server.table("user_project_definitions").set("qa-atomic/p-native", {
      user_id: "qa-atomic", key: "p-native", updated_at: at,
      value: { name: "Unordered anchors", description: "", color: "#6366f1", status: "active", createdAt: at,
        anchors: [{ kind: "keyword", value: "é", source: "manual" }, { kind: "keyword", value: "e\u0301", source: "manual" }] },
    });
    const apply = vi.spyOn(target.tracker, "applySyncedDefinition");
    await target.sync();
    await target.sync();
    expect(apply).toHaveBeenCalledTimes(1);
    expect((await target.tracker.getProjects())[0].anchors).toHaveLength(2);
  });


  it("upgrades a legacy hash ACK without promoting unchanged content and still sends a real later edit", async () => {
    const target = await nativeDevice();
    const { id, name, description, color, createdAt } = legacyAck.project;
    await target.saveProject({ id, name, description, color, createdAt, status: "active" });
    await target.saveAnchors(id, legacyAck.project.anchors.map((anchor) => ({ kind: "keyword", value: anchor.value, source: "manual" })));
    const base = Date.now();
    await target.tracker.setSyncState({ sync_definition_ledger: JSON.stringify({
      projects: { [id]: { at: new Date(base - 120_000).toISOString(), hash: legacyAck.legacyHash } }, rules: {},
    }) });
    const remoteAt = new Date(base - 60_000).toISOString();
    server.table("user_project_definitions").set("qa-atomic/" + id, {
      user_id: "qa-atomic", key: id, updated_at: remoteAt, value: { ...legacyAck.legacyValue, name: "Newer remote edit" },
    });
    await target.sync();
    expect((await target.tracker.getProjects())[0].name).toBe("Newer remote edit");
    expect((server.table("user_project_definitions").get("qa-atomic/" + id)!.value as { name: string }).name).toBe("Newer remote edit");
    expect(server.table("user_project_definitions").get("qa-atomic/" + id)!.updated_at).toBe(remoteAt);
    const state = await target.tracker.getSyncState();
    expect(JSON.parse(state.state.sync_definition_ledger).projects[id].hashVersion).toBe(2);
    await target.saveProject({ id, name: "A real later edit", description: "Keep my edit" });
    await target.sync();
    expect((server.table("user_project_definitions").get("qa-atomic/" + id)!.value as { name: string }).name).toBe("A real later edit");
  });


  it("keeps the original time when only a legacy ACK representation is upgraded", async () => {
    const target = await nativeDevice();
    const { id, name, description, color, createdAt } = legacyAck.project;
    await target.saveProject({ id, name, description, color, createdAt, status: "active" });
    await target.saveAnchors(id, legacyAck.project.anchors.map((anchor) => ({ kind: "keyword", value: anchor.value, source: "manual" })));
    const at = new Date(Date.now() - 120_000).toISOString();
    await target.tracker.setSyncState({ sync_definition_ledger: JSON.stringify({ projects: { [id]: { at, hash: legacyAck.legacyHash } }, rules: {} }) });
    server.table("user_project_definitions").set("qa-atomic/" + id, { user_id: "qa-atomic", key: id, updated_at: at, value: legacyAck.legacyValue });
    const apply = vi.spyOn(target.tracker, "applySyncedDefinition");
    await target.sync();
    await target.sync();
    expect(apply).not.toHaveBeenCalled();
    expect(server.table("user_project_definitions").get("qa-atomic/" + id)!.updated_at).toBe(at);
    const entry = JSON.parse((await target.tracker.getSyncState()).state.sync_definition_ledger).projects[id];
    expect(entry.at).toBe(at);
    expect(entry.hashVersion).toBe(2);
    expect(entry.hash).not.toBe(legacyAck.legacyHash);
  });

});
