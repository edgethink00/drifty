// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../features/localization/LocalizationContext";
import { MainContentShell, NavIcon, SIDEBAR_EDGE_SNAP_REM, SidebarResizeEdge, WindowsTitlebar, WindowSidebarToggle } from "./AppShell";

const { isTauriRuntime, nativeInvoke, nativeWindow } = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(() => false),
  nativeInvoke: vi.fn().mockResolvedValue(undefined),
  nativeWindow: {
    close: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockResolvedValue(false),
    minimize: vi.fn().mockResolvedValue(undefined),
    onResized: vi.fn().mockResolvedValue(vi.fn()),
    startDragging: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: nativeInvoke, isTauri: isTauriRuntime }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => nativeWindow }));

beforeEach(() => {
  isTauriRuntime.mockReturnValue(false);
  nativeInvoke.mockClear();
  for (const mock of Object.values(nativeWindow)) mock.mockClear();
  nativeWindow.isMaximized.mockResolvedValue(false);
  nativeWindow.onResized.mockResolvedValue(vi.fn());
});

afterEach(() => cleanup());

describe("MainContentShell", () => {
  it("announces tracker errors when they appear", () => {
    render(
      <MainContentShell
        activeTab="dashboard"
        loading={false}
        hasLoadedOnce
        error="Tracker connection failed"
      >
        <p>Dashboard content</p>
      </MainContentShell>,
    );

    // The visible line reads in the app language; the tracker's own wording
    // stays available on hover and to assistive technology.
    const alert = screen.getByRole("alert");
    expect(alert.firstChild?.textContent).toBe("Something didn't finish. Try again in a moment.");
    expect(alert.getAttribute("title")).toBe("Tracker connection failed");
    expect(alert.textContent).toContain("Tracker connection failed");
  });

  it("names a busy activity database instead of showing the SQLite message", () => {
    render(
      <MainContentShell activeTab="dashboard" loading={false} hasLoadedOnce error="database is locked">
        <p>Dashboard content</p>
      </MainContentShell>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.firstChild?.textContent).toBe("Another task was using the activity database. Try again in a moment.");
    expect(alert.getAttribute("title")).toBe("database is locked");
  });
});

describe("NavIcon", () => {
  it("keeps the Projects layers on the same optical midline as nearby activity icons", () => {
    const { container } = render(<NavIcon type="projects" />);
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("expected projects svg");
    const paths = Array.from(svg.querySelectorAll("path")).map((path) => path.getAttribute("d"));

    expect(paths).toEqual([
      "M12 5 3 10l9 5 9-5-9-5Z",
      "M3 15l9 5 9-5",
      "M3 10v5m18-5v5",
    ]);
    expect(paths.join(" ")).not.toContain("M12 3");
  });
});

describe("WindowsTitlebar", () => {
  it("keeps the drag surface separate from the caption controls", () => {
    render(<WindowsTitlebar leading={<button type="button">Menu</button>} trailing={<span>Ready</span>} />);

    const titlebar = screen.getByRole("banner", { name: "Window titlebar" });
    const dragRegion = titlebar.querySelector(".windows-titlebar__drag-region");
    expect(dragRegion).toBeTruthy();
    expect(dragRegion?.hasAttribute("data-tauri-drag-region")).toBe(false);
    expect(titlebar.contains(screen.getByRole("button", { name: "Menu" }))).toBe(true);
    expect(screen.getByRole("button", { name: "Maximize" }).id).toBe("windows-caption-maximize");
    expect(screen.getByRole("button", { name: "Minimize" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Window controls" })).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("routes caption controls and titlebar gestures through the current Tauri window", async () => {
    isTauriRuntime.mockReturnValue(true);
    render(<WindowsTitlebar />);

    await waitFor(() => expect(nativeWindow.onResized).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    fireEvent.click(screen.getByRole("button", { name: "Maximize" }));
    const dragRegion = document.querySelector(".windows-titlebar__drag-region") as HTMLElement;
    fireEvent.mouseDown(dragRegion, { button: 0, detail: 1 });
    fireEvent.mouseDown(dragRegion, { button: 0, detail: 2 });
    fireEvent.contextMenu(dragRegion);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(nativeWindow.minimize).toHaveBeenCalledTimes(1);
      expect(nativeWindow.toggleMaximize).toHaveBeenCalledTimes(2);
      expect(nativeWindow.startDragging).toHaveBeenCalledTimes(1);
      expect(nativeWindow.close).toHaveBeenCalledTimes(1);
      expect(nativeInvoke).toHaveBeenCalledWith("window_show_system_menu");
    });
  });

  it("tracks native maximize state after the window is resized", async () => {
    let resizeHandler: (() => void) | undefined;
    nativeWindow.onResized.mockImplementation(async (handler: () => void) => {
      resizeHandler = handler;
      return vi.fn();
    });
    isTauriRuntime.mockReturnValue(true);
    render(<WindowsTitlebar />);

    await waitFor(() => expect(resizeHandler).toBeTypeOf("function"));
    nativeWindow.isMaximized.mockResolvedValue(true);
    await act(async () => resizeHandler?.());

    expect(await screen.findByRole("button", { name: "Restore" })).toBeTruthy();
  });

  it("releases a resize listener that resolves after unmount", async () => {
    const unlisten = vi.fn();
    let resolveListener: ((listener: () => void) => void) | undefined;
    nativeWindow.onResized.mockReturnValue(new Promise((resolve) => {
      resolveListener = resolve;
    }));
    isTauriRuntime.mockReturnValue(true);
    const view = render(<WindowsTitlebar />);

    await waitFor(() => expect(resolveListener).toBeTypeOf("function"));
    view.unmount();
    await act(async () => resolveListener?.(unlisten));

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("removes maximize for fixed-size onboarding windows", () => {
    render(<WindowsTitlebar maximizable={false} />);

    expect(screen.getByRole("banner", { name: "Window titlebar" }).classList.contains("windows-titlebar--not-maximizable")).toBe(true);
    expect(screen.queryByRole("button", { name: "Maximize" })).toBeNull();
    expect(nativeWindow.isMaximized).not.toHaveBeenCalled();
  });

  it("localizes the Windows caption controls", () => {
    render(
      <LocalizationTestProvider language="ko">
        <WindowsTitlebar />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("banner", { name: "창 제목 표시줄" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "창 제어" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "최소화" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "최대화" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "닫기" })).toBeTruthy();
  });
});

describe("WindowSidebarToggle", () => {
  it("exposes the controlled sidebar and its expanded state", () => {
    const { rerender } = render(<WindowSidebarToggle collapsed={false} placement="titlebar" onToggle={() => undefined} />);

    const expandedToggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(expandedToggle.getAttribute("aria-controls")).toBe("app-sidebar");
    expect(expandedToggle.getAttribute("aria-expanded")).toBe("true");
    expect(expandedToggle.getAttribute("aria-pressed")).toBe("false");

    rerender(<WindowSidebarToggle collapsed placement="titlebar" onToggle={() => undefined} />);
    const collapsedToggle = screen.getByRole("button", { name: "Expand sidebar" });
    expect(collapsedToggle.getAttribute("aria-expanded")).toBe("false");
    expect(collapsedToggle.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("SidebarResizeEdge", () => {
  it("snaps midway between the rail and the open sidebar widths", () => {
    const tokens = readFileSync(resolve("src/styles/tokens-base.css"), "utf8");
    const rem = (name: string) => Number(tokens.match(new RegExp("--" + name + ":\\s*([0-9.]+)rem;"))?.[1]);
    expect(SIDEBAR_EDGE_SNAP_REM).toBe((rem("sidebar-collapsed-width") + rem("sidebar-expanded-width")) / 2);
  });

  it("controls the sidebar, says what a click does and folds it from the keyboard", () => {
    const onCollapsedChange = vi.fn();
    const { rerender } = render(<><aside id="app-sidebar" /><SidebarResizeEdge collapsed={false} onCollapsedChange={onCollapsedChange} /></>);
    const edge = screen.getByRole("separator", { name: "Resize sidebar" });
    expect(edge.getAttribute("aria-controls")).toBe("app-sidebar");
    expect(edge.getAttribute("title")).toBe("Collapse sidebar");
    fireEvent.keyDown(edge, { key: "Enter" });
    expect(onCollapsedChange).toHaveBeenLastCalledWith(true);

    rerender(<><aside id="app-sidebar" /><SidebarResizeEdge collapsed onCollapsedChange={onCollapsedChange} /></>);
    expect(edge.getAttribute("title")).toBe("Expand sidebar");
    fireEvent.keyDown(edge, { key: "ArrowRight" });
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
  });
});
