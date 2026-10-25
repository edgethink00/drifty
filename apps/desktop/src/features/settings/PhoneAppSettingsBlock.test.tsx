// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { PhoneAppSidebarCard } from "../sidebar/PhoneAppSidebarCard";
import { PhoneAppQrDialog } from "../sidebar/PhoneAppQrDialog";
import { PHONE_APP_SETTING_ID, PhoneAppSettingsBlock } from "./PhoneAppSettingsBlock";

afterEach(cleanup);

function desktopSourcePath(relativePath: string): string {
  const rootPath = join(process.cwd(), "apps/desktop", relativePath);
  return existsSync(rootPath) ? rootPath : join(process.cwd(), relativePath);
}

const beforeRelease = new Date(2026, 9, 26, 12);
const afterRelease = new Date(2026, 10, 20, 12);

describe("PhoneAppSettingsBlock", () => {
  it("shows only the app's name, release date, price and QR code", () => {
    const { container } = render(
      <LocalizationTestProvider language="ko">
        <PhoneAppSettingsBlock now={beforeRelease} timeZone="Asia/Seoul" />
      </LocalizationTestProvider>,
    );

    const block = container.querySelector(`[data-setting-id="${PHONE_APP_SETTING_ID}"]`)!;
    expect(block.querySelector("h3")?.textContent).toBe("iPhone");
    expect(block.querySelector(".lbl")?.textContent).toBe("iPhone용 Drifty");
    expect(block.querySelector(".desc")?.textContent).toBe("11월\u00a016일 출시 · 무료");
    const code = screen.getByRole("img", { name: "App Store의 Drifty로 가는 QR 코드" });
    expect(code.getAttribute("width")).toBe("90");
    // The minimum: no app icon, steps, feature list or close button.
    expect(block.querySelectorAll("img")).toHaveLength(1);
    expect(block.querySelector("ol, ul, button")).toBeNull();
  });

  it("stays after launch without the date", () => {
    render(
      <LocalizationTestProvider language="en">
        <PhoneAppSettingsBlock now={afterRelease} timeZone="America/New_York" />
      </LocalizationTestProvider>,
    );
    expect(screen.getByText("Drifty for iPhone")).toBeTruthy();
    expect(screen.getByText("Free on the App Store")).toBeTruthy();
    expect(screen.queryByText(/Nov/)).toBeNull();
  });

  it("stays away from EU storefronts, like the sidebar card", () => {
    const { container } = render(
      <LocalizationTestProvider language="de">
        <PhoneAppSettingsBlock now={beforeRelease} timeZone="Europe/Berlin" />
      </LocalizationTestProvider>,
    );
    expect(container.querySelector(`[data-setting-id="${PHONE_APP_SETTING_ID}"]`)).toBeNull();
  });

  it("shows a separate code in each place, each sized to whole pixels per module", () => {
    const { container } = render(
      <LocalizationTestProvider language="en">
        <PhoneAppSettingsBlock now={beforeRelease} timeZone="Asia/Seoul" />
        <PhoneAppSidebarCard state={{ alert: null, kind: "phone-app", phase: "preorder", tone: "phone" }} onEnlarge={() => undefined} />
        <PhoneAppQrDialog phase="preorder" onClose={() => undefined} onOpenStore={() => undefined} />
      </LocalizationTestProvider>,
    );
    // Settings, sidebar and the enlarged dialog report under their own App Store campaigns.
    const sources = [".phone-app-settings__qr", ".phone-app-card__qr img", ".phone-app-qr__code img"]
      .map((selector) => container.ownerDocument.querySelector(selector)?.getAttribute("src"));
    expect(new Set(sources).size).toBe(3);
    // Settings shows 45 modules at 90px; the sidebar's shorter link, 37 at 74px.
    for (const [name, modules] of [["iphone-app-store-qr-settings.svg", 45], ["iphone-app-store-qr-sidebar.svg", 37], ["iphone-app-store-qr.svg", 45]] as const) {
      const svg = readFileSync(desktopSourcePath(`src/assets/${name}`), "utf8");
      expect(svg, name).toContain(`viewBox="0 0 ${modules} ${modules}"`);
    }
    expect(container.ownerDocument.querySelector(".phone-app-card__qr img")?.getAttribute("width")).toBe(String(37 * 2));
    expect(container.ownerDocument.querySelector(".phone-app-settings__qr")?.getAttribute("width")).toBe(String(45 * 2));
  });
});
