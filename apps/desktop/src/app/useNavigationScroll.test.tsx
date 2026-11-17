// @vitest-environment jsdom
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import type { NavigationSnapshot } from "./navigation";
import { useNavigationScroll } from "./useNavigationScroll";

const first: NavigationSnapshot = { tabId: "projects", dashPeriod: "Today", projectId: "project" };
const second: NavigationSnapshot = { tabId: "trends", dashPeriod: "Today" };

function Harness({ entry, section, save }: { entry: NavigationSnapshot; section: string | null; save: { current: () => void } }) {
  const content = useRef<HTMLElement>(null);
  save.current = useNavigationScroll(content, entry, section);
  return <main ref={content}><div>page</div></main>;
}

function scrollMetrics(node: HTMLElement, initialHeight = 1_000) {
  let height = initialHeight;
  let top = 0;
  Object.defineProperties(node, {
    clientHeight: { configurable: true, get: () => 200 },
    scrollHeight: { configurable: true, get: () => height },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => { top = Math.min(Math.max(0, value), Math.max(0, height - 200)); },
    },
  });
  return { setHeight: (value: number) => { height = value; } };
}

describe("navigation scroll positions", () => {
  it("opens new entries at the top and restores each back/forward entry independently", () => {
    const save = { current: () => {} };
    const view = render(<Harness entry={first} section={null} save={save} />);
    const main = view.container.querySelector("main")!;
    scrollMetrics(main);
    main.scrollTop = 600;
    act(() => save.current());
    view.rerender(<Harness entry={second} section={null} save={save} />);
    expect(main.scrollTop).toBe(0);
    main.scrollTop = 300;
    act(() => save.current());
    view.rerender(<Harness entry={first} section={null} save={save} />);
    expect(main.scrollTop).toBe(600);
    act(() => save.current());
    view.rerender(<Harness entry={second} section={null} save={save} />);
    expect(main.scrollTop).toBe(300);
    act(() => save.current());
    view.rerender(<Harness entry={{ ...first }} section={null} save={save} />);
    expect(main.scrollTop).toBe(0);
  });

  it("starts another settings section at the top", () => {
    const save = { current: () => {} };
    const settings: NavigationSnapshot = { tabId: "settings", dashPeriod: "Today" };
    const view = render(<Harness entry={settings} section="pet" save={save} />);
    const main = view.container.querySelector("main")!;
    scrollMetrics(main);
    main.scrollTop = 400;
    view.rerender(<Harness entry={settings} section="notifications" save={save} />);
    expect(main.scrollTop).toBe(0);
  });

  it("restores a saved position after deferred content grows, unless the user intervenes", async () => {
    const save = { current: () => {} };
    const view = render(<Harness entry={first} section={null} save={save} />);
    const main = view.container.querySelector("main")!;
    const metrics = scrollMetrics(main);
    main.scrollTop = 600;
    act(() => save.current());
    view.rerender(<Harness entry={second} section={null} save={save} />);
    metrics.setHeight(200);
    view.rerender(<Harness entry={first} section={null} save={save} />);
    expect(main.scrollTop).toBe(0);
    metrics.setHeight(1_000);
    main.append(document.createElement("div"));
    await waitFor(() => expect(main.scrollTop).toBe(600));

    act(() => save.current());
    view.rerender(<Harness entry={second} section={null} save={save} />);
    metrics.setHeight(200);
    view.rerender(<Harness entry={first} section={null} save={save} />);
    fireEvent.wheel(main);
    metrics.setHeight(1_000);
    main.append(document.createElement("div"));
    await act(async () => { await Promise.resolve(); });
    expect(main.scrollTop).toBe(0);
  });
});
