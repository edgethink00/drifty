import { describe, expect, it, vi } from "vitest";
import { fetchUpdatePolicy, updatePolicyUrls } from "./updatePolicy";
import { createNativeUpdatePolicyFetch } from "./updatePolicyFetch";

const VERSION = "1.11.22";
const V2_POLICY = {
  version: VERSION,
  policyVersion: 2,
  urgency: "general",
  backgroundDownload: true,
  installBehavior: "next-launch",
  promptAfterHours: 72,
  autoInstall: false,
  message: "Test release.",
};

describe("native update policy fetch", () => {
  it("reads the published policy through the native command so a v2 release stays background-eligible", async () => {
    const invoke = vi.fn().mockResolvedValue(V2_POLICY);
    const policy = await fetchUpdatePolicy(VERSION, createNativeUpdatePolicyFetch(invoke), "macos");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("update_policy_fetch", { tag: VERSION, repository: "drifty" });
    expect(policy.backgroundDownloadEligible).toBe(true);
    expect(policy.installBehavior).toBe("next-launch");
  });

  it("does not read the Mac policy when the Windows release has no policy", async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const policy = await fetchUpdatePolicy(VERSION, createNativeUpdatePolicyFetch(invoke), "windows");
    expect(invoke.mock.calls.map((call) => call[1])).toEqual([
      { tag: `${VERSION}-win`, repository: "drifty" },
      { tag: `${VERSION}-win`, repository: "drifty_releases" },
    ]);
    expect(policy.urgency).toBe("general");
    expect(policy.message).toBeNull();
    expect(policy.installBehavior).toBe("manual");
  });

  it("uses the Windows release policy when it is present", async () => {
    const invoke = vi.fn().mockResolvedValue({
      ...V2_POLICY,
      backgroundDownload: false,
      installBehavior: "manual",
      message: "Windows update ready to install.",
    });
    const policy = await fetchUpdatePolicy(VERSION, createNativeUpdatePolicyFetch(invoke), "windows");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("update_policy_fetch", {
      tag: `${VERSION}-win`,
      repository: "drifty",
    });
    expect(policy.message).toBe("Windows update ready to install.");
    expect(policy.backgroundDownloadEligible).toBe(false);
    expect(policy.installBehavior).toBe("manual");
  });

  it("uses the legacy policy when the source repository has no matching policy", async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ ...V2_POLICY, version: "1.11.21" })
      .mockResolvedValueOnce(V2_POLICY);
    const policy = await fetchUpdatePolicy(VERSION, createNativeUpdatePolicyFetch(invoke), "macos");
    expect(invoke).toHaveBeenNthCalledWith(2, "update_policy_fetch", {
      tag: VERSION,
      repository: "drifty_releases",
    });
    expect(policy.backgroundDownloadEligible).toBe(true);
  });

  it("keeps the safe manual fallback when the native request fails", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("offline"));
    const policy = await fetchUpdatePolicy(VERSION, createNativeUpdatePolicyFetch(invoke), "macos");
    expect(policy.backgroundDownloadEligible).toBe(false);
    expect(policy.installBehavior).toBe("manual");
  });

  it("refuses any URL other than a release policy asset without invoking the command", async () => {
    const invoke = vi.fn();
    const nativeFetch = createNativeUpdatePolicyFetch(invoke);
    await expect(nativeFetch("https://example.com/update-policy.json")).rejects.toThrow("Unsupported update policy URL.");
    await expect(nativeFetch("https://github.com/edgethink00/drifty_releases/releases/latest/download/latest.json"))
      .rejects.toThrow("Unsupported update policy URL.");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("passes the decoded tag from the exact URLs the policy loader builds", async () => {
    const invoke = vi.fn().mockResolvedValue(V2_POLICY);
    const nativeFetch = createNativeUpdatePolicyFetch(invoke);
    for (const url of updatePolicyUrls(VERSION, "windows")) await nativeFetch(url);
    expect(invoke.mock.calls.map((call) => call[1])).toEqual([
      { tag: `${VERSION}-win`, repository: "drifty" },
      { tag: `${VERSION}-win`, repository: "drifty_releases" },
    ]);
  });

  it("rejects when the loader's timeout aborts a request that never settles", async () => {
    const invoke = vi.fn().mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = createNativeUpdatePolicyFetch(invoke)(updatePolicyUrls(VERSION)[0], { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
