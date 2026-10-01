import { describe, expect, it } from "vitest";
import {
  beginPetModeNativeSyncDiagnostic,
  classifyPetModeNativeSyncError,
  formatPetModeNativeSyncDiagnostic,
  settlePetModeNativeSyncDiagnostic,
  type PetModeNativeSyncDiagnostic,
} from "./petModeNativeSyncDiagnostics";

const request = (token: number): PetModeNativeSyncDiagnostic => ({
  token, enabled: true, width: 180, height: 124, forceReveal: true,
  attempt: 1, requestedAtMs: 1_000, outcome: "pending",
});

describe("pet native sync diagnostics", () => {
  it("keeps only this renderer's two latest requests and refuses late responses to a cancelled request", () => {
    let records = beginPetModeNativeSyncDiagnostic([], request(1));
    records = settlePetModeNativeSyncDiagnostic(records, 1, "cancelled", 1_500);
    records = beginPetModeNativeSyncDiagnostic(records, request(2));
    const current = records;
    expect(settlePetModeNativeSyncDiagnostic(records, 1, "resolved", 2_000)).toBe(current);
    expect(settlePetModeNativeSyncDiagnostic(records, 1, "rejected", 2_000, "window_unavailable")).toBe(current);
    records = beginPetModeNativeSyncDiagnostic(records, request(3));
    expect(records.map((record) => record.token)).toEqual([2, 3]);
  });

  it("omits arbitrary native error details and labels a resolved invoke without claiming applied presentation", () => {
    const rawError = new Error("private-account-and-path-sentinel");
    const category = classifyPetModeNativeSyncError(rawError);
    expect(category).toBe("native_error");
    const records = settlePetModeNativeSyncDiagnostic([request(1)], 1, "rejected", 2_000, category);
    const line = formatPetModeNativeSyncDiagnostic(records[0]!);
    expect(line).toContain("rejected native_error");
    expect(line).not.toContain(rawError.message);
    const resolved = settlePetModeNativeSyncDiagnostic([request(1)], 1, "resolved", 2_000);
    expect(formatPetModeNativeSyncDiagnostic(resolved[0]!)).toContain("resolved (invoke only)");
    expect(formatPetModeNativeSyncDiagnostic(resolved[0]!)).not.toContain("applied");
  });
});
