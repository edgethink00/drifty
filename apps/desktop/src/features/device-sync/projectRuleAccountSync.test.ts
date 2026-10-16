// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassificationRule, ClassificationRuleInput, Project, ProjectAnchor, ProjectInput } from "@drifty/domain";

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

import { syncProjectsAndRulesForAccount } from "./projectRuleAccountSync";
import { PROJECT_RULE_DEFINITIONS_SYNCED_EVENT } from "./projectRuleSyncEvent";

type SyncTracker = NonNullable<Parameters<typeof syncProjectsAndRulesForAccount>[2]>;

/** A tracker that keeps projects and rules the way the Python tracker does. */
function device() {
  const projects = new Map<string, Project>();
  const rules = new Map<string, ClassificationRule>();
  const state: Record<string, string> = {};
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
      return project;
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
    getSyncState: async () => ({ state: { ...state }, counterSeq: 0, pendingDeletions: 0 }),
    setSyncState: async (entries: Record<string, string | null>) => {
      for (const [key, value] of Object.entries(entries)) {
        if (value === null) delete state[key];
        else state[key] = value;
      }
      return { written: Object.keys(entries).length };
    },
  };
  return { tracker, projects, rules, state, sync: () => syncProjectsAndRulesForAccount("user-1", () => true, tracker as unknown as SyncTracker) };
}

const at = (time: string) => vi.setSystemTime(new Date("2026-10-16T" + time + ":00Z"));
const projectNames = (projects: Map<string, Project>) => [...projects.values()].map((project) => project.name).sort();
const site = (targetValue: string, productivity: ClassificationRuleInput["productivity"] = "focus"): ClassificationRuleInput =>
  ({ targetKind: "site", targetValue, category: "learning", productivity });

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
});

