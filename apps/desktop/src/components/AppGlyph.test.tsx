// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppGlyph } from "./AppGlyph";

describe("AppGlyph", () => {
  it("falls back to initials when an app icon image fails to load", () => {
    const { container } = render(<AppGlyph appName="Visual Studio Code" iconSrc="./missing-icon.png" size="sm" />);

    const image = container.querySelector<HTMLImageElement>("img.app-icon");
    expect(image?.getAttribute("src")).toBe("./missing-icon.png");
    if (image === null) throw new Error("Expected AppGlyph to render an image before load failure");

    fireEvent.error(image);

    expect(container.querySelector("img.app-icon")).toBeNull();
    expect(screen.getByText("VS")).toBeTruthy();
  });
});
