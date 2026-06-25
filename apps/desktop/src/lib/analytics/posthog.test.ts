import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const posthogSource = readFileSync(new URL("./posthog.ts", import.meta.url), "utf8");

describe("PostHog desktop analytics privacy boundary", () => {
  it("uses an anonymous session id without account identify calls", () => {
    expect(posthogSource).toContain("const anonymousSessionDistinctId = createDistinctId();");
    expect(posthogSource).toContain("distinct_id: anonymousSessionDistinctId");
    expect(posthogSource).toContain("\"$process_person_profile\": false");
    expect(posthogSource).not.toContain("drifty.posthog.distinctId");
    expect(posthogSource).not.toContain("window.localStorage");
    expect(posthogSource).not.toContain("\"$identify\"");
    expect(posthogSource).not.toContain("\"$anon_distinct_id\"");
    expect(posthogSource).not.toContain("\"$set\"");
  });
});
