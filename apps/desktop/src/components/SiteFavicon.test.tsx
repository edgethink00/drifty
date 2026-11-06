// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFavicon } from "./SiteFavicon";
import { SiteIconProvider } from "./SiteIconContext";
import type { SiteIconMap } from "../features/app-icons/siteIconRequests";

function renderWithIcons(icons: SiteIconMap, element: React.ReactElement) {
  return render(<SiteIconProvider value={icons}>{element}</SiteIconProvider>);
}

describe("SiteFavicon", () => {
  it("renders the locally cached icon without requesting a remote source", () => {
    renderWithIcons(
      { "example.com": "data:image/png;base64,cached" },
      <SiteFavicon domain="example.com" size={20} fallbackIconSrc="data:image/png;base64,abc" />,
    );

    const image = screen.getByRole("presentation");
    // The cache holds an icon, so it wins over the browser app icon.
    expect(image.getAttribute("src")).toBe("data:image/png;base64,cached");
  });

  it("falls back to the provided browser icon when the domain is not cached yet", () => {
    renderWithIcons(
      {},
      <SiteFavicon domain="example.com" size={20} fallbackIconSrc="data:image/png;base64,abc" />,
    );

    expect(screen.getByRole("presentation").getAttribute("src")).toBe("data:image/png;base64,abc");
  });

  it("shows the text glyph for a resolved miss with no browser icon", () => {
    // A null entry is a resolved miss: the domain has no usable icon.
    renderWithIcons({ "example.com": null }, <SiteFavicon domain="example.com" size={20} />);

    expect(screen.getByText("E")).toBeTruthy();
  });

  it("uses a lettered fallback for a prefiltered browser-internal domain", () => {
    const { container } = renderWithIcons({}, <SiteFavicon domain="newtab" size={20} />);

    const fallback = screen.getByText("N");
    expect(fallback.classList.contains("site-favicon")).toBe(true);
    expect(fallback.classList.contains("site-favicon--fallback")).toBe(true);
    expect(fallback.getAttribute("style")).toContain("width: 20px");
    expect(fallback.getAttribute("style")).toContain("height: 20px");
    expect(container.querySelector("img.site-favicon")).toBeNull();
  });

  it("never emits a remote image source", () => {
    const { container } = renderWithIcons(
      { "example.com": "data:image/png;base64,cached" },
      <SiteFavicon domain="example.com" size={20} />,
    );

    expect(container.querySelector('img[src^="http"]')).toBeNull();
  });
  it("shows the lettered placeholder when the icon image fails to load", () => {
    renderWithIcons({ "example.com": "data:image/png;base64,broken" }, <SiteFavicon domain="example.com" size={20} />);
    fireEvent.error(screen.getByRole("presentation"));
    expect(screen.queryByRole("presentation")).toBeNull();
    expect(document.querySelector(".site-favicon--fallback")?.textContent).toBe("E");
  });
});
