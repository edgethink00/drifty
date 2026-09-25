import { describe, expect, it, vi } from "vitest";
import { createDeveloperDiagnosticsSync } from "./developerDiagnosticsSync";

function createDeferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("createDeveloperDiagnosticsSync", () => {
  it("sends a value once however often it is requested", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const sync = createDeveloperDiagnosticsSync(send, vi.fn());

    for (let render = 0; render < 20; render += 1) {
      sync.request({ enhancedContextEnabled: true });
      await flush();
    }

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a value that is still in flight", async () => {
    const first = createDeferred();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const sync = createDeveloperDiagnosticsSync(send, vi.fn());

    sync.request({ enhancedContextEnabled: true });
    await flush();
    sync.request({ enhancedContextEnabled: true });
    sync.request({ enhancedContextEnabled: true });
    first.resolve();
    await flush();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends a change made during a send after it, in order", async () => {
    const first = createDeferred();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const sync = createDeveloperDiagnosticsSync(send, vi.fn());

    sync.request({ forceChromiumAxCapture: false });
    await flush();
    sync.request({ forceChromiumAxCapture: true });
    await flush();
    expect(send).toHaveBeenCalledTimes(1);

    first.resolve();
    await flush();

    expect(send.mock.calls.map(([settings]) => settings)).toEqual([
      { forceChromiumAxCapture: false },
      { forceChromiumAxCapture: true },
    ]);
  });

  it("sends a value again after switching away and back", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const sync = createDeveloperDiagnosticsSync(send, vi.fn());

    for (const enabled of [true, false, true]) {
      sync.request({ enhancedContextEnabled: enabled });
      await flush();
    }

    expect(send).toHaveBeenCalledTimes(3);
  });

  it("retries a failed value on the next request, not on its own", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("tracker busy")).mockResolvedValue(undefined);
    const onError = vi.fn();
    const sync = createDeveloperDiagnosticsSync(send, onError);

    sync.request({ enhancedContextEnabled: true });
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);

    sync.request({ enhancedContextEnabled: true });
    await flush();
    sync.request({ enhancedContextEnabled: true });
    await flush();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("confirms an unchanged value again once a minute, not on every request", async () => {
    let nowMs = 0;
    const send = vi.fn().mockResolvedValue(undefined);
    const sync = createDeveloperDiagnosticsSync(send, vi.fn(), { now: () => nowMs });

    sync.request({ enhancedContextEnabled: true });
    await flush();
    nowMs = 59_000;
    sync.request({ enhancedContextEnabled: true });
    await flush();
    expect(send).toHaveBeenCalledTimes(1);

    nowMs = 60_000;
    sync.request({ enhancedContextEnabled: true });
    await flush();
    sync.request({ enhancedContextEnabled: true });
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
