import type { AppIconVariantId } from "../../lib/api/appIconClient";
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
 * and the cats) and four of the six pet coats are Pro. Classic, Midnight and
 * the Ivory and Grey coats stay free for everyone. A 7-day
 * trial, an individual plan and an organization seat all open every look.
 */
export const FREE_APP_ICONS: ReadonlySet<AppIconVariantId> = new Set(["classic", "midnight"]);
export const FREE_PET_COATS: ReadonlySet<PetModeCoat> = new Set(["ivory", "grey"]);
/** What a look falls back to once Pro ends. */
export const FREE_FALLBACK_APP_ICON: AppIconVariantId = "classic";
export const FREE_FALLBACK_PET_COAT: PetModeCoat = "ivory";

export type ProLook =
  | { readonly kind: "icon"; readonly id: AppIconVariantId }
  | { readonly kind: "coat"; readonly id: PetModeCoat };

export function isProLook(look: ProLook): boolean {
  return look.kind === "icon" ? !FREE_APP_ICONS.has(look.id) : !FREE_PET_COATS.has(look.id);
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
}): boolean {
  if (!isProLook(look) || !isKnownWithoutPro(input.access)) return false;
  if (look.kind === "icon") return look.id !== input.currentIcon;
  return look.id !== input.currentCoat && look.id !== input.keptCoat;
}

/** Whether picking a Pro look must wait (plan still loading) instead of applying. */
export function isLookPending(look: ProLook, access: ProLooksAccess): boolean {
  return isProLook(look) && access.state === "unknown";
}

const COAT_LOCK_STARTED_KEY = "drifty.pet.coatLockStarted";
const KEPT_COAT_KEY = "drifty.pet.coatKeptFromFree";
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

export type RevertedLooks = {
  readonly icon?: AppIconVariantId;
  readonly coat?: PetModeCoat;
};

export function readRevertedLooks(storage: Storage | null = safeStorage()): RevertedLooks | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(REVERTED_LOOKS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { icon?: unknown; coat?: unknown };
    const next: { icon?: AppIconVariantId; coat?: PetModeCoat } = {};
    if (typeof parsed.icon === "string" && !FREE_APP_ICONS.has(parsed.icon as AppIconVariantId)) next.icon = parsed.icon as AppIconVariantId;
    if (isPetModeCoat(parsed.coat) && !FREE_PET_COATS.has(parsed.coat)) next.coat = parsed.coat;
    return next.icon || next.coat ? next : null;
  } catch {
    return null;
  }
}

export function writeRevertedLooks(value: RevertedLooks | null, storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    if (!value || (!value.icon && !value.coat)) storage.removeItem(REVERTED_LOOKS_KEY);
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

