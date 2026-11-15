// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { PhoneAppQrDialog } from "./PhoneAppQrDialog";

afterEach(cleanup);

describe("PhoneAppQrDialog", () => {
  it("hands the pre-order to the phone and keeps the store page one click away", () => {
    const onClose = vi.fn();
    const onOpenStore = vi.fn();
    const onOpenAndroidWaitlist = vi.fn();
    render(
      <LocalizationTestProvider language="ko">
        <PhoneAppQrDialog phase="preorder" onClose={onClose} onOpenStore={onOpenStore} onOpenAndroidWaitlist={onOpenAndroidWaitlist} />
      </LocalizationTestProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "iPhone으로 스캔하세요" });
    // The date never wraps between month and day.
    expect(dialog.textContent).toContain("11월\u00a016일에 출시돼요");
    expect(screen.getByRole("img", { name: "App Store의 Drifty로 가는 QR 코드" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /App Store 페이지 열기/ }));
    expect(onOpenStore).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    // Before the code, Android users read that their app is in the works and can open the waitlist; the dialog stays.
    const header = dialog.querySelector(".auth-modal__header")!;
    expect(header.textContent).toContain("Android 앱은 준비 중이에요.");
    fireEvent.click(screen.getByRole("button", { name: /출시 알림 받기/ }));
    expect(onOpenAndroidWaitlist).toHaveBeenCalledTimes(1);
    expect(onOpenStore).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /완료/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("drops the release date once the app is out", () => {
    render(
      <LocalizationTestProvider language="en">
        <PhoneAppQrDialog phase="released" onClose={vi.fn()} onOpenStore={vi.fn()} onOpenAndroidWaitlist={vi.fn()} />
      </LocalizationTestProvider>,
    );
    expect(screen.getByRole("dialog").textContent).toContain("get Drifty from the App Store. It’s free.");
    expect(screen.getByRole("dialog").textContent).not.toContain("Nov 16");
  });
});
