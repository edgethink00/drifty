/**
 * OpenRouter OAuth PKCE — one-click "connect your OpenRouter account" that mints
 * a durable provisioned key (sk-or-...) without pasting keys. Official flow:
 * https://openrouter.ai/docs/guides/overview/auth/oauth
 *
 * These are the pure/fetch pieces (verifier, challenge, auth url, exchange).
 * The loopback redirect capture is done natively (system browser + temporary
 * localhost listener); the captured `code` is fed to exchangeOpenRouterCodeForKey.
 */
const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
const OPENROUTER_KEYS_ENDPOINT = "https://openrouter.ai/api/v1/auth/keys";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier(fillRandom: (buffer: Uint8Array) => void = (buffer) => crypto.getRandomValues(buffer)): string {
  const bytes = new Uint8Array(32);
  fillRandom(bytes);
  return base64UrlEncode(bytes);
}

export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export function buildOpenRouterAuthUrl(options: { callbackUrl: string; codeChallenge: string }): string {
  const params = new URLSearchParams({
    callback_url: options.callbackUrl,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${OPENROUTER_AUTH_URL}?${params.toString()}`;
}

export async function exchangeOpenRouterCodeForKey(options: {
  code: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(OPENROUTER_KEYS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: options.code, code_verifier: options.codeVerifier, code_challenge_method: "S256" }),
  });
  if (!response.ok) throw new Error(`OpenRouter key exchange failed: HTTP ${response.status}`);
  const data = (await response.json()) as { key?: unknown };
  if (typeof data.key !== "string" || !data.key) throw new Error("OpenRouter key exchange returned no key");
  return data.key;
}

/** Full client-side PKCE handshake given a native loopback capture callback. */
export async function connectOpenRouterViaPkce(deps: {
  callbackUrl: string;
  openAuthUrl: (url: string) => Promise<void> | void;
  waitForCode: () => Promise<string>;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const verifier = generateCodeVerifier();
  const challenge = await codeChallengeS256(verifier);
  await deps.openAuthUrl(buildOpenRouterAuthUrl({ callbackUrl: deps.callbackUrl, codeChallenge: challenge }));
  const code = await deps.waitForCode();
  return exchangeOpenRouterCodeForKey({ code, codeVerifier: verifier, fetchImpl: deps.fetchImpl });
}
