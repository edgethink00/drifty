import type { AppIconVariantId } from "../../lib/api/appIconClient";
import { BALANCED_PRESETS, normalizeHex } from "../../lib/colorPalette";
import { canStartCloudTrial, canStartIndividualCheckout } from "../billing/billingEligibility";
import type { BillingEntitlement } from "../billing/billingService";
import {
  isPetModeCoat,
  PET_MODE_COAT_PREVIEW_STORAGE_KEY,
  resolveInitialPetModeCoat,
  type PetModeCoat,
} from "../pet-mode/petModeData";

/**
 * Pro looks: every Dock icon except Classic and Midnight (so Plum, Flow, Retro
 * and the cats), all pet skins except Ivory and Grey, and every accent color except Moss
 * and Charcoal (custom colors included) are Pro. Classic, Midnight, the Ivory
 * and Grey coats, Moss and Charcoal stay free for everyone. A 7-day trial, an
 * individual plan and an organization seat all open every look.
 */
export const FREE_APP_ICONS: ReadonlySet<AppIconVariantId> = new Set(["classic", "midnight"]);
export const FREE_PET_COATS: ReadonlySet<PetModeCoat> = new Set(["ivory", "grey"]);
/** What a look falls back to once Pro ends. */
export const FREE_FALLBACK_APP_ICON: AppIconVariantId = "classic";
export const FREE_FALLBACK_PET_COAT: PetModeCoat = "ivory";

/** The built-in accent; an unset accent is Moss, and Pro accents fall back to it. */
export const DEFAULT_ACCENT = "#5f7f31";
const CHARCOAL_ACCENT = "#4d4b45";
export const FREE_ACCENTS: ReadonlySet<string> = new Set([DEFAULT_ACCENT, CHARCOAL_ACCENT]);
/** The accent look a locked "More colors" opens: no color is tried on. */
export const CUSTOM_ACCENT = "custom";
/**
 * The accent row: Moss and Charcoal first, then the shared palette in order
 * without Fern and Coral. Fern sits next to Moss and is the Focus default;
 * Coral sits between Rose and Rust and is the Entertainment default. Both stay
 * in the category palette.
 */
const ACCENT_ROW_OMITTED: ReadonlySet<string> = new Set(["fern", "coral"]);
export const ACCENT_SWATCHES: readonly { readonly id: string; readonly color: string }[] = [
  ...[DEFAULT_ACCENT, CHARCOAL_ACCENT].flatMap((color) => BALANCED_PRESETS.filter((preset) => preset.color === color)),
  ...BALANCED_PRESETS.filter((preset) => !FREE_ACCENTS.has(preset.color) && !ACCENT_ROW_OMITTED.has(preset.id)),
];

/** The saved accent as an accent look id: a lowercase hex, Moss when unset. */
export function accentLookId(saved: string | undefined | null): string {
  return saved ? normalizeHex(saved) : DEFAULT_ACCENT;
}

export type ProLook =
  | { readonly kind: "icon"; readonly id: AppIconVariantId }
  | { readonly kind: "coat"; readonly id: PetModeCoat }
  /** A lowercase hex, or CUSTOM_ACCENT for the custom color picker. */
  | { readonly kind: "accent"; readonly id: string };

export function isProLook(look: ProLook): boolean {
  switch (look.kind) {
    case "icon": return !FREE_APP_ICONS.has(look.id);
    case "coat": return !FREE_PET_COATS.has(look.id);
    case "accent": return !FREE_ACCENTS.has(look.id);
  }
}

export function sameLook(a: ProLook | null, b: ProLook | null): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.id === b.id;
}

/**
 * Where the person stands, as far as Pro looks go. Only a known answer locks
 * or reverts anything: while the account or plan is still loading (or failed
 * to load) the state is "unknown", which keeps the current look and shows no
 * lock badges, so a Pro member never sees locks flash at launch.
 */
export type ProLooksAccess =
  | { readonly state: "open"; readonly trialEndsAt: string | null; readonly trialing: boolean }
  | { readonly state: "guest" }
  | { readonly state: "trial-available" }
  | { readonly state: "upgrade" }
  | { readonly state: "unavailable" }
  | { readonly state: "unknown" };

export function resolveProLooksAccess(input: {
  readonly accountsConfigured: boolean;
  readonly authStatus: "loading" | "authenticated" | "unauthenticated" | string;
  readonly signedIn: boolean;
  readonly entitlement: BillingEntitlement | null;
  readonly entitlementLoading: boolean;
  readonly entitlementError: string | null;
}): ProLooksAccess {
  if (!input.accountsConfigured) return { state: "guest" };
  if (input.authStatus !== "authenticated" && input.authStatus !== "unauthenticated") return { state: "unknown" };
  if (!input.signedIn) return { state: "guest" };
  const entitlement = input.entitlement;
  if (entitlement && (entitlement.status === "active" || entitlement.status === "trialing")) {
    return { state: "open", trialEndsAt: entitlement.trialEndsAt, trialing: entitlement.status === "trialing" };
  }
  if (input.entitlementLoading || input.entitlementError !== null || !entitlement) return { state: "unknown" };
  if (canStartCloudTrial(entitlement)) return { state: "trial-available" };
  if (canStartIndividualCheckout(entitlement)) return { state: "upgrade" };
  return { state: "unavailable" };
}

/** States that know the person has no Pro access right now. */
export function isKnownWithoutPro(access: ProLooksAccess): boolean {
  return access.state === "guest" || access.state === "trial-available"
    || access.state === "upgrade" || access.state === "unavailable";
}

/**
 * A look is locked when it is Pro, the person is known to be without Pro, and
 * it is not what they already use. The look in use never shows a lock, and a
 * coat kept from before coats were locked stays theirs.
 */
export function isLookLocked(look: ProLook, input: {
  readonly access: ProLooksAccess;
  readonly currentIcon: AppIconVariantId | null;
  readonly currentCoat: PetModeCoat;
  readonly keptCoat: PetModeCoat | null;
  /** The accent in use as an accent look id; Moss when not given. */
  readonly currentAccent?: string;
  readonly keptAccent?: string | null;
}): boolean {
  if (!isProLook(look) || !isKnownWithoutPro(input.access)) return false;
  if (look.kind === "icon") return look.id !== input.currentIcon;
  if (look.kind === "accent") {
    return look.id === CUSTOM_ACCENT || (look.id !== (input.currentAccent ?? DEFAULT_ACCENT) && look.id !== input.keptAccent);
  }
  return look.id !== input.currentCoat && look.id !== input.keptCoat;
}

/** Whether picking a Pro look must wait (plan still loading) instead of applying. */
export function isLookPending(look: ProLook, access: ProLooksAccess): boolean {
  return isProLook(look) && access.state === "unknown";
}

const COAT_LOCK_STARTED_KEY = "drifty.pet.coatLockStarted";
const KEPT_COAT_KEY = "drifty.pet.coatKeptFromFree";
const ACCENT_LOCK_STARTED_KEY = "drifty.accent.lockStarted";
const KEPT_ACCENT_KEY = "drifty.accent.keptFromFree";
const REVERTED_LOOKS_KEY = "drifty.proLooks.reverted";

/**
 * Coats were free from 1.5.0 until this version. The first launch of a build
 * that locks them remembers a Pro coat already in use, and that coat stays
 * open for good. Switching to any other Pro coat still needs Pro.
 */
export function resolveKeptCoat(storage: Storage | null = safeStorage()): PetModeCoat | null {
  if (!storage) return null;
  try {
    if (storage.getItem(COAT_LOCK_STARTED_KEY) === null) {
      const current = resolveInitialPetModeCoat();
      if (!FREE_PET_COATS.has(current)) storage.setItem(KEPT_COAT_KEY, current);
      storage.setItem(COAT_LOCK_STARTED_KEY, "1");
    }
    const kept = storage.getItem(KEPT_COAT_KEY);
    return isPetModeCoat(kept) && !FREE_PET_COATS.has(kept) ? kept : null;
  } catch {
    return null;
  }
}

function isAccentHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * Every accent was free until this version. The first launch of a build that
 * locks them remembers a Pro accent (or custom color) already in use, and that
 * accent stays open for good, as a coat kept from before coats were locked
 * does. Switching to any other Pro accent still needs Pro.
 */
export function resolveKeptAccent(currentAccent: string | undefined, storage: Storage | null = safeStorage()): string | null {
  if (!storage) return null;
  try {
    if (storage.getItem(ACCENT_LOCK_STARTED_KEY) === null) {
      if (isAccentHex(currentAccent) && !FREE_ACCENTS.has(normalizeHex(currentAccent))) {
        storage.setItem(KEPT_ACCENT_KEY, normalizeHex(currentAccent));
      }
      storage.setItem(ACCENT_LOCK_STARTED_KEY, "1");
    }
    const kept = storage.getItem(KEPT_ACCENT_KEY);
    return isAccentHex(kept) && !FREE_ACCENTS.has(normalizeHex(kept)) ? normalizeHex(kept) : null;
  } catch {
    return null;
  }
}

export type RevertedLooks = {
  readonly icon?: AppIconVariantId;
  readonly coat?: PetModeCoat;
  readonly accent?: string;
};

export function readRevertedLooks(storage: Storage | null = safeStorage()): RevertedLooks | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(REVERTED_LOOKS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { icon?: unknown; coat?: unknown; accent?: unknown };
    const next: { icon?: AppIconVariantId; coat?: PetModeCoat; accent?: string } = {};
    if (typeof parsed.icon === "string" && !FREE_APP_ICONS.has(parsed.icon as AppIconVariantId)) next.icon = parsed.icon as AppIconVariantId;
    if (isPetModeCoat(parsed.coat) && !FREE_PET_COATS.has(parsed.coat)) next.coat = parsed.coat;
    if (isAccentHex(parsed.accent) && !FREE_ACCENTS.has(normalizeHex(parsed.accent))) next.accent = normalizeHex(parsed.accent);
    return next.icon || next.coat || next.accent ? next : null;
  } catch {
    return null;
  }
}

export function writeRevertedLooks(value: RevertedLooks | null, storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    if (!value || (!value.icon && !value.coat && !value.accent)) storage.removeItem(REVERTED_LOOKS_KEY);
    else storage.setItem(REVERTED_LOOKS_KEY, JSON.stringify(value));
  } catch {
    // A lost record only means the look is not restored automatically.
  }
}

/** The pet window prefers this coat while a locked coat is being tried on. */
export function writePetCoatPreview(coat: PetModeCoat | null, storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    if (coat) storage.setItem(PET_MODE_COAT_PREVIEW_STORAGE_KEY, coat);
    else storage.removeItem(PET_MODE_COAT_PREVIEW_STORAGE_KEY);
  } catch {
    // The preview is cosmetic; the saved coat stays authoritative.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

