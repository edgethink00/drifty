import { describe, expect, it, vi } from "vitest";
import {
  buildOpenRouterAuthUrl,
  codeChallengeS256,
  connectOpenRouterViaPkce,
  exchangeOpenRouterCodeForKey,
  generateCodeVerifier,
} from "./openRouterPkce";

describe("PKCE primitives", () => {
  it("generates a url-safe verifier", () => {
    const verifier = generateCodeVerifier((buffer) => buffer.fill(0));
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it("produces a stable, url-safe S256 challenge", async () => {
    const a = await codeChallengeS256("verifier-abc");
    const b = await codeChallengeS256("verifier-abc");
    const c = await codeChallengeS256("verifier-xyz");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("builds the auth url with S256 params", () => {
    const url = buildOpenRouterAuthUrl({ callbackUrl: "http://127.0.0.1:5599/callback", codeChallenge: "chal" });
    expect(url).toContain("https://openrouter.ai/auth?");
    expect(url).toContain("callback_url=http%3A%2F%2F127.0.0.1%3A5599%2Fcallback");
    expect(url).toContain("code_challenge=chal");
    expect(url).toContain("code_challenge_method=S256");
  });
});

describe("exchangeOpenRouterCodeForKey", () => {
  it("returns the provisioned key on success", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ key: "sk-or-v1-abc" }), { status: 200 }));
    const key = await exchangeOpenRouterCodeForKey({ code: "c", codeVerifier: "v", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(key).toBe("sk-or-v1-abc");
    const init = fetchImpl.mock.calls[0][1];
    expect(JSON.parse(init?.body as string)).toEqual({ code: "c", code_verifier: "v", code_challenge_method: "S256" });
  });

  it("throws on non-ok status", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 400 }));
    await expect(exchangeOpenRouterCodeForKey({ code: "c", codeVerifier: "v", fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/HTTP 400/);
  });

  it("throws when no key is returned", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    await expect(exchangeOpenRouterCodeForKey({ code: "c", codeVerifier: "v", fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/no key/);
  });
});

describe("connectOpenRouterViaPkce", () => {
  it("runs the full handshake and returns the key", async () => {
    const openAuthUrl = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ key: "sk-or-v1-final" }), { status: 200 }));
    const key = await connectOpenRouterViaPkce({
      callbackUrl: "http://127.0.0.1:5599/callback",
      openAuthUrl,
      waitForCode: async () => "captured-code",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(key).toBe("sk-or-v1-final");
    expect(openAuthUrl).toHaveBeenCalledWith(expect.stringContaining("https://openrouter.ai/auth?"));
  });
});
