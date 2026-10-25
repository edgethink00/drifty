import { isTauri } from "@tauri-apps/api/core";
import type { SidebarCtaSlotState } from "./SidebarCtaSlot";

/** Drifty for iPhone on the App Store. */
export const IPHONE_APP_STORE_ID = "6824176729";
/** App Store Connect provider token; campaign links report under App Analytics. */
const APP_STORE_PROVIDER_TOKEN = "128967674";
/**
 * The App Store release date of the pre-order, a calendar date in each
 * storefront. The computer says nothing about the iPhone app before it: the
 * sidebar card and the Settings section both start on this date.
 */
export const IPHONE_APP_RELEASE_DATE = "2026-11-16";
/** The card is launch news; it retires after this date. */
export const PHONE_APP_CTA_LAST_DATE = "2026-12-31";

const DISMISSED_STORAGE_KEY = "drifty.sidebarPhoneApp.dismissed.v1";

/**
 * The pre-order is offered in every storefront except the 27 EU member
 * states (apps.apple.com answers 404 there). A computer set to one of their
 * time zones, including outermost regions served by the same storefronts,
 * would open a page that does not exist, so the card stays away.
 */
const UNAVAILABLE_TIME_ZONES: ReadonlySet<string> = new Set([
  "Africa/Ceuta", "America/Cayenne", "America/Guadeloupe", "America/Martinique",
  "America/Marigot", "Asia/Famagusta", "Asia/Nicosia",
  "Atlantic/Azores", "Atlantic/Canary", "Atlantic/Madeira", "Europe/Amsterdam",
  "Europe/Athens", "Europe/Berlin", "Europe/Bratislava", "Europe/Brussels",
  "Europe/Bucharest", "Europe/Budapest", "Europe/Busingen", "Europe/Copenhagen",
  "Europe/Dublin", "Europe/Helsinki", "Europe/Lisbon", "Europe/Ljubljana",
  "Europe/Luxembourg", "Europe/Madrid", "Europe/Malta", "Europe/Mariehamn",
  "Europe/Nicosia", "Europe/Paris", "Europe/Prague", "Europe/Riga", "Europe/Rome",
  "Europe/Sofia", "Europe/Stockholm", "Europe/Tallinn", "Europe/Vienna",
  "Europe/Vilnius", "Europe/Warsaw", "Europe/Zagreb", "Indian/Mayotte", "Indian/Reunion",
]);

export type PhoneAppPhase = "preorder" | "released" | "ended";

/**
 * Where on the computer a link or QR code came from. Each token reports under
 * App Analytics on its own, separate from drifty.so: the store-page link, the
 * sidebar card's QR dialog and the Settings section's QR.
 */
export type PhoneAppStoreCampaign = "drifty_desktop_link" | "drifty_desktop_qr" | "drifty_desktop_settings";

/** App Store link for this computer; the campaign token separates it from drifty.so. */
export function phoneAppStoreUrl(campaign: PhoneAppStoreCampaign): string {
  return `https://apps.apple.com/app/apple-store/id${IPHONE_APP_STORE_ID}?pt=${APP_STORE_PROVIDER_TOKEN}&ct=${campaign}&mt=8`;
}

function localIsoDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Pre-order or out, compared on this computer's calendar date, the nearest
 * stand-in for its storefront's midnight. Settings shows its iPhone section
 * from launch on, so this phase never ends.
 */
export function phoneAppReleasePhase(now: Date): Exclude<PhoneAppPhase, "ended"> {
  return localIsoDate(now) >= IPHONE_APP_RELEASE_DATE ? "released" : "preorder";
}

/** The sidebar card's phase: launch news that retires after {@link PHONE_APP_CTA_LAST_DATE}. */
export function phoneAppPhase(now: Date): PhoneAppPhase {
  if (localIsoDate(now) > PHONE_APP_CTA_LAST_DATE) return "ended";
  return phoneAppReleasePhase(now);
}

export function currentTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

export function isPhoneAppOfferedIn(timeZone: string | null): boolean {
  return timeZone === null || !UNAVAILABLE_TIME_ZONES.has(timeZone);
}

/** Settings > Sync > iPhone and its search entry: from the release date, where the App Store offers the app. */
export function isPhoneAppSettingsShown(now: Date, timeZone: string | null): boolean {
  return isPhoneAppOfferedIn(timeZone) && phoneAppReleasePhase(now) === "released";
}

type ResolvePhoneAppCtaSlotInput = {
  readonly dismissed: boolean;
  readonly now: Date;
  readonly timeZone: string | null;
};

/**
 * Drifty for iPhone in the sidebar's card slot, from the release date only:
 * during the pre-order the computer shows nothing. It is the slot's lowest
 * priority: the caller offers it only when no tracker, AI or plan card
 * applies, so it never displaces a recovery or the Pro offer. Its action opens
 * the QR dialog. Closing it is permanent on this computer; Settings > Sync
 * keeps the App Store code.
 */
export function resolvePhoneAppCtaSlot({ dismissed, now, timeZone }: ResolvePhoneAppCtaSlotInput): SidebarCtaSlotState | null {
  if (dismissed || !isPhoneAppOfferedIn(timeZone)) return null;
  if (phoneAppPhase(now) !== "released") return null;
  return {
    actionLabelKey: "sidebar.cta.phoneApp.releasedAction",
    alert: null,
    copyKey: "sidebar.cta.phoneApp.releasedDetail",
    direction: "forward",
    disabled: false,
    kind: "phone-app",
    titleKey: "sidebar.cta.phoneApp.releasedTitle",
    titleEmphasisCount: null,
    tone: "phone",
  };
}

export function readPhoneAppCtaDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function storePhoneAppCtaDismissal(): void {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, "1");
  } catch {
    // Storage can be unavailable; the card then closes for this session only.
  }
}

/** Opens the App Store page in the default browser (a new tab in a browser build). */
export async function openPhoneAppStore(): Promise<void> {
  const url = phoneAppStoreUrl("drifty_desktop_link");
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
