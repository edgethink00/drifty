// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRuntimeInstall } from "./MemoryRuntimeInstall";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("downloads only after a click, refreshes setup on success, and sends no account or URL", async () => {
  invoke.mockImplementation(async (name) => name === "memory_runtime_status" ? { phase: "missing", received: 0, total: 100 } : undefined);
  const ready = vi.fn();
  render(<MemoryRuntimeInstall ko onReady={ready} />);
  const button = await screen.findByRole("button", { name: "내려받기" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  expect(invoke.mock.calls.map(([name]) => name)).not.toContain("memory_runtime_install");
  fireEvent.click(button);
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  expect(invoke).toHaveBeenCalledWith("memory_runtime_install");
});
it("offers retry when a download fails and does not mark the engine ready", async () => {
  invoke.mockImplementation(async (name) => {
    if (name === "memory_runtime_install") throw new Error("network");
    return { phase: "missing", received: 0, total: 100 };
  });
  const ready = vi.fn();
  render(<MemoryRuntimeInstall ko={false} onReady={ready} />);
  const button = await screen.findByRole("button", { name: "Download" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.click(button);
  expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  expect(ready).not.toHaveBeenCalled();
});

