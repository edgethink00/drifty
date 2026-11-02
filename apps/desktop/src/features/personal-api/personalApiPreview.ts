import { shouldUsePreviewData } from "../../lib/api/previewData";
import type { BillingEntitlement } from "../billing/billingService";
import type { PersonalApiSettingsBlockProps } from "./PersonalApiSettingsBlock";
import type { PersonalApiKey, PersonalApiKeysClient } from "./personalApiKeysClient";

/**
 * Browser preview stand-in for the Drifty API block. The Tauri app never uses
 * it: it runs only where shouldUsePreviewData() already swaps in fixture data,
 * so Settings › Agents, CLI & API can be reviewed in a plain browser with
 * ?driftyPreview=1&review=agents-cli&driftyApiPreview=<scenario>. Keys live in
 * memory, with a short delay so busy states stay visible. "empty" is a Pro
 * account whose computers all have sync off; "others" has sync off here while
 * another computer syncs; "device-limit" is a fourth computer while others sync.
 */
export const PERSONAL_API_PREVIEW_PARAM = "driftyApiPreview";
export type PersonalApiPreviewScenario = "signed-out" | "plan" | "empty" | "others" | "keys" | "device-limit";
const PREVIEW_SCENARIOS: readonly PersonalApiPreviewScenario[] = ["signed-out", "plan", "empty", "others", "keys", "device-limit"];

const PREVIEW_ACCOUNT = "00000000-0000-4000-8000-00000000a11c";
// Shaped like a real key so the dialog wraps as it will; it opens nothing.
const PREVIEW_TOKEN = "drifty_sk_k3T9vQm2Xr7LpW4zN8bYc6Hd1Fs5Jg0RtE2Ua4xQ";

const pro: BillingEntitlement = { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: "2099-01-01T00:00:00.000Z" };
// A Pro account seen from a fourth computer: the plan is active, but this
// computer is past the three-computer limit, so the app reads it as locked.
const deviceLimited: BillingEntitlement = {
  ...pro,
  status: "locked",
  canUseApp: false,
  lockedReason: "device_limit_reached",
  deviceAccess: {
    allowed: false,
    reason: "device_limit_reached",
    message: null,
    activeDeviceCount: 3,
    maxActiveDevices: 3,
    activeWindowDays: 30,
    deviceId: null,
  },
};
const ended: BillingEntitlement = {
  plan: "individual",
  status: "locked",
  canUseApp: false,
  trialEndsAt: "2026-10-01T00:00:00.000Z",
  currentPeriodEnd: null,
  lockedReason: "trial_expired",
  trialActivation: { state: "unavailable", startedAt: "2026-09-24T00:00:00.000Z", endsAt: "2026-10-01T00:00:00.000Z" },
};

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function previewKeys(scenario: PersonalApiPreviewScenario): PersonalApiKey[] {
  if (scenario === "plan") {
    return [{ id: "preview-1", name: "Old blog widget", hint: "Qk7d", scopes: ["summary:read"], createdAt: daysFromNow(-80), expiresAt: daysFromNow(10), lastUsedAt: daysFromNow(-26) }];
  }
  if (scenario !== "keys" && scenario !== "device-limit") return [];
  return [
    { id: "preview-1", name: "Personal website", hint: "Ab1z", scopes: ["summary:read"], createdAt: daysFromNow(-12), expiresAt: daysFromNow(78), lastUsedAt: daysFromNow(0) },
    { id: "preview-2", name: "Weekly report script", hint: "Zz94", scopes: ["activity:read", "summary:read"], createdAt: daysFromNow(-40), expiresAt: null, lastUsedAt: daysFromNow(-3) },
    { id: "preview-3", name: "Old test", hint: "Mm20", scopes: ["summary:read"], createdAt: daysFromNow(-100), expiresAt: daysFromNow(-10), lastUsedAt: null },
  ];
}

export function createPersonalApiPreviewClient(scenario: PersonalApiPreviewScenario, delayMs = 600): PersonalApiKeysClient {
  let keys = previewKeys(scenario);
  let created = 0;
  const wait = () => new Promise<void>((resolve) => { globalThis.setTimeout(resolve, delayMs); });
  return {
    async list() {
      await wait();
      return keys;
    },
    async create(_accountId, input) {
      await wait();
      created += 1;
      const key: PersonalApiKey = {
        id: `preview-new-${created}`,
        name: input.name,
        hint: PREVIEW_TOKEN.slice(-4),
        scopes: [...input.scopes].sort(),
        createdAt: new Date().toISOString(),
        expiresAt: input.expiresInDays === null ? null : daysFromNow(input.expiresInDays),
        lastUsedAt: null,
      };
      keys = [key, ...keys];
      return { key, token: PREVIEW_TOKEN };
    },
    async remove(_accountId, keyId) {
      await wait();
      keys = keys.filter((key) => key.id !== keyId);
    },
  };
}

export function resolvePersonalApiPreview(search: string): Omit<PersonalApiSettingsBlockProps, "onOpenSyncSettings"> | null {
  if (!shouldUsePreviewData()) return null;
  const requested = PREVIEW_SCENARIOS.find((scenario) => scenario === new URLSearchParams(search).get(PERSONAL_API_PREVIEW_PARAM));
  if (!requested) return null;
  const noop = () => undefined;
  const syncOffHere = requested === "empty" || requested === "others" || requested === "device-limit";
  return {
    accountId: requested === "signed-out" ? null : PREVIEW_ACCOUNT,
    billingEntitlement: requested === "signed-out" ? null : requested === "plan" ? ended : requested === "device-limit" ? deviceLimited : pro,
    deviceSyncEnabled: !syncOffHere,
    deviceSyncCanEnable: requested === "empty" || requested === "others",
    // Slower than the key list, as a network read can be, so the checking note stays visible.
    readAccountSyncing: () => new Promise<boolean>((resolve) => {
      globalThis.setTimeout(() => resolve(requested !== "empty"), 900);
    }),
    onSignIn: noop,
    onUpgradeToPro: noop,
    client: createPersonalApiPreviewClient(requested),
  };
}
