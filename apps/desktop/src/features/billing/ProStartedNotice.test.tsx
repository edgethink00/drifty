// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ProStartedNotice } from "./ProStartedNotice";

afterEach(() => cleanup());

function renderNotice(look: Parameters<typeof ProStartedNotice>[0]["look"]) {
  render(
    <LocalizationTestProvider language="ko">
      <ProStartedNotice onDismiss={vi.fn()} look={look} />
    </LocalizationTestProvider>,
  );
  return screen.getByRole("status", { name: "Pro 시작 알림" });
}

describe("ProStartedNotice", () => {
  it("keeps the classification line for a purchase made anywhere else", () => {
    expect(renderNotice(null).textContent).toContain("이제 Claude 5.5가 분류해요.");
  });

  it("names the Pro look a purchase was made for, which is already applied", () => {
    expect(renderNotice({ kind: "icon", id: "peek" }).textContent).toContain("‘빼꼼’ 아이콘을 Dock에 적용했어요. 이제 Claude 5.5가 분류해요.");
    cleanup();
    expect(renderNotice({ kind: "coat", id: "sage" }).textContent).toContain("데스크톱 고양이에 ‘세이지’ 털을 입혔어요.");
  });
});

