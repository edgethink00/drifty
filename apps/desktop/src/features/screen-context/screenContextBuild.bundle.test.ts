import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it.each(["included", "excluded"] as const)("enforces %s in compiled client code", async (mode) => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./screenContextClient.ts", import.meta.url))],
    bundle: true, platform: "node", format: "cjs", write: false,
    define: { __DRIFTY_SCREEN_CONTEXT_MODE__: JSON.stringify(mode) },
  });
  const module = { exports: {} as typeof import("./screenContextClient") };
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, setTimeout, clearTimeout, performance });
  const invoke = vi.fn(async () => false);
  const client = new module.exports.ScreenContextClient(invoke, true);
  client.setAccount(null);
  expect(client.isDesktop()).toBe(mode === "included");
  expect(await client.wasConfigured()).toBe(false);
  expect(await client.screenRecordingPermitted()).toBe(false);
  client.dispose();
  if (mode === "excluded") {
    await expect(client.connect()).rejects.toThrow("screen_context_account_unavailable");
    expect(invoke).not.toHaveBeenCalled();
  } else {
    expect(invoke).toHaveBeenCalledWith("screen_context_was_configured");
    expect(invoke).toHaveBeenCalledWith("screen_context_permission_status");
  }
});
