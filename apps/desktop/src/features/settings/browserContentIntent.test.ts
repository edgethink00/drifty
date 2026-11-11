import { describe, expect, it, vi } from "vitest";
import { createBrowserContentIntent } from "./browserContentIntent";

describe("browser content permission", () => {
  it("revokes on OFF without waiting for an already sent ON confirmation", async () => {
    const prepare = vi.fn(async (enabled: boolean) => enabled ? "on-generation" : "off-generation");
    const intent = createBrowserContentIntent(true, prepare);
    intent.request(true);
    await vi.waitFor(() => expect(intent.getSnapshot().generation).toBe("on-generation"));
    expect(intent.getSnapshot().status).toBe("pending");

    intent.request(false);
    await vi.waitFor(() => expect(intent.getSnapshot().status).toBe("applied"));
    expect(prepare.mock.calls).toEqual([[true], [false]]);
    intent.finishOn("on-generation", true);
    expect(intent.getSnapshot()).toEqual({ enabled: false, generation: "off-generation", status: "applied" });
  });

  it("does not report a failed OFF as applied and retries only the current choice", async () => {
    const prepare = vi.fn<(enabled: boolean) => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("file unavailable"))
      .mockResolvedValueOnce("off-retry");
    const intent = createBrowserContentIntent(false, prepare);
    intent.request(false);
    await vi.waitFor(() => expect(intent.getSnapshot().status).toBe("failed"));
    intent.request(false);
    expect(prepare).toHaveBeenCalledTimes(1);
    intent.retry();
    await vi.waitFor(() => expect(intent.getSnapshot().status).toBe("applied"));
    expect(prepare.mock.calls).toEqual([[false], [false]]);
  });

  it("keeps ON pending until the corresponding SQLite update is confirmed", async () => {
    let generation = 0;
    const intent = createBrowserContentIntent(false, async () => String(++generation));
    intent.request(false);
    await vi.waitFor(() => expect(intent.getSnapshot().status).toBe("applied"));
    intent.request(true);
    await vi.waitFor(() => expect(intent.getSnapshot().generation).toBe("2"));
    intent.finishOn("1", true);
    expect(intent.getSnapshot().status).toBe("pending");
    intent.finishOn("2", false);
    expect(intent.getSnapshot().status).toBe("failed");
    intent.finishOn("2", true);
    expect(intent.getSnapshot().status).toBe("applied");
  });
});
