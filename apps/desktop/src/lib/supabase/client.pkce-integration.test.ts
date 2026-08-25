// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

describe("desktop Google PKCE integration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    window.localStorage.clear();
  });

  it("accepts the 4096-character boundary and persists the exact session consumed by the real Supabase SDK", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const now = new Date().toISOString();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      user: {
        id: "integration-user",
        aud: "authenticated",
        role: "authenticated",
        email: "qa@example.com",
        app_metadata: { provider: "google", providers: ["google"] },
        user_metadata: {},
        identities: [],
        created_at: now,
        updated_at: now,
        is_anonymous: false,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const {
      exchangeGoogleOAuthCodeForSession,
      hasUsableGoogleOAuthVerifier,
      prepareGoogleOAuthAuthorization,
      supabase,
    } = await import("./client");
    const preparation = await prepareGoogleOAuthAuthorization({
      redirectTo: "https://drifty.so/auth/desktop-google-callback/",
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    });
    preparation.activateVerifier(Date.now() + 5 * 60 * 1000);
    const storedVerifier = JSON.parse(
      window.localStorage.getItem("drifty.desktop.auth-code-verifier")!,
    ) as string;

    const maximumLengthAuthCode = "x".repeat(4_096);
    const exchange = await exchangeGoogleOAuthCodeForSession(
      maximumLengthAuthCode,
      new AbortController().signal,
    );
    const tokenRequest = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/auth/v1/token?grant_type=pkce"));
    const requestBody = JSON.parse(String(tokenRequest?.[1]?.body)) as Record<string, string>;
    const sdkSession = await supabase!.auth.getSession();

    expect(exchange.error).toBeNull();
    expect(exchange.data.session?.user.id).toBe("integration-user");
    expect(sdkSession.data.session?.user.id).toBe("integration-user");
    expect(requestBody).toEqual({
      auth_code: maximumLengthAuthCode,
      code_verifier: storedVerifier,
    });
    expect(window.localStorage.getItem("drifty.desktop.auth-code-verifier")).toBeNull();
    expect(hasUsableGoogleOAuthVerifier()).toBe(false);
    expect(window.localStorage.getItem("drifty.desktop.auth-google-oauth-attempt")).toBeNull();
    supabase!.auth.stopAutoRefresh();
  });

  it("never persists a late aborted response or deletes a newer verifier", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    let resolveFetch: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);

    const {
      exchangeGoogleOAuthCodeForSession,
      hasUsableGoogleOAuthVerifier,
      prepareGoogleOAuthAuthorization,
      supabase,
    } = await import("./client");
    const first = await prepareGoogleOAuthAuthorization({
      redirectTo: "https://drifty.so/auth/desktop-google-callback/",
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    });
    first.activateVerifier(Date.now() + 5 * 60 * 1000);
    const firstVerifier = window.localStorage.getItem("drifty.desktop.auth-code-verifier");
    const controller = new AbortController();
    const pendingExchange = exchangeGoogleOAuthCodeForSession("stale-auth-code", controller.signal);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const second = await prepareGoogleOAuthAuthorization({
      redirectTo: "https://drifty.so/auth/desktop-google-callback/",
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    });
    second.activateVerifier(Date.now() + 5 * 60 * 1000);
    const secondVerifier = window.localStorage.getItem("drifty.desktop.auth-code-verifier");
    expect(secondVerifier).not.toBe(firstVerifier);

    controller.abort(new Error("cancelled by a newer attempt"));
    (resolveFetch as ((value: Response) => void) | null)?.(new Response(JSON.stringify({
      access_token: "stale-access-token",
      refresh_token: "stale-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      user: { id: "stale-user" },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(pendingExchange).rejects.toThrow("cancelled by a newer attempt");
    expect(window.localStorage.getItem("drifty.desktop.auth-code-verifier")).toBe(secondVerifier);
    expect(hasUsableGoogleOAuthVerifier()).toBe(true);
    expect(window.localStorage.getItem("drifty.desktop.auth")).toBeNull();
    supabase!.auth.stopAutoRefresh();
  });

  it("preserves the active verifier when a mismatched or stale callback code is rejected", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "invalid_grant",
      error_description: "bad code verifier",
    }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })));

    const {
      exchangeGoogleOAuthCodeForSession,
      hasUsableGoogleOAuthVerifier,
      prepareGoogleOAuthAuthorization,
      supabase,
    } = await import("./client");
    const preparation = await prepareGoogleOAuthAuthorization({
      redirectTo: "https://drifty.so/auth/desktop-google-callback/",
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    });
    preparation.activateVerifier(Date.now() + 5 * 60 * 1000);
    const activeVerifier = window.localStorage.getItem("drifty.desktop.auth-code-verifier");

    const result = await exchangeGoogleOAuthCodeForSession(
      "stale-auth-code",
      new AbortController().signal,
    );

    expect(result.data.session).toBeNull();
    expect(result.error?.message).toBe("Google sign-in could not be completed. Try again.");
    expect(window.localStorage.getItem("drifty.desktop.auth-code-verifier")).toBe(activeVerifier);
    expect(hasUsableGoogleOAuthVerifier()).toBe(true);
    expect(window.localStorage.getItem("drifty.desktop.auth")).toBeNull();
    supabase!.auth.stopAutoRefresh();
  });

  it.each([
    ["empty", ""],
    ["oversized", "x".repeat(4_097)],
    ["non-string", null],
  ])("rejects a %s authorization code before fetch without deleting the active verifier", async (_name, value) => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const {
      exchangeGoogleOAuthCodeForSession,
      hasUsableGoogleOAuthVerifier,
      prepareGoogleOAuthAuthorization,
      supabase,
    } = await import("./client");
    const preparation = await prepareGoogleOAuthAuthorization({
      redirectTo: "https://drifty.so/auth/desktop-google-callback/",
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    });
    preparation.activateVerifier(Date.now() + 5 * 60 * 1000);
    const activeVerifier = window.localStorage.getItem("drifty.desktop.auth-code-verifier");

    const result = await exchangeGoogleOAuthCodeForSession(
      value as string,
      new AbortController().signal,
    );

    expect(result.data.session).toBeNull();
    expect(result.error?.message).toBe("Google sign-in could not be completed. Try again.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("drifty.desktop.auth-code-verifier")).toBe(activeVerifier);
    expect(hasUsableGoogleOAuthVerifier()).toBe(true);
    supabase!.auth.stopAutoRefresh();
  });
});
