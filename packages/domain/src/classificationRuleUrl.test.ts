import { describe, expect, it } from "vitest";
import { canonicalizeClassificationRuleSiteUrl, siteTargetFromCanonicalUrl } from "./classificationRuleUrl";

describe("canonicalizeClassificationRuleSiteUrl", () => {
  it("strips credentials, fragments, root slash, and noisy query keys while preserving useful query keys", () => {
    expect(canonicalizeClassificationRuleSiteUrl("https://user:pass@example.com/work/plan?token=secret&view=compact#section")).toBe("https://example.com/work/plan?view=compact");
    expect(canonicalizeClassificationRuleSiteUrl("https://example.com/?utm_source=newsletter")).toBe("https://example.com");
    expect(canonicalizeClassificationRuleSiteUrl("example.com:8443/work/plan?token=secret&view=compact#section")).toBe("https://example.com:8443/work/plan?view=compact");
  });

  it("normalizes YouTube watch, shorts, playlist, and youtu.be URLs", () => {
    expect(canonicalizeClassificationRuleSiteUrl("https://www.youtube.com/watch?v=ABC123&t=90s&utm_source=share")).toBe("https://youtube.com/watch?v=ABC123");
    expect(canonicalizeClassificationRuleSiteUrl("https://youtu.be/ABC123?si=sharetoken")).toBe("https://youtube.com/watch?v=ABC123");
    expect(canonicalizeClassificationRuleSiteUrl("https://www.youtube.com/shorts/ABC123?feature=share")).toBe("https://youtube.com/shorts/ABC123");
    expect(canonicalizeClassificationRuleSiteUrl("https://www.youtube.com/playlist?list=PL123&utm_campaign=x")).toBe("https://youtube.com/playlist?list=PL123");
  });

  it("normalizes ordinary URLs and rejects invalid or internal URLs without throwing", () => {
    expect(canonicalizeClassificationRuleSiteUrl("https://www.lichess.org/training/123?utm_source=x#comments")).toBe("https://lichess.org/training/123");
    expect(canonicalizeClassificationRuleSiteUrl("https://example.com:bad/work")).toBeNull();
    expect(canonicalizeClassificationRuleSiteUrl("chrome://newtab")).toBeNull();
    expect(canonicalizeClassificationRuleSiteUrl("not a url")).toBeNull();
  });
});

describe("siteTargetFromCanonicalUrl", () => {
  it("extracts the canonical host for site rule target values", () => {
    expect(siteTargetFromCanonicalUrl("https://youtube.com/watch?v=ABC123")).toBe("youtube.com");
    expect(siteTargetFromCanonicalUrl("https://lichess.org/training/123")).toBe("lichess.org");
  });
});
