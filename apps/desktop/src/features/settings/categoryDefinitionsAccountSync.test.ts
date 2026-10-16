// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// One account's rows, kept as the server does: an older edit never overwrites a newer one.
const server = vi.hoisted(() => {
  type Row = { user_id: string; key: string; value: unknown; updated_at: string };
  const rows = new Map<string, Row>();
  const state = { userId: "user-1", failSelect: false };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: state.userId } } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: async (_column: string, userId: string) => (state.failSelect
          ? { data: null, error: new Error("relation \"public.user_category_definitions\" does not exist") }
          : { data: [...rows.values()].filter((row) => row.user_id === userId).map(({ key, value, updated_at }) => ({ key, value, updated_at })), error: null }),
      }),
      upsert: async (input: Row[]) => {
        for (const row of input) {
          const id = row.user_id + "/" + row.key;
          const current = rows.get(id);
          if (!current || row.updated_at >= current.updated_at) rows.set(id, { ...row });
        }
        return { error: null };
      },
    }),
  };
  return { rows, state, client };
});
vi.mock("../../lib/supabase/client", () => ({ supabase: server.client }));

import { mergeDefinitionRecords, syncCategoryDefinitionsForAccount } from "./categoryDefinitionsAccountSync";
import { CATEGORY_DEFINITION_LEDGER_STORAGE_KEY, readDefinitionLedger } from "./categoryDefinitionLedger";
import {
  persistAppThemeColorOverrides,
  persistCategoryColorOverrides,
  readCategoryCustomizations,
  readCategoryOrder,
  readProductivityCustomizations,
  resolveInitialAppThemeColorOverrides,
  resolveInitialCategoryColorOverrides,
  writeCategoryCustomizations,
  writeCategoryOrder,
  writeProductivityCustomizations,
} from "./settingsStorage";

type Device = Record<string, string>;

/** Runs one step on a device: its own local storage, then put away again. */
function onDevice(device: Device, step: () => void | Promise<void>): Promise<void> {
  window.localStorage.clear();
  for (const [key, value] of Object.entries(device)) window.localStorage.setItem(key, value);
  return Promise.resolve(step()).then(() => {
    for (const key of Object.keys(device)) delete device[key];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)!;
      device[key] = window.localStorage.getItem(key)!;
    }
  });
}

const definitions = () => ({
  categories: readCategoryCustomizations(),
  productivity: readProductivityCustomizations(),
  order: readCategoryOrder(),
  categoryColors: resolveInitialCategoryColorOverrides(),
  themeColors: resolveInitialAppThemeColorOverrides(),
});

describe("category definitions across devices", () => {
  beforeEach(() => {
    server.rows.clear();
    server.state.userId = "user-1";
    server.state.failSelect = false;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T09:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("brings one device's definitions to the next, colors and order included, then follows the newer edit back", async () => {
    const mac: Device = {};
    const windows: Device = {};
    await onDevice(mac, () => {
      writeCategoryCustomizations({
        learning: { name: "공부", description: "강의와 문서" },
        "custom-run12345": { name: "운동", color: "#3366aa", createdAt: "2026-10-16T08:00:00.000Z", productivity: "neutral", level: "level-rest1234" },
      });
      writeProductivityCustomizations({ drift: { description: "업무와 무관한 영상" }, "level-rest1234": { name: "휴식", color: "#88aa33", createdAt: "2026-10-16T08:00:00.000Z" } });
      writeCategoryOrder(["custom-run12345", "workspace"]);
      persistCategoryColorOverrides({ workspace: "#112233" });
      persistAppThemeColorOverrides({ accent: "#000000", productivityFocus: "#224466" });
    });
    await onDevice(mac, () => syncCategoryDefinitionsForAccount("user-1"));
    await onDevice(windows, () => syncCategoryDefinitionsForAccount("user-1"));

    let onMac: ReturnType<typeof definitions> | null = null;
    let onWindows: ReturnType<typeof definitions> | null = null;
    await onDevice(mac, () => { onMac = definitions(); });
    await onDevice(windows, () => { onWindows = definitions(); });
    expect(onWindows!.categories).toEqual(onMac!.categories);
    expect(onWindows!.productivity).toEqual(onMac!.productivity);
    expect(onWindows!.order.slice(0, 2)).toEqual(["custom-run12345", "workspace"]);
    expect(onWindows!.categoryColors).toEqual({ workspace: "#112233" });
    // The accent is an app setting, not a definition: it stays on the Mac.
    expect(onWindows!.themeColors).toEqual({ productivityFocus: "#224466" });

    // Later, Windows renames 학습 and puts 작업's color back; the Mac follows.
    vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    await onDevice(windows, () => {
      writeCategoryCustomizations({ ...readCategoryCustomizations(), learning: { name: "독서" } });
      persistCategoryColorOverrides({});
    });
    await onDevice(windows, () => syncCategoryDefinitionsForAccount("user-1"));
    await onDevice(mac, () => syncCategoryDefinitionsForAccount("user-1"));
    await onDevice(mac, () => { onMac = definitions(); });
    expect(onMac!.categories.learning).toEqual({ name: "독서" });
    expect(onMac!.categoryColors).toEqual({});
    expect(onMac!.categories["custom-run12345"]?.name).toBe("운동");
  });

  it("lets the first device to sync set definitions both had changed before, and keeps each one's other changes", async () => {
    const mac: Device = {};
    const windows: Device = {};
    await onDevice(mac, () => { writeCategoryCustomizations({ learning: { name: "공부" } }); });
    await onDevice(windows, () => { writeCategoryCustomizations({ learning: { name: "학습 시간" }, music: { name: "음악 감상" } }); });
    // Edits from before this version carry no time.
    for (const device of [mac, windows]) delete device[CATEGORY_DEFINITION_LEDGER_STORAGE_KEY];

    await onDevice(mac, () => syncCategoryDefinitionsForAccount("user-1"));
    await onDevice(windows, () => syncCategoryDefinitionsForAccount("user-1"));
    await onDevice(mac, () => syncCategoryDefinitionsForAccount("user-1"));

    for (const device of [mac, windows]) {
      await onDevice(device, () => {
        expect(readCategoryCustomizations()).toEqual({ learning: { name: "공부" }, music: { name: "음악 감상" } });
      });
    }
  });

  it("skips rows this version cannot read and keeps the account's times so nothing is sent back", async () => {
    server.rows.set("user-1/category:learning", { user_id: "user-1", key: "category:learning", value: { name: "공부", color: "not-a-color" }, updated_at: "2026-10-16T08:00:00+00:00" });
    server.rows.set("user-1/notes", { user_id: "user-1", key: "notes", value: { text: "x" }, updated_at: "2026-10-16T08:00:00+00:00" });
    const device: Device = {};
    await onDevice(device, () => syncCategoryDefinitionsForAccount("user-1"));
    await onDevice(device, () => {
      expect(readCategoryCustomizations()).toEqual({ learning: { name: "공부" } });
      expect(resolveInitialCategoryColorOverrides()).toEqual({});
      expect(readDefinitionLedger()).toEqual({ "category:learning": "2026-10-16T08:00:00.000Z" });
    });
    const before = JSON.stringify([...server.rows.values()]);
    await onDevice(device, () => syncCategoryDefinitionsForAccount("user-1"));
    expect(JSON.stringify([...server.rows.values()])).toBe(before);
  });

  it("stops before writing anything when another account signs in", async () => {
    server.rows.set("user-1/category:learning", { user_id: "user-1", key: "category:learning", value: { name: "공부" }, updated_at: "2026-10-16T08:00:00+00:00" });
    server.state.userId = "user-2";
    const device: Device = {};
    await onDevice(device, async () => {
      await expect(syncCategoryDefinitionsForAccount("user-1")).rejects.toThrow("account scope changed");
      expect(readCategoryCustomizations()).toEqual({});
    });
  });
});

describe("merging definition rows", () => {
  const row = (key: string, value: Record<string, unknown> | null, updatedAt: string) => ({ key, value, updatedAt });

  it("takes the newer edit from either side, and the account's copy on a tie", () => {
    const { toLocal, toRemote } = mergeDefinitionRecords(
      [row("category:learning", { name: "A" }, "2026-10-16T10:00:00.000Z"), row("category:music", { name: "B" }, "2026-10-16T08:00:00.000Z"), row("order", null, "2026-10-16T08:00:00.000Z")],
      [row("category:learning", { name: "C" }, "2026-10-16T09:00:00.000Z"), row("category:music", { name: "D" }, "2026-10-16T09:00:00.000Z"), row("order", { order: ["music"] }, "2026-10-16T08:00:00.000Z")],
    );
    expect(toRemote.map((record) => record.key)).toEqual(["category:learning"]);
    expect(toLocal.map((record) => record.key)).toEqual(["category:music", "order"]);
  });
});

describe("edit times", () => {
  afterEach(() => window.localStorage.clear());

  it("are stamped only for the definitions that changed", () => {
    writeCategoryCustomizations({ learning: { name: "공부" } });
    const first = readDefinitionLedger();
    expect(Object.keys(first)).toEqual(["category:learning"]);
    writeCategoryCustomizations({ learning: { name: "공부" }, music: { name: "음악 감상" } });
    expect(Object.keys(readDefinitionLedger()).sort()).toEqual(["category:learning", "category:music"]);
    expect(readDefinitionLedger()["category:learning"]).toBe(first["category:learning"]);
    persistAppThemeColorOverrides({ accent: "#000000" });
    expect(Object.keys(readDefinitionLedger())).not.toContain("productivity:focus");
    persistAppThemeColorOverrides({ accent: "#000000", productivityDrift: "#aa0000" });
    expect(Object.keys(readDefinitionLedger())).toContain("productivity:drift");
  });
});

