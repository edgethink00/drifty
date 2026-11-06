// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  session: { access_token: "session-jwt", user: { is_anonymous: false } } as { access_token: string; user: { is_anonymous?: boolean } } | null,
  listener: null as ((event: string, session: unknown) => void) | null,
}));
vi.mock("../../lib/supabase/client", () => ({
  isSupabaseEnabled: () => true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: auth.session } }),
      onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
        auth.listener = listener;
        return { data: { subscription: { unsubscribe: () => { auth.listener = null; } } } };
      },
    },
  },
}));

import { memoryCloudUrl, useMemoryCloudSession } from "./memoryCloudSession";

const PROJECT = "https://abcdefghijklmnopqrst.supabase.co";
afterEach(() => { cleanup(); vi.unstubAllEnvs(); auth.session = { access_token: "session-jwt", user: { is_anonymous: false } }; });

describe("Drifty Cloud session for automatic memory", () => {
  it("points only a hosted project at its memory function", () => {
    expect(memoryCloudUrl(PROJECT)).toBe(PROJECT + "/functions/v1/memory-cloud");
    for (const value of [undefined, "", "http://abcdefghijklmnopqrst.supabase.co", "https://example.com", "https://abc.supabase.co"]) {
      expect(memoryCloudUrl(value)).toBeNull();
    }
  });

  it("hands over the session with a trial or Pro, each refresh, and clears it otherwise", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", PROJECT);
    const send = vi.fn(async (_session: unknown) => {});
    const { rerender, unmount } = renderHook(({ plan }) => useMemoryCloudSession(true, plan, send), { initialProps: { plan: true } });
    await waitFor(() => expect(send).toHaveBeenLastCalledWith({ url: PROJECT + "/functions/v1/memory-cloud", accessToken: "session-jwt" }));
    auth.listener?.("TOKEN_REFRESHED", { access_token: "refreshed-jwt", user: { is_anonymous: false } });
    expect(send).toHaveBeenLastCalledWith({ url: PROJECT + "/functions/v1/memory-cloud", accessToken: "refreshed-jwt" });
    auth.listener?.("SIGNED_OUT", null);
    expect(send).toHaveBeenLastCalledWith(null);
    rerender({ plan: false });
    await waitFor(() => expect(send).toHaveBeenLastCalledWith(null));
    expect(send.mock.calls.filter(([session]) => session !== null)).toHaveLength(2);
    unmount();
    expect(send).toHaveBeenLastCalledWith(null);
  });

  it("never hands over a guest session", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", PROJECT);
    auth.session = { access_token: "guest-jwt", user: { is_anonymous: true } };
    const send = vi.fn(async (_session: unknown) => {});
    renderHook(() => useMemoryCloudSession(true, true, send));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls.every(([session]) => session === null)).toBe(true);
  });
});
