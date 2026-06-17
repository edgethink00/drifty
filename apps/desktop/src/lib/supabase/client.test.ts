import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("uses manual PKCE OAuth handling for desktop browser callbacks", async () => {
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
          flowType: "pkce",
          storageKey: "drifty.desktop.auth",
          lock: expect.any(Function),
        },
      },
    );
  });

  it("serializes desktop auth operations without browser Web Locks", async () => {
    const { desktopAuthLock } = await import("./client");
    const events: string[] = [];
    const firstGate = createGate();

    const firstLock = desktopAuthLock("lock:drifty.desktop.auth", 5000, async () => {
      events.push("first:start");
      await firstGate.promise;
      events.push("first:end");
      return "first";
    });
    const secondLock = desktopAuthLock("lock:drifty.desktop.auth", 5000, async () => {
      events.push("second:start");
      return "second";
    });

    await flushAuthLockQueue();
    expect(events).toEqual(["first:start"]);

    firstGate.release();
    await expect(Promise.all([firstLock, secondLock])).resolves.toEqual(["first", "second"]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });


  it("defaults to optional auth mode with anonymous auth allowed", async () => {
    const { authModePolicy, hasBlockingAuthConfigurationError } = await import("./client");

    expect(authModePolicy.mode).toBe("optional");
    expect(authModePolicy.isAuthRequired).toBe(false);
    expect(authModePolicy.allowsAnonymousAuth).toBe(true);
    expect(hasBlockingAuthConfigurationError()).toBe(false);
  });

  it("supports required auth mode and reports missing Supabase config as blocking", async () => {
    vi.stubEnv("VITE_DRIFTY_AUTH_MODE", "required");
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


  it("uses VITE_DRIFTY_AUTH_MODE for required auth mode", async () => {
    vi.stubEnv("VITE_DRIFTY_AUTH_MODE", "required");

    const { authModePolicy } = await import("./client");

    expect(authModePolicy.mode).toBe("required");
    expect(authModePolicy.isAuthRequired).toBe(true);
    expect(authModePolicy.allowsAnonymousAuth).toBe(false);
  });

  it("falls back to optional auth mode for unsupported values", async () => {
    vi.stubEnv("VITE_DRIFTY_AUTH_MODE", "strict");

    const { authModePolicy } = await import("./client");

    expect(authModePolicy.mode).toBe("optional");
    expect(authModePolicy.allowsAnonymousAuth).toBe(true);
  });
});

function createGate() {
  let resolveGate: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });

  return {
    promise,
    release: () => {
      if (!resolveGate) throw new Error("Gate was not initialized.");
      resolveGate();
    },
  };
}

async function flushAuthLockQueue(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
