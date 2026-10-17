// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryPageLink } from "./HistoryPageLink";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("History title link", () => {
  it("keeps browser link behavior and does not select its surrounding row", () => {
    const select = vi.fn();
    render(<div onClick={select}><HistoryPageLink title="API reference" url="https://docs.example.com/api?part=one#example" /></div>);
    const link = screen.getByRole("link", { name: /API reference/ });
    expect(link.getAttribute("href")).toBe("https://docs.example.com/api?part=one#example");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    fireEvent.click(link);
    expect(select).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("shows the exact destination on focus, dismisses on Escape and when scrolling", () => {
    render(<HistoryPageLink title="API reference" url="https://docs.example.com/api?part=one#example" />);
    const link = screen.getByRole("link");
    fireEvent.focus(link);
    expect(screen.getByRole("tooltip").textContent).toContain("https://docs.example.com/api?part=one#example");
    expect(link.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.keyDown(link, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(link);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.scroll(window);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("uses the native default-browser opener once while a request is pending", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let finish: (() => void) | undefined;
    openUrl.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const select = vi.fn();
    render(<div onClick={select}><HistoryPageLink title="API reference" url="https://docs.example.com/api" /></div>);
    const link = screen.getByRole("link");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(link, event);
    fireEvent.click(link);
    await waitFor(() => expect(openUrl).toHaveBeenCalledExactlyOnceWith("https://docs.example.com/api"));
    expect(event.defaultPrevented).toBe(true);
    expect(select).not.toHaveBeenCalled();
    finish?.();
  });

  it("reports native failure without exposing the error payload and allows retry", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    openUrl.mockRejectedValueOnce(new Error("private backend detail")).mockResolvedValueOnce(undefined);
    render(<HistoryPageLink title="API reference" url="https://docs.example.com/api" />);
    fireEvent.click(screen.getByRole("link"));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not open this page. Try again.");
    expect(document.body.textContent).not.toContain("private backend detail");
    fireEvent.click(screen.getByRole("link"));
    await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
