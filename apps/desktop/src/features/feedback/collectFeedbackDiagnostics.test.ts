import { afterEach, describe, expect, it, vi } from "vitest";
import { collectFeedbackDiagnostics, feedbackProbe, FEEDBACK_PROBE_TIMEOUT_MS, type FeedbackDiagnosticsAppState } from "./collectFeedbackDiagnostics";
import { getNativeFeedbackDiagnostics } from "../../lib/api/feedbackDiagnosticsClient";
vi.mock("../../lib/api/feedbackDiagnosticsClient", () => ({ getNativeFeedbackDiagnostics: vi.fn() }));
vi.mock("../../lib/api/startupSettingsClient", () => ({ startupSettingsClient: { isAvailable: () => false } }));
vi.mock("../companion/interventionLedger", () => ({ buildInterventionLedgerDebugInput: () => ({ last7Days: {}, last30Days: {} }) }));
vi.mock("./feedbackDiagnostics", () => ({ buildFeedbackDiagnostics: (value: unknown) => value }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
describe("bounded independent feedback collection", () => {
  it("retains app state and other diagnostics when one native request never finishes", async () => {
    vi.useFakeTimers();
    vi.mocked(getNativeFeedbackDiagnostics).mockImplementation(() => new Promise(() => {}));
    const collect = collectFeedbackDiagnostics({ app: { version: "1.20.0" }, aiSetup: null } as FeedbackDiagnosticsAppState);
    await vi.advanceTimersByTimeAsync(FEEDBACK_PROBE_TIMEOUT_MS);
    expect(await collect).toMatchObject({ app: { version: "1.20.0" }, native: null,
      collection: { native: "timeout", installLocation: "unsupported", screen: "unsupported", memory: "unsupported" },
      recentEvents: [], operations: [] });
  });
  it("isolates synchronous throws, rejected reads, unavailable data and success", async () => {
    expect(await feedbackProbe(() => { throw new Error("private path"); })).toEqual({ status: "failed", value: null });
    expect(await feedbackProbe(async () => { throw new Error("private"); })).toEqual({ status: "failed", value: null });
    expect(await feedbackProbe(async () => null)).toEqual({ status: "unavailable", value: null });
    expect(await feedbackProbe(async () => 42)).toEqual({ status: "collected", value: 42 });
  });
});

