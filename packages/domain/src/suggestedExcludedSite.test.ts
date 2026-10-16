import { describe, expect, it } from "vitest";
import { suggestedExcludedSite } from "./activity";

describe("suggestedExcludedSite", () => {
  it("names the whole site for a subdomain, so its other addresses are covered too", () => {
    expect(suggestedExcludedSite("obank.kbstar.com")).toBe("kbstar.com");
    expect(suggestedExcludedSite("www.kbstar.com")).toBe("kbstar.com");
    expect(suggestedExcludedSite("kbstar.com")).toBe("kbstar.com");
    expect(suggestedExcludedSite("a.b.example.org")).toBe("example.org");
  });

  it("keeps the site's own label under a country registry", () => {
    expect(suggestedExcludedSite("www.hometax.go.kr")).toBe("hometax.go.kr");
    expect(suggestedExcludedSite("mybank.ibk.co.kr")).toBe("ibk.co.kr");
    expect(suggestedExcludedSite("news.bbc.co.uk")).toBe("bbc.co.uk");
    // A two-letter domain that is not a registry label stays two labels.
    expect(suggestedExcludedSite("login.naver.kr")).toBe("naver.kr");
  });

  it("treats each subdomain of a shared host as its own site", () => {
    expect(suggestedExcludedSite("docs.me.github.io")).toBe("me.github.io");
    expect(suggestedExcludedSite("someone.tistory.com")).toBe("someone.tistory.com");
    expect(suggestedExcludedSite("github.io")).toBe("github.io");
  });

  it("returns nothing for text that names no site", () => {
    expect(suggestedExcludedSite("localhost")).toBeNull();
    expect(suggestedExcludedSite("")).toBeNull();
    expect(suggestedExcludedSite(null)).toBeNull();
  });
});

