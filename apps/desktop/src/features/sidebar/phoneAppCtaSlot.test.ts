// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  phoneAppPhase,
  phoneAppStoreUrl,
  readPhoneAppCtaDismissed,
  resolvePhoneAppCtaSlot,
  storePhoneAppCtaDismissal,
} from "./phoneAppCtaSlot";

const localDate = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour);

afterEach(() => window.localStorage.clear());

describe("Drifty for iPhone sidebar card", () => {
  it("offers the pre-order until the release date, then the download, then retires", () => {
    const at = (now: Date) => resolvePhoneAppCtaSlot({ dismissed: false, now, timeZone: "Asia/Seoul" });

    expect(at(localDate(2026, 11, 15, 23))).toMatchObject({
      kind: "phone-app",
      titleKey: "sidebar.cta.phoneApp.preorderTitle",
      copyKey: "sidebar.cta.phoneApp.preorderDetail",
      actionLabelKey: "sidebar.cta.phoneApp.preorderAction",
      dateParam: "2026-11-16",
    });
    expect(at(localDate(2026, 11, 16, 0))).toMatchObject({ titleKey: "sidebar.cta.phoneApp.releasedTitle", actionLabelKey: "sidebar.cta.phoneApp.releasedAction" });
    expect(at(localDate(2026, 12, 31, 23))?.kind).toBe("phone-app");
    expect(at(localDate(2027, 1, 1, 0))).toBeNull();
    expect(phoneAppPhase(localDate(2027, 1, 1, 0))).toBe("ended");
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
  });
});
