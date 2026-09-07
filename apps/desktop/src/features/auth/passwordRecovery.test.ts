// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Session } from "@supabase/supabase-js";
import {
  PASSWORD_RECOVERY_TTL_MS,
  createPendingPasswordRecovery,
  doesRecoverySessionMatchRequest,
  hasPendingPasswordRecoveryMarker,
  markPasswordRecoveryVerified,
  readPendingPasswordRecovery,
  writePendingPasswordRecovery,
} from "./passwordRecovery";

function recoverySession(email: string, id = "user-1"): Session {
  return {
    user: { id, email },
  } as Session;
}

afterEach(() => window.localStorage.clear());

describe("passwordRecovery metadata", () => {
  it("expires an unverified request after the callback window", () => {
    const now = 1_000;
    writePendingPasswordRecovery(createPendingPasswordRecovery("Person@Example.com", now));

    expect(hasPendingPasswordRecoveryMarker()).toBe(true);
    expect(readPendingPasswordRecovery(now + PASSWORD_RECOVERY_TTL_MS + 1)).toBeNull();
    expect(hasPendingPasswordRecoveryMarker()).toBe(false);
  });

  it("keeps a verified recovery gate across cold starts until update or cancel", () => {
    const now = 1_000;
    const session = recoverySession("person@example.com");
    const pending = createPendingPasswordRecovery("person@example.com", now);
    writePendingPasswordRecovery(markPasswordRecoveryVerified(pending, session));

    const restored = readPendingPasswordRecovery(now + PASSWORD_RECOVERY_TTL_MS * 10);
    expect(restored?.phase).toBe("verified");
    expect(restored && doesRecoverySessionMatchRequest(restored, session)).toBe(true);
  });

  it("binds a verified recovery gate to both email and user id", () => {
    const pending = createPendingPasswordRecovery("person@example.com", 1_000);
    const verified = markPasswordRecoveryVerified(pending, recoverySession("person@example.com", "user-1"));

    expect(doesRecoverySessionMatchRequest(verified, recoverySession("person@example.com", "user-1"))).toBe(true);
    expect(doesRecoverySessionMatchRequest(verified, recoverySession("person@example.com", "user-2"))).toBe(false);
    expect(doesRecoverySessionMatchRequest(verified, recoverySession("other@example.com", "user-1"))).toBe(false);
  });
});
