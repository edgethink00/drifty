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
    focused = false;
    await advance(250);
    focused = true; hidden = true;
    await advance(1500);
    hidden = false; occluded = true;
    await advance(1500);
    expect(recordProFunnelStep).not.toHaveBeenCalled();
    occluded = false;
    await advance(1000);
    expect(recordProFunnelStep).not.toHaveBeenCalled();
    await advance(250);
    expect(recordProFunnelStep).toHaveBeenCalledTimes(1);
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
    const { writeProductAnalyticsEnabled } = await import("./productAnalyticsPreference");
    writeProductAnalyticsEnabled(false);
    render(<Harness />);
    await advance(2000);
    expect(recordProFunnelStep).not.toHaveBeenCalled();
    act(() => { writeProductAnalyticsEnabled(true); });
    await advance(750);
    expect(recordProFunnelStep).not.toHaveBeenCalled();
    await advance(250);
    expect(recordProFunnelStep).toHaveBeenCalledWith({ step: "classified_result_viewed", dashboard_period: "day" });
  });
});
