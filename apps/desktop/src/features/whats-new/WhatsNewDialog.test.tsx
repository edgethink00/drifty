// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { WhatsNewDialog } from "./WhatsNewDialog";
import type { WhatsNewEntry } from "./whatsNewChangelog";

const entries: WhatsNewEntry[] = [
  { id: "v1-13-0", date: "2026-10-20", label: "v1.13.0", platforms: ["macos"], fromVersion: "1.13.0", toVersion: "1.13.0", summary: "집중 비율을 한눈에.", items: ["새 집중 비율.", "차트를 고쳤어요."] },
  { id: "v1-12-1", date: "2026-10-08", label: "v1.12.1–1.12.9", platforms: ["macos"], fromVersion: "1.12.1", toVersion: "1.12.9", summary: "더 가벼운 추적.", items: ["이전 수정."] },
];

afterEach(() => cleanup());

describe("What's new dialog", () => {
  it("lists every chapter in one scroll with nothing to press but close", () => {
    const { container } = render(
      <LocalizationTestProvider language="ko">
        <WhatsNewDialog entries={entries} status="ready" onRetry={vi.fn()} onClose={vi.fn()} />
      </LocalizationTestProvider>,
    );

    expect([...container.querySelectorAll("article h3")].map((node) => node.textContent)).toEqual(["v1.13.0", "v1.12.1–1.12.9"]);
    expect(screen.getByText("더 가벼운 추적.")).toBeTruthy();
    expect(screen.getByText("이전 수정.")).toBeTruthy();
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["새로운 기능 닫기"]);
  });

  it("offers a retry when the changelog cannot load, and closes from Escape", () => {
    const onRetry = vi.fn();
    const onClose = vi.fn();
    render(<WhatsNewDialog entries={null} status="error" onRetry={onRetry} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
