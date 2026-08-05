// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeferredPageImportFallback } from "./DeferredPageImportFallback";

describe("DeferredPageImportFallback", () => {
  it("announces the deferred surface while its chunk loads", () => {
    render(<DeferredPageImportFallback label="projects" />);

    expect(screen.getByRole("status", { name: "Loading projects" })).toBeTruthy();
    expect(screen.getByText("Loading projects...")).toBeTruthy();
  });
});
