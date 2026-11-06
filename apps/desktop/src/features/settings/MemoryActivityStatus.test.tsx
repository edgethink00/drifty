// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { decodeMemoryStatus } from "../screen-context/memoryWire";
import { MemoryActivityStatus } from "./MemoryActivityStatus";

const now = 1800000000000;
const diagnostics = {
  phase: "limited", as_of_ms: now, last_source_at_ms: now - 10000, last_extracted_at_ms: null, next_attempt_at_ms: now + 3600000,
  facts: 0, running: 0, waiting: 2, exhausted: 1, errors: 3,
  writes_hour: 12, writes_day: 21, queries_hour: 4, writes_hour_limit: 12, writes_day_limit: 60, queries_hour_limit: 30,
  hour_resets_at_ms: now + 3600000, day_resets_at_ms: now + 86400000,
};
function status(overrides: Record<string, unknown> = {}) {
  return decodeMemoryStatus({ supported: true, preferences: { enabled: true, retentionHours: 24 }, status: { active: true, sources: 3, remembered_groups: 0, diagnostics: { ...diagnostics, ...overrides } } });
}
afterEach(cleanup);
it("separates observed screens, successful extraction and reserved requests", () => {
  render(<MemoryActivityStatus status={status()} capture={null} ko={false} now={now} />);
  expect(screen.getByRole("status").textContent).toContain("limit to reset");
  expect(screen.getByText(/Last extraction completed/).textContent).toContain("Last extraction completed: Not yet");
  expect(screen.getByText(/Request reservations/).textContent).toContain("12/12");
  expect(screen.getByText(/3 sources/).textContent).toContain("0 memories");
});
it("never presents old or missing worker data as healthy", () => {
  const view = render(<MemoryActivityStatus status={status({ phase: "ready", as_of_ms: now - 16000 })} capture={null} ko={false} now={now} />);
  expect(screen.getByRole("status").textContent).toContain("Checking the latest");
  expect(screen.getByText(/Processing counts are from/)).toBeTruthy();
  view.rerender(<MemoryActivityStatus status={{ ...status(), diagnostics: null }} capture={null} ko={false} now={now} />);
  expect(screen.queryByText(/Request reservations/)).toBeNull();
});
it("treats a skipped page or excluded app as waiting, not as a failed capture", () => {
  const capture = (lastFailure: string) => ({ paused: false, globalPaused: false, preferences: { enabled: true }, lastFailure, lastAcceptedAtMs: now - 60000 }) as unknown as Parameters<typeof MemoryActivityStatus>[0]["capture"];
  const view = render(<MemoryActivityStatus status={status({ phase: "ready" })} capture={capture("excluded")} ko={false} now={now} />);
  expect(screen.queryByText(/did not complete/)).toBeNull();
  view.rerender(<MemoryActivityStatus status={status({ phase: "ready" })} capture={capture("permission")} ko={false} now={now} />);
  expect(screen.getByText(/did not complete/)).toBeTruthy();
});
it("strictly rejects malformed diagnostics and never displays raw native errors", () => {
  for (const patch of [{ writes_hour: -1 }, { phase: "ALL_GOOD" }, { last_source_at_ms: Number.NaN }, { facts: undefined }, { as_of_ms: 9e15 }]) {
    expect(() => status(patch)).toThrow("memory_unavailable");
  }
  const safe = decodeMemoryStatus({ supported: true, preferences: { enabled: true, retentionHours: 24 }, status: { error: "PRIVATE_TEXT_OR_KEY" } });
  render(<MemoryActivityStatus status={safe} capture={null} ko={false} now={now} />);
  expect(screen.getByRole("status").textContent).toContain("Memory is unavailable");
  expect(document.body.textContent).not.toContain("PRIVATE_TEXT_OR_KEY");
});
