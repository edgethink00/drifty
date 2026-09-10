import { describe, expect, it } from "vitest";
import { formatProfileLinkLabel } from "./ProfileModals";

describe("formatProfileLinkLabel", () => {
  it("reduces a website to its host so the chip stays scannable", () => {
    expect(formatProfileLinkLabel("website", "https://www.drifty.so/about")).toBe("drifty.so");
    expect(formatProfileLinkLabel("website", "drifty.so")).toBe("drifty.so");
  });

  it("uses each platform's own shorthand instead of a repeated domain", () => {
    expect(formatProfileLinkLabel("github", "https://github.com/drifty")).toBe("@drifty");
    expect(formatProfileLinkLabel("linkedin", "https://www.linkedin.com/in/alex-park")).toBe("in/alex-park");
    expect(formatProfileLinkLabel("linkedin", "https://linkedin.com/company/drifty")).toBe("in/drifty");
  });

  it("drops tracking suffixes that would push the handle out of the chip", () => {
    expect(formatProfileLinkLabel("github", "https://github.com/drifty?tab=repositories")).toBe("@drifty");
    expect(formatProfileLinkLabel("linkedin", "https://linkedin.com/in/alex/details/experience")).toBe("in/alex");
  });

  it("falls back to the plain text when the URL is not the expected shape", () => {
    expect(formatProfileLinkLabel("github", "https://gist.github.com")).toBe("gist.github.com");
    expect(formatProfileLinkLabel("linkedin", "https://linkedin.com")).toBe("linkedin.com");
    expect(formatProfileLinkLabel("github", "")).toBe("");
  });
});
