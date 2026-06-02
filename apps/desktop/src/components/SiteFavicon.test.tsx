// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFavicon } from "./SiteFavicon";

describe("SiteFavicon", () => {
  it("falls back to the provided browser icon before showing a text glyph", () => {
    render(<SiteFavicon domain="example.com" size={20} fallbackIconSrc="data:image/png;base64,abc" />);

    const image = screen.getByRole("presentation");
    expect(image.getAttribute("src")).toBe("https://www.google.com/s2/favicons?domain=example.com&sz=64");

    fireEvent.error(image);
    expect(screen.getByRole("presentation").getAttribute("src")).toBe("data:image/png;base64,abc");
  });

  it("shows the text fallback only after all image sources fail", () => {
    render(<SiteFavicon domain="example.com" size={20} fallbackIconSrc="data:image/png;base64,abc" />);

    fireEvent.error(screen.getByRole("presentation"));
    fireEvent.error(screen.getByRole("presentation"));

    expect(screen.getByText("E")).toBeTruthy();
  });
});
