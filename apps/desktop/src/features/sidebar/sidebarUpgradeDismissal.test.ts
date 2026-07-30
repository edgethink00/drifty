// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  isSidebarUpgradeDismissed,
  readSidebarUpgradeDismissedUntil,
  SIDEBAR_UPGRADE_DISMISSAL_DURATION_MS,
  storeSidebarUpgradeDismissal,
} from "./sidebarUpgradeDismissal";

describe("sidebar upgrade dismissal", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("suppresses the general upgrade for seven days", () => {
    const dismissedAt = 1_000;
    const dismissedUntil = storeSidebarUpgradeDismissal(dismissedAt);

    expect(readSidebarUpgradeDismissedUntil()).toBe(dismissedUntil);
    expect(isSidebarUpgradeDismissed(dismissedUntil, dismissedAt + SIDEBAR_UPGRADE_DISMISSAL_DURATION_MS - 1)).toBe(true);
    expect(isSidebarUpgradeDismissed(dismissedUntil, dismissedAt + SIDEBAR_UPGRADE_DISMISSAL_DURATION_MS)).toBe(false);
  });

  it("ignores malformed stored values", () => {
    window.localStorage.setItem("drifty.sidebarUpgrade.dismissedUntil.v1", "not-a-number");

    expect(readSidebarUpgradeDismissedUntil()).toBeNull();
  });
});
