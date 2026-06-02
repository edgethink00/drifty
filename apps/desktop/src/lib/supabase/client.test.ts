import { afterEach, describe, expect, it, vi } from "vitest";

function stubWindowLocalStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    },
  });
  return values;
}

const createClient = vi.hoisted(() => vi.fn(() => ({ auth: {} })));

vi.mock("@supabase/supabase-js", () => ({
  createClient,
}));

describe("Supabase client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    createClient.mockClear();
  });

  it("uses manual implicit OAuth handling for desktop browser callbacks", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");

    await import("./client");

    expect(createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "anon-key",
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          flowType: "implicit",
          storageKey: "drifty.desktop.auth",
        },
      },
    );
  });

  it("uses the Drifty desktop auth storage key while migrating away from the old key", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const storage = stubWindowLocalStorage({ "dtime.desktop.auth": "legacy-session" });

    await import("./client");

    expect(storage.get("drifty.desktop.auth")).toBe("legacy-session");
    expect(createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "anon-key",
      expect.objectContaining({
        auth: expect.objectContaining({
          storageKey: "drifty.desktop.auth",
        }),
      }),
    );
  });

  it("defaults to optional auth mode with anonymous auth allowed", async () => {
    const { authModePolicy, hasBlockingAuthConfigurationError } = await import("./client");

    expect(authModePolicy.mode).toBe("optional");
    expect(authModePolicy.isAuthRequired).toBe(false);
    expect(authModePolicy.allowsAnonymousAuth).toBe(true);
    expect(hasBlockingAuthConfigurationError()).toBe(false);
  });

  it("supports required auth mode and reports missing Supabase config as blocking", async () => {
    vi.stubEnv("VITE_DTIME_AUTH_MODE", "required");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    const { authModePolicy, supabase, hasBlockingAuthConfigurationError } = await import("./client");

    expect(authModePolicy.mode).toBe("required");
    expect(authModePolicy.isAuthRequired).toBe(true);
    expect(authModePolicy.allowsAnonymousAuth).toBe(false);
    expect(supabase).toBeNull();
    expect(hasBlockingAuthConfigurationError()).toBe(true);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("prefers VITE_DRIFTY_AUTH_MODE over the legacy dtime auth mode", async () => {
    vi.stubEnv("VITE_DRIFTY_AUTH_MODE", "required");
    vi.stubEnv("VITE_DTIME_AUTH_MODE", "optional");

    const { authModePolicy } = await import("./client");

    expect(authModePolicy.mode).toBe("required");
    expect(authModePolicy.isAuthRequired).toBe(true);
    expect(authModePolicy.allowsAnonymousAuth).toBe(false);
  });

  it("uses VITE_DTIME_AUTH_MODE as a transition fallback", async () => {
    vi.stubEnv("VITE_DTIME_AUTH_MODE", "required");

    const { authModePolicy } = await import("./client");

    expect(authModePolicy.mode).toBe("required");
    expect(authModePolicy.isAuthRequired).toBe(true);
    expect(authModePolicy.allowsAnonymousAuth).toBe(false);
  });

  it("falls back to optional auth mode for unsupported values", async () => {
    vi.stubEnv("VITE_DTIME_AUTH_MODE", "strict");

    const { authModePolicy } = await import("./client");

    expect(authModePolicy.mode).toBe("optional");
    expect(authModePolicy.allowsAnonymousAuth).toBe(true);
  });
});
