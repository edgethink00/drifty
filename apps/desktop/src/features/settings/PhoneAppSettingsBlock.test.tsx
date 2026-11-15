// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { PhoneAppQrDialog } from "../sidebar/PhoneAppQrDialog";
import { PHONE_APP_SETTING_ID, PhoneAppSettingsBlock } from "./PhoneAppSettingsBlock";

afterEach(cleanup);

function desktopSourcePath(relativePath: string): string {
  const rootPath = join(process.cwd(), "apps/desktop", relativePath);
  return existsSync(rootPath) ? rootPath : join(process.cwd(), relativePath);
}

const beforeRelease = new Date(2026, 10, 15, 23);
const afterRelease = new Date(2026, 10, 20, 12);

describe("PhoneAppSettingsBlock", () => {
  it("says nothing during the pre-order", () => {
    const { container } = render(
      <LocalizationTestProvider language="ko">
        <PhoneAppSettingsBlock now={beforeRelease} timeZone="Asia/Seoul" />
      </LocalizationTestProvider>,
    );
    expect(container.querySelector(`[data-setting-id="${PHONE_APP_SETTING_ID}"]`)).toBeNull();
  });

  it("shows only the app's name, price and QR code from the release date", () => {
    const { container } = render(
      <LocalizationTestProvider language="ko">
        <PhoneAppSettingsBlock now={afterRelease} timeZone="Asia/Seoul" />
      </LocalizationTestProvider>,
    );

    const block = container.querySelector(`[data-setting-id="${PHONE_APP_SETTING_ID}"]`)!;
    expect(block.querySelector("h3")?.textContent).toBe("휴대폰");
    const [iphoneRow, androidRow] = Array.from(block.querySelectorAll(".settings-row"));
    expect(iphoneRow.querySelector(".lbl")?.textContent).toBe("iPhone용 Drifty");
    expect(iphoneRow.querySelector(".desc")?.textContent).toBe("App Store에서 무료");
    const code = screen.getByRole("img", { name: "App Store의 Drifty로 가는 QR 코드" });
    expect(code.getAttribute("width")).toBe("90");
    // The iPhone row keeps the minimum: no app icon, steps, feature list or close button.
    expect(block.querySelectorAll("img")).toHaveLength(1);
    expect(block.querySelector("ol, ul")).toBeNull();
    expect(iphoneRow.querySelector("button")).toBeNull();
    // Android has no app yet: its row points to the waitlist instead of a code.
    expect(androidRow.querySelector(".lbl")?.textContent).toBe("Android용 Drifty");
    expect(androidRow.querySelector("button")?.textContent).toBe("대기자 명단 등록");
  });

  it("opens the Android waitlist in the app's language", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <LocalizationTestProvider language="ko">
        <PhoneAppSettingsBlock now={afterRelease} timeZone="Asia/Seoul" />
      </LocalizationTestProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "대기자 명단 등록" }));
    expect(String(open.mock.calls[0]?.[0])).toMatch(/^https:\/\/drifty\.so\/ko\/android\/\?.*utm_content=settings/);
    open.mockRestore();
  });

  it("stays away from EU storefronts, like the sidebar card", () => {
    const { container } = render(
      <LocalizationTestProvider language="de">
        <PhoneAppSettingsBlock now={afterRelease} timeZone="Europe/Berlin" />
      </LocalizationTestProvider>,
    );
    expect(container.querySelector(`[data-setting-id="${PHONE_APP_SETTING_ID}"]`)).toBeNull();
  });

  it("shows its own code, apart from the sidebar card's dialog, on whole pixels per module", () => {
    const { container } = render(
      <LocalizationTestProvider language="en">
        <PhoneAppSettingsBlock now={afterRelease} timeZone="Asia/Seoul" />
        <PhoneAppQrDialog phase="released" onClose={() => undefined} onOpenStore={() => undefined} />
      </LocalizationTestProvider>,
    );
    // Settings and the sidebar card's dialog report under their own App Store campaigns.
    const sources = [".phone-app-settings__qr", ".phone-app-qr__code img"]
      .map((selector) => container.ownerDocument.querySelector(selector)?.getAttribute("src"));
    expect(new Set(sources).size).toBe(2);
    // Both codes are 45 modules with the quiet zone; Settings draws two pixels per module.
    for (const name of ["iphone-app-store-qr-settings.svg", "iphone-app-store-qr.svg"]) {
      const svg = readFileSync(desktopSourcePath(`src/assets/${name}`), "utf8");
      expect(svg, name).toContain('viewBox="0 0 45 45"');
    }
    expect(container.ownerDocument.querySelector(".phone-app-settings__qr")?.getAttribute("width")).toBe(String(45 * 2));
  });
});
