// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProFunnelRecorder, recordProFunnelStep } from "./proFunnel";
import { readProductAnalyticsRevision, writeProductAnalyticsEnabled } from "./productAnalyticsPreference";
import { useProFunnelExposure } from "./useProFunnelExposure";
vi.mock("./proFunnel", async (importOriginal) => ({ ...await importOriginal<typeof import("./proFunnel")>(), recordProFunnelStep: vi.fn().mockResolvedValue(true) }));

let focused = true;
let hidden = false;
let occluded = false;
function Harness({ enabled = true, hasResult = true }) {
  const ref = useProFunnelExposure<HTMLDivElement>(enabled, enabled ? { step: "classified_result_viewed", dashboard_period: "day" } : null);
  return <div ref={ref}><div data-testid="result" data-funnel-classified-result={hasResult ? "true" : undefined}>Classified result</div></div>;
}
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  focused = true; hidden = false; occluded = false;
  vi.mocked(recordProFunnelStep).mockReset().mockResolvedValue(true);
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => hidden ? "hidden" : "visible");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 300, bottom: 300, width: 300, height: 300, x: 0, y: 0, toJSON: () => ({}) });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => occluded ? document.body : document.querySelector('[data-testid="result"]') });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("real foreground exposure", () => {
  it("requires a continuous second and does not restart on equivalent rerenders", async () => {
    const view = render(<Harness />);
    await advance(750);
    expect(recordProFunnelStep).not.toHaveBeenCalled();
    view.rerender(<Harness />);
    await advance(250);
    expect(recordProFunnelStep).toHaveBeenCalledTimes(1);
    await advance(3000);
    expect(recordProFunnelStep).toHaveBeenCalledTimes(1);
  });
  it("resets duration on blur, background and occlusion, then records re-exposure", async () => {
    render(<Harness />);
    await advance(750);
    act(() => { focused = false; window.dispatchEvent(new Event("blur")); });
    expect(vi.getTimerCount()).toBe(0);
    await advance(250);
    act(() => {
      focused = true; hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(vi.getTimerCount()).toBe(0);
    await advance(1500);
    act(() => { hidden = false; occluded = true; document.dispatchEvent(new Event("visibilitychange")); });
    await advance(1500);
    expect(recordProFunnelStep).not.toHaveBeenCalled();
    occluded = false;
    await advance(1000);
    expect(recordProFunnelStep).not.toHaveBeenCalled();
    await advance(250);
    expect(recordProFunnelStep).toHaveBeenCalledTimes(1);
  });
  it("starts from hidden without polling and resumes on native focus events", async () => {
    hidden = true; focused = false;
    render(<Harness />);
    expect(vi.getTimerCount()).toBe(0);
    await advance(5000);
    act(() => {
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(vi.getTimerCount()).toBe(0);
    act(() => { focused = true; window.dispatchEvent(new Event("focus")); });
    await advance(750);
    expect(recordProFunnelStep).not.toHaveBeenCalled();
    await advance(250);
    expect(recordProFunnelStep).toHaveBeenCalledTimes(1);
    // The only remaining timer wakes at local midnight; there is no exposure polling.
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      focused = false; window.dispatchEvent(new Event("blur"));
      focused = true; window.dispatchEvent(new Event("focus"));
    });
    expect(vi.getTimerCount()).toBe(1);
  });
  it("requires a new continuous foreground second after midnight with no remount", async () => {
    vi.setSystemTime(new Date(2026, 9, 19, 23, 59, 58));
    render(<Harness />);
    await advance(1000);
    expect(recordProFunnelStep).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(recordProFunnelStep).toHaveBeenCalledTimes(1);
    await advance(750);
    expect(recordProFunnelStep).toHaveBeenCalledTimes(1);
    await advance(250);
    expect(recordProFunnelStep).toHaveBeenCalledTimes(2);
  });

  it("waits for foreground return on the next day, without background timers", async () => {
    vi.setSystemTime(new Date(2026, 9, 19, 12));
    render(<Harness />);
    await advance(1000);
    act(() => { focused = false; hidden = true; window.dispatchEvent(new Event("blur")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    await advance(1000);
    expect(recordProFunnelStep).toHaveBeenCalledTimes(1);
    act(() => { focused = true; hidden = false; window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    await advance(750);
    expect(recordProFunnelStep).toHaveBeenCalledTimes(1);
    await advance(250);
    expect(recordProFunnelStep).toHaveBeenCalledTimes(2);
  });
  it("excludes signed-out, disabled/preview and unmounted surfaces", async () => {
    const view = render(<Harness enabled={false} />);
    await advance(2000);
    view.rerender(<Harness enabled={false} />);
    await advance(2000);
    view.rerender(<Harness />);
    await advance(750);
    view.unmount();
    await advance(2000);
    expect(recordProFunnelStep).not.toHaveBeenCalled();
  });
  it("ignores a visible chart shell without an actual rendered classified block", async () => {
    render(<Harness hasResult={false} />);
    await advance(2000);
    expect(recordProFunnelStep).not.toHaveBeenCalled();
  });
  it("does not count a result behind an unrelated modal", async () => {
    render(<><Harness /><section aria-modal="true">Upgrade offer</section></>);
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{ width: 300 }] as unknown as DOMRectList);
    await advance(2000);
    expect(recordProFunnelStep).not.toHaveBeenCalled();
  });
  it("starts a fresh visible exposure while a revoked delivery is still pending", async () => {
    const pending: Array<(ok: boolean) => void> = [];
    const deliver = vi.fn(() => new Promise<boolean>((resolve) => { pending.push(resolve); }));
    vi.mocked(recordProFunnelStep).mockImplementation(createProFunnelRecorder(deliver, readProductAnalyticsRevision));
    render(<Harness />);
    await advance(1000);
    expect(deliver).toHaveBeenCalledTimes(1);
    act(() => { writeProductAnalyticsEnabled(false); writeProductAnalyticsEnabled(true); });
    await advance(1000);
    expect(deliver).toHaveBeenCalledTimes(2);
    await act(async () => { pending[0](false); });
    await act(async () => { pending[1](true); });
    await advance(2000);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it("requires a fresh exposure after analytics is enabled", async () => {
    writeProductAnalyticsEnabled(false);
    const intervals = vi.spyOn(window, "setInterval");
    render(<Harness />);
    expect(intervals).not.toHaveBeenCalled();
    await advance(2000);
    expect(recordProFunnelStep).not.toHaveBeenCalled();
    act(() => { writeProductAnalyticsEnabled(true); });
    expect(intervals).toHaveBeenCalledOnce();
    expect(intervals).toHaveBeenCalledWith(expect.any(Function), 250);
    await advance(750);
    expect(recordProFunnelStep).not.toHaveBeenCalled();
    await advance(250);
    expect(recordProFunnelStep).toHaveBeenCalledWith({ step: "classified_result_viewed", dashboard_period: "day" });
  });
});
