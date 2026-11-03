// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { ScreenContextClient, type ScreenContextInvoke } from "./screenContextClient";
import { loadScreenEvidenceRows, type ScreenEvidenceRow } from "./useScreenEvidenceRows";

const LEASE = "a9db1b29-80fb-4104-9272-46e0845a4774";
const INSTANCE = "5f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const id = (index: number) => "00000000-0000-4000-8000-" + String(index + 1).padStart(12, "0");
const clients: ScreenContextClient[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.dispose()));

/** Screens every 10 seconds, served 20 to a page oldest first, as the native list does. */
function fixture(total: number) {
  const base = Date.now() - total * 10_000;
  const invoke = vi.fn<ScreenContextInvoke>(async (command, args) => {
    if (command === "screen_context_revoke_account") return;
    if (command === "screen_context_bind_account") return { leaseId: LEASE, value: { mode: "local", expiresAtMs: Date.now() + 900_000 } };
    if (command === "screen_context_list_activity_evidence" || command === "screen_context_list_evidence") {
      const cursor = args?.cursor as { id: string } | null;
      const start = cursor ? Number(cursor.id.slice(-12)) : 0;
      const records = Array.from({ length: Math.max(0, Math.min(20, total - start)) }, (_, offset) => ({
        id: id(start + offset), observedAtMs: base + (start + offset) * 10_000, expiresAtMs: Date.now() + 3_600_000,
        textSource: "none", textState: "not_requested", frameRetained: true,
      }));
      const last = start + records.length - 1;
      return { leaseId: LEASE, value: { records, nextCursor: start + records.length < total
        ? { instance: INSTANCE, revision: 1, observedAtMs: base + last * 10_000, id: id(last) } : null } };
    }
    throw new Error("Unexpected command " + command);
  });
  const client = new ScreenContextClient(invoke, true);
  client.setAccount(null);
  void client.connect().catch(() => undefined);
  clients.push(client);
  return client;
}

async function load(client: ScreenContextClient, kind: "activity" | "recent") {
  let rows: ScreenEvidenceRow[] = [];
  await loadScreenEvidenceRows(client, kind === "activity" ? { kind, selection: { recordIds: ["1"], windows: [[0, Date.now()]] } } : { kind },
    (value) => { rows = value; });
  return rows;
}

it("lists every screen of a three-hour activity, so its replay reaches the end", async () => {
  // Three hours at the 10-second interval: 1,080 screens, 54 pages.
  const rows = await load(fixture(1080), "activity");
  expect(rows).toHaveLength(1080);
  expect(rows[0].id).toBe(id(0));
  expect(rows[1079].id).toBe(id(1079));
});

it("keeps the recent-screens list at its earlier 12 pages", async () => {
  expect(await load(fixture(1080), "recent")).toHaveLength(240);
});
