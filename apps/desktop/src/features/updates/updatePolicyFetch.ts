import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../lib/api/shareCardClient";

type UpdatePolicyFetch = (input: string, init?: RequestInit) => Promise<Response>;
type InvokeCommand = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

const POLICY_URL_PATTERN = /^https:\/\/github\.com\/edgethink00\/(drifty|drifty_releases)\/releases\/download\/([^/?#]+)\/update-policy\.json$/;

function abortError(): Error {
  return new DOMException("The update policy request was aborted.", "AbortError");
}

function abortable<T>(request: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    request.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

/**
 * The production WebView CSP excludes GitHub, so a renderer `fetch` of
 * `update-policy.json` is always refused and every release silently falls back
 * to the manual 72-hour policy (#653). This adapter keeps `fetchUpdatePolicy`'s
 * Response contract while the native command performs the request.
 */
export function createNativeUpdatePolicyFetch(invokeCommand: InvokeCommand = invoke): UpdatePolicyFetch {
  return async (input, init) => {
    const [, repository, encodedTag] = POLICY_URL_PATTERN.exec(input) ?? [];
    if (!repository || !encodedTag) throw new TypeError("Unsupported update policy URL.");
    const metadata = await abortable(
      invokeCommand<unknown>("update_policy_fetch", { tag: decodeURIComponent(encodedTag), repository }),
      init?.signal,
    );
    if (metadata === null || metadata === undefined) return new Response(null, { status: 404 });
    return new Response(JSON.stringify(metadata), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

/** Packaged builds read policy natively; browser previews keep the plain fetch. */
export function resolveUpdatePolicyFetch(): UpdatePolicyFetch {
  if (isTauriRuntime()) return createNativeUpdatePolicyFetch();
  return (input, init) => globalThis.fetch(input, init);
}
