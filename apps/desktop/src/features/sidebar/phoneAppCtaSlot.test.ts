// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  phoneAppPhase,
  phoneAppQrUrl,
  phoneAppReleasePhase,
  phoneAppStoreUrl,
  readPhoneAppCtaDismissed,
  resolvePhoneAppCtaSlot,
  storePhoneAppCtaDismissal,
} from "./phoneAppCtaSlot";

const localDate = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour);

afterEach(() => window.localStorage.clear());

describe("Drifty for iPhone sidebar card", () => {
  it("offers the pre-order until the release date, then the download, then retires; Settings keeps the release phase", () => {
    const at = (now: Date) => resolvePhoneAppCtaSlot({ dismissed: false, now, timeZone: "Asia/Seoul" });

    expect(at(localDate(2026, 11, 15, 23))).toEqual({ alert: null, kind: "phone-app", phase: "preorder", tone: "phone" });
    expect(at(localDate(2026, 11, 16, 0))).toMatchObject({ kind: "phone-app", phase: "released" });
    expect(at(localDate(2026, 12, 31, 23))?.kind).toBe("phone-app");
    expect(at(localDate(2027, 1, 1, 0))).toBeNull();
    expect(phoneAppPhase(localDate(2027, 1, 1, 0))).toBe("ended");
    expect(phoneAppReleasePhase(localDate(2026, 11, 15, 23))).toBe("preorder");
    expect(phoneAppReleasePhase(localDate(2027, 6, 1))).toBe("released");
  });

  it("stays away from EU storefronts, where the App Store page does not exist", () => {
    const now = localDate(2026, 10, 23);
    for (const timeZone of ["Europe/Berlin", "Europe/Paris", "Europe/Dublin", "Atlantic/Canary", "Indian/Reunion"]) {
      expect(resolvePhoneAppCtaSlot({ dismissed: false, now, timeZone }), timeZone).toBeNull();
    }
    for (const timeZone of ["Asia/Seoul", "America/New_York", "Europe/London", "Europe/Zurich", "Europe/Oslo", "Asia/Tokyo"]) {
      expect(resolvePhoneAppCtaSlot({ dismissed: false, now, timeZone })?.kind, timeZone).toBe("phone-app");
    }
    // An unreadable time zone is not evidence of an EU storefront.
    expect(resolvePhoneAppCtaSlot({ dismissed: false, now, timeZone: null })?.kind).toBe("phone-app");
  });

  it("keeps a closed card closed on this computer", () => {
    expect(readPhoneAppCtaDismissed()).toBe(false);
    storePhoneAppCtaDismissal();
    expect(readPhoneAppCtaDismissed()).toBe(true);
    expect(resolvePhoneAppCtaSlot({ dismissed: readPhoneAppCtaDismissed(), now: localDate(2026, 10, 23), timeZone: "Asia/Seoul" })).toBeNull();
  });

  it("tags each App Store link with its desktop campaign", () => {
    expect(phoneAppStoreUrl("drifty_desktop_qr")).toBe("https://apps.apple.com/app/apple-store/id6824176729?pt=128967674&ct=drifty_desktop_qr&mt=8");
    expect(new URL(phoneAppStoreUrl("drifty_desktop_link")).searchParams.get("ct")).toBe("drifty_desktop_link");
    // The sidebar card and the Settings section each carry their own code.
    expect(new URL(phoneAppStoreUrl("drifty_desktop_sidebar")).searchParams.get("ct")).toBe("drifty_desktop_sidebar");
    expect(new URL(phoneAppStoreUrl("drifty_desktop_settings")).searchParams.get("ct")).toBe("drifty_desktop_settings");
    // The sidebar's small code uses the slug-free link, which keeps the same campaign.
    expect(phoneAppQrUrl("drifty_desktop_sidebar")).toBe("https://apps.apple.com/app/id6824176729?pt=128967674&ct=drifty_desktop_sidebar&mt=8");
  });
});
