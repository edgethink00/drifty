import { describe, it, expect } from "vitest";
import { formatFocusDuration, escapeXml, renderFocusBadgeSvg, FOCUS_GREEN, AWAY_GREY } from "./badgeSvg";

describe("formatFocusDuration", () => {
  it("renders hours and minutes", () => {
    expect(formatFocusDuration(20 * 3600 + 59 * 60)).toBe("20h 59m");
  });
  it("renders minutes only under an hour", () => {
    expect(formatFocusDuration(59 * 60)).toBe("59m");
  });
  it("rounds to the nearest minute", () => {
    expect(formatFocusDuration(89)).toBe("1m");
    expect(formatFocusDuration(29)).toBe("0m");
  });
  it("treats null/negative/NaN as zero", () => {
    expect(formatFocusDuration(null)).toBe("0m");
    expect(formatFocusDuration(undefined)).toBe("0m");
    expect(formatFocusDuration(-100)).toBe("0m");
    expect(formatFocusDuration(Number.NaN)).toBe("0m");
  });
});

describe("escapeXml", () => {
  it("escapes markup and quotes", () => {
    expect(escapeXml(`<a href="x" data='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; data=&apos;y&apos;&gt;&amp;&lt;/a&gt;");
  });
});

describe("renderFocusBadgeSvg", () => {
  it("embeds the label and value with an aria-label", () => {
    const svg = renderFocusBadgeSvg({ value: "20h 59m" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(`aria-label="focus: 20h 59m"`);
    expect(svg).toContain("20h 59m");
    expect(svg).toContain(FOCUS_GREEN);
  });

  it("scales width with the value text length", () => {
    const short = renderFocusBadgeSvg({ value: "1m" });
    const long = renderFocusBadgeSvg({ value: "148h 22m" });
    const widthOf = (svg: string) => Number(/width="(\d+)"/.exec(svg)?.[1]);
    expect(widthOf(long)).toBeGreaterThan(widthOf(short));
  });

  it("uses the away grey accent when passed", () => {
    const svg = renderFocusBadgeSvg({ value: "—", accent: AWAY_GREY });
    expect(svg).toContain(AWAY_GREY);
    expect(svg).toContain("—"); // literal em dash preserved for the away state
  });

  it("darkens the label background for the dark theme", () => {
    expect(renderFocusBadgeSvg({ value: "3h", theme: "dark" })).toContain("#23271f");
    expect(renderFocusBadgeSvg({ value: "3h", theme: "light" })).toContain("#4b514a");
  });

  it("escapes hostile label/value input", () => {
    const svg = renderFocusBadgeSvg({ label: "<script>", value: `"&'` });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});
