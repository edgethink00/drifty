const PHASES = ["unavailable", "extracting", "limited", "retrying", "pending", "failed", "ready", "waiting_for_source"] as const;
export type MemoryDiagnostics = {
  phase: typeof PHASES[number];
  as_of_ms: number;
  last_source_at_ms: number | null;
  last_extracted_at_ms: number | null;
  next_attempt_at_ms: number | null;
  facts: number; running: number; waiting: number; exhausted: number; errors: number;
  writes_hour: number; writes_day: number; queries_hour: number;
  writes_hour_limit: number; writes_day_limit: number; queries_hour_limit: number;
  hour_resets_at_ms: number; day_resets_at_ms: number;
};
export type MemoryStatus = {
  supported: boolean;
  /** apps: memory's own chosen apps; empty in settings saved before memory kept its own list. */
  preferences: { enabled: boolean; retentionHours: number; workSites: string[]; apps: string[] };
  active: boolean;
  sources: number;
  groups: number;
  diagnostics: MemoryDiagnostics | null;
  /** Unknown while memory is off: pages persist but no engine reports them. */
  wikiPages: number | null;
  error: "memory_credentials_required" | "memory_unavailable" | null;
  /**
   * How memory can reach its model, only when asked for (Settings): a Drifty
   * Cloud session (trial or Pro) or the user's own Anthropic key. Never a key.
   */
  credentials: { anthropic: boolean; cloud: boolean } | null;
  /** The route the running engine uses, why its last model call failed, and the on-device search model. */
  route: MemoryRoute | null;
};
const ROUTE_ERRORS = ["sign_in_required", "full_account_required", "plan_required", "credits_exhausted", "memory_hourly_limit",
  "memory_daily_limit", "key_rejected", "provider_busy", "unavailable"] as const;
const EMBEDDING_STATES = ["idle", "loading", "ready", "failed"] as const;
export type MemoryRoute = {
  kind: "own" | "cloud";
  error: typeof ROUTE_ERRORS[number] | null;
  embedding: typeof EMBEDDING_STATES[number];
};
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("memory_unavailable");
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("memory_unavailable");
  return value;
}
function timestamp(value: unknown): number {
  const result = count(value);
  if (result > 8640000000000000) throw new Error("memory_unavailable");
  return result;
}
function optionalTime(value: unknown): number | null { return value === null ? null : timestamp(value); }
function diagnostics(raw: unknown): MemoryDiagnostics | null {
  if (raw === undefined || raw === null) return null;
  const value = object(raw);
  if (!PHASES.includes(value.phase as MemoryDiagnostics["phase"])) throw new Error("memory_unavailable");
  return {
    phase: value.phase as MemoryDiagnostics["phase"], as_of_ms: timestamp(value.as_of_ms),
    last_source_at_ms: optionalTime(value.last_source_at_ms), last_extracted_at_ms: optionalTime(value.last_extracted_at_ms), next_attempt_at_ms: optionalTime(value.next_attempt_at_ms),
    facts: count(value.facts), running: count(value.running), waiting: count(value.waiting), exhausted: count(value.exhausted), errors: count(value.errors),
    writes_hour: count(value.writes_hour), writes_day: count(value.writes_day), queries_hour: count(value.queries_hour),
    writes_hour_limit: count(value.writes_hour_limit), writes_day_limit: count(value.writes_day_limit), queries_hour_limit: count(value.queries_hour_limit),
    hour_resets_at_ms: timestamp(value.hour_resets_at_ms), day_resets_at_ms: timestamp(value.day_resets_at_ms),
  };
}
function route(raw: unknown): MemoryRoute | null {
  if (raw === undefined || raw === null) return null;
  const value = object(raw);
  if (value.kind !== "own" && value.kind !== "cloud") throw new Error("memory_unavailable");
  const error = value.error === null || value.error === undefined ? null
    : ROUTE_ERRORS.includes(value.error as MemoryRoute["error"] & string) ? value.error as MemoryRoute["error"] : "unavailable";
  const embedding = EMBEDDING_STATES.includes(value.embedding as MemoryRoute["embedding"]) ? value.embedding as MemoryRoute["embedding"] : "idle";
  return { kind: value.kind, error, embedding };
}
export function decodeMemoryStatus(raw: unknown): MemoryStatus {
  const value = object(raw), prefs = object(value.preferences), status = value.status === null ? {} : object(value.status);
  if (typeof value.supported !== "boolean" || typeof prefs.enabled !== "boolean" || typeof prefs.retentionHours !== "number"
    || !Number.isInteger(prefs.retentionHours) || prefs.retentionHours < 1 || prefs.retentionHours > 24) throw new Error("memory_unavailable");
  const workSites = prefs.workSites === undefined ? [] : prefs.workSites;
  const apps = prefs.apps === undefined ? [] : prefs.apps;
  if (!Array.isArray(apps) || apps.length > 64 || apps.some((app) => typeof app !== "string" || !app || app.length > 64)) throw new Error("memory_unavailable");
  if (!Array.isArray(workSites) || workSites.length > 32 || workSites.some((site) => typeof site !== "string" || !site || site.length > 253)) throw new Error("memory_unavailable");
  const credentials = value.credentials === undefined || value.credentials === null ? null : object(value.credentials);
  if (credentials && (typeof credentials.anthropic !== "boolean" || typeof credentials.cloud !== "boolean")) throw new Error("memory_unavailable");
  return { supported: value.supported, preferences: { enabled: prefs.enabled, retentionHours: prefs.retentionHours, workSites: workSites as string[], apps: apps as string[] }, active: status.active === true,
    sources: count(status.sources ?? 0), groups: count(status.remembered_groups ?? 0), diagnostics: diagnostics(status.diagnostics),
    wikiPages: status.wiki === undefined ? null : count(object(status.wiki).pages),
    error: status.error === undefined ? null : status.error === "memory_credentials_required" ? status.error : "memory_unavailable",
    credentials: credentials ? { anthropic: credentials.anthropic as boolean, cloud: credentials.cloud as boolean } : null,
    route: route(status.route) };
}
export function decodeMemoryForgotten(raw: unknown): true {
  if (object(raw).forgotten !== true) throw new Error("memory_unavailable");
  return true;
}

export type MemoryWikiLine = {
  readonly id: string; readonly text: string; readonly status: "current" | "past";
  readonly app: string; readonly observedAt: number; readonly originalAvailable: boolean;
  /** Live originals that support the line, newest first; open them in the screen viewer. */
  readonly originalIds: readonly string[];
  /** The earlier line this one replaced, when it records a change. */
  readonly replaces: string | null;
  /** When the wiki wrote the line and, for a past line, when it was replaced. */
  readonly createdAt: number | null;
  readonly replacedAt: number | null;
};
export type MemoryWikiPage = {
  readonly id: string; readonly title: string; readonly kind: "project" | "person" | "topic";
  readonly updatedAt: number; readonly lines: readonly MemoryWikiLine[];
  /** The page's document, written from its lines; absent until first written or after a removal took it down. */
  readonly doc?: MemoryWikiDoc | null;
};
/** One sentence of a page document and the lines it rests on. [[Title]] names another page. */
export type MemoryDocPoint = { readonly text: string; readonly lines: readonly string[] };
export type MemoryWikiDoc = {
  readonly summary: readonly MemoryDocPoint[];
  readonly sections: readonly { readonly heading: string; readonly points: readonly MemoryDocPoint[] }[];
  readonly compiledAt: number;
  /** Current lines the document does not cover yet, newest first. */
  readonly pendingLineIds: readonly string[];
};
/**
 * A written note for one closed stretch of work in the flow: a title, a short
 * summary and what happened, every sentence citing the lines it rests on. It
 * belongs to exactly the lines it was written from; the app shows it only
 * beside that same set.
 */
export type MemorySessionNote = {
  readonly key: string; readonly lineIds: readonly string[]; readonly title: string;
  readonly summary: readonly MemoryDocPoint[]; readonly points: readonly MemoryDocPoint[]; readonly compiledAt: number;
};
const WIKI_KINDS = ["project", "person", "topic"] as const;
const WIKI_ID = /^[0-9a-f]{12}$/;
const SOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function bounded(value: unknown, limit: number): string {
  if (typeof value !== "string" || !value || value.length > limit) throw new Error("memory_unavailable");
  return value;
}
function wikiId(value: unknown): string {
  if (typeof value !== "string" || !WIKI_ID.test(value)) throw new Error("memory_unavailable");
  return value;
}
function originalIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8 || value.some((id) => typeof id !== "string" || id.length > 128)) throw new Error("memory_unavailable");
  // Only native screen record IDs can be opened; the viewer revalidates each one.
  return (value as string[]).filter((id) => SOURCE_ID.test(id));
}
function docPoints(value: unknown, limit: number): MemoryDocPoint[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error("memory_unavailable");
  return value.map((entry: unknown) => {
    const point = object(entry);
    if (!Array.isArray(point.lines) || point.lines.length === 0 || point.lines.length > 4) throw new Error("memory_unavailable");
    return { text: bounded(point.text, 300), lines: point.lines.map(wikiId) };
  });
}
function decodeDoc(value: unknown): MemoryWikiDoc | null {
  if (value === undefined || value === null) return null;
  const doc = object(value);
  if (!Array.isArray(doc.sections) || doc.sections.length > 5 || !Array.isArray(doc.pending_line_ids) || doc.pending_line_ids.length > 40) throw new Error("memory_unavailable");
  return {
    summary: docPoints(doc.summary, 3),
    sections: doc.sections.map((entry: unknown) => {
      const section = object(entry);
      return { heading: bounded(section.heading, 40), points: docPoints(section.points, 8) };
    }),
    compiledAt: timestamp(doc.compiled_at_ms),
    pendingLineIds: doc.pending_line_ids.map(wikiId),
  };
}
/** Pages are remembered summaries kept until deleted; their originals may be gone. */
export function decodeWikiPages(raw: unknown): MemoryWikiPage[] {
  const pages = object(raw).pages;
  if (!Array.isArray(pages) || pages.length > 200) throw new Error("memory_unavailable");
  return pages.map((item: unknown) => {
    const page = object(item);
    if (!WIKI_KINDS.includes(page.kind as MemoryWikiPage["kind"]) || !Array.isArray(page.lines) || page.lines.length > 40) throw new Error("memory_unavailable");
    return {
      id: wikiId(page.id), title: bounded(page.title, 80), kind: page.kind as MemoryWikiPage["kind"], updatedAt: timestamp(page.updated_at_ms),
      lines: page.lines.map((entry: unknown) => {
        const line = object(entry);
        if ((line.status !== "current" && line.status !== "past") || typeof line.original_available !== "boolean") throw new Error("memory_unavailable");
        return { id: wikiId(line.id), text: bounded(line.text, 300), status: line.status, app: bounded(line.app, 256),
          observedAt: timestamp(line.observed_at_ms), originalAvailable: line.original_available,
          originalIds: originalIds(line.original_source_ids), replaces: line.replaces === undefined ? null : wikiId(line.replaces),
          createdAt: line.created_at_ms === undefined ? null : timestamp(line.created_at_ms),
          replacedAt: line.replaced_at_ms === undefined ? null : timestamp(line.replaced_at_ms) };
      }),
      doc: decodeDoc(page.doc),
    };
  });
}
/** Notes for the flow's stretches of work; older engines send none. */
export function decodeWikiNotes(raw: unknown): MemorySessionNote[] {
  const notes = object(raw).notes;
  if (notes === undefined) return [];
  if (!Array.isArray(notes) || notes.length > 400) throw new Error("memory_unavailable");
  return notes.map((item: unknown) => {
    const note = object(item);
    if (!Array.isArray(note.line_ids) || note.line_ids.length === 0 || note.line_ids.length > 400) throw new Error("memory_unavailable");
    const summary = docPoints(note.summary, 2);
    if (summary.length === 0) throw new Error("memory_unavailable");
    return { key: wikiId(note.key), lineIds: note.line_ids.map(wikiId), title: bounded(note.title, 60), summary,
      points: docPoints(note.points, 6), compiledAt: timestamp(note.compiled_at_ms) };
  });
}
/**
 * The "now" page: what is in progress, waited on and recently finished,
 * written from the newest memories, every sentence citing the lines it rests on.
 */
export type MemoryNow = {
  readonly doing: readonly MemoryDocPoint[]; readonly waiting: readonly MemoryDocPoint[]; readonly done: readonly MemoryDocPoint[];
  readonly lineIds: readonly string[]; readonly compiledAt: number;
};
/** Older engines and an empty memory send none. */
export function decodeWikiNow(raw: unknown): MemoryNow | null {
  const value = object(raw).now;
  if (value === undefined || value === null) return null;
  const page = object(value);
  if (!Array.isArray(page.line_ids) || page.line_ids.length > 60) throw new Error("memory_unavailable");
  const result = { doing: docPoints(page.doing, 5), waiting: docPoints(page.waiting, 4), done: docPoints(page.done, 4),
    lineIds: page.line_ids.map(wikiId), compiledAt: timestamp(page.compiled_at_ms) };
  if (result.doing.length + result.waiting.length + result.done.length === 0) throw new Error("memory_unavailable");
  return result;
}
/** The wiki as the Memory page reads it: its pages, the flow's notes and the "now" page. */
export function decodeWiki(raw: unknown): { readonly pages: MemoryWikiPage[]; readonly notes: MemorySessionNote[]; readonly now: MemoryNow | null } {
  return { pages: decodeWikiPages(raw), notes: decodeWikiNotes(raw), now: decodeWikiNow(raw) };
}
export function decodeWikiDeleted(raw: unknown): boolean {
  const deleted = object(raw).deleted;
  if (typeof deleted !== "boolean") throw new Error("memory_unavailable");
  return deleted;
}
