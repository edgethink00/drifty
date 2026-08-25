// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.hoisted(() => vi.fn());

vi.mock("@supabase/supabase-js", () => ({
  createClient,
}));

describe("Supabase client", () => {
  beforeEach(() => {
    createClient.mockImplementation(() => ({ auth: {} }));
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    createClient.mockReset();
    window.localStorage.clear();
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

  it("isolates pending Google PKCE verifiers until the current attempt explicitly activates", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");

    const { prepareGoogleOAuthAuthorization } = await import("./client");
    const options = {
      redirectTo: "https://drifty.so/auth/desktop-google-callback/",
      skipBrowserRedirect: true as const,
      queryParams: { prompt: "select_account" },
    };
    const [firstPreparation, secondPreparation] = await Promise.all([
      prepareGoogleOAuthAuthorization(options),
      prepareGoogleOAuthAuthorization(options),
    ]);

    expect(window.localStorage.getItem("drifty.desktop.auth-code-verifier")).toBeNull();
    const expiresAt = Date.now() + 5 * 60 * 1000;
    secondPreparation.activateVerifier(expiresAt);
    const activeVerifier = window.localStorage.getItem("drifty.desktop.auth-code-verifier");
    const firstUrl = new URL(firstPreparation.data.url!);
    const secondUrl = new URL(secondPreparation.data.url!);

    expect(activeVerifier).toMatch(/^"[A-Za-z0-9_-]{43,128}"$/);
    expect(firstUrl.origin).toBe("https://project.supabase.co");
    expect(secondUrl.pathname).toBe("/auth/v1/authorize");
    expect(secondUrl.searchParams.get("provider")).toBe("google");
    expect(secondUrl.searchParams.get("redirect_to")).toBe(options.redirectTo);
    expect(secondUrl.searchParams.get("code_challenge_method")).toBe("s256");
    expect(secondUrl.searchParams.get("prompt")).toBe("select_account");
    expect(firstUrl.searchParams.get("code_challenge"))
      .not.toBe(secondUrl.searchParams.get("code_challenge"));
    expect(JSON.parse(window.localStorage.getItem("drifty.desktop.auth-google-oauth-attempt")!)).toEqual({
      version: 1,
      expiresAt,
    });
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("rejects expired or malformed persisted verifiers and replaces stale state on fresh activation", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const now = Date.now();
    window.localStorage.setItem("drifty.desktop.auth-code-verifier", JSON.stringify("stale-verifier-value-that-is-long-enough-123456789"));
    window.localStorage.setItem("drifty.desktop.auth-google-oauth-attempt", JSON.stringify({
      version: 1,
      expiresAt: now,
    }));

    const {
      clearGoogleOAuthVerifier,
      hasUsableGoogleOAuthVerifier,
      prepareGoogleOAuthAuthorization,
    } = await import("./client");

    expect(hasUsableGoogleOAuthVerifier(now)).toBe(false);
    expect(window.localStorage.getItem("drifty.desktop.auth-code-verifier")).toBeNull();
    expect(window.localStorage.getItem("drifty.desktop.auth-google-oauth-attempt")).toBeNull();

    const preparation = await prepareGoogleOAuthAuthorization({
      redirectTo: "https://drifty.so/auth/desktop-google-callback/",
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    });
    preparation.activateVerifier(now + 5 * 60 * 1000);

    expect(hasUsableGoogleOAuthVerifier(now)).toBe(true);
    expect(window.localStorage.getItem("drifty.desktop.auth-code-verifier"))
      .not.toContain("stale-verifier-value");
    expect(clearGoogleOAuthVerifier()).toBe(true);
    expect(hasUsableGoogleOAuthVerifier(now)).toBe(false);
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
