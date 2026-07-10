import { describe, expect, it, vi } from "vitest";
import {
  applyRejectionAction,
  resolveRejectionAction,
  resolveRejectionPhase,
  type RejectionHandlerDom,
} from "./rejectionAction";

function createEvent() {
  return { preventDefault: vi.fn() };
}

function createDomMock() {
  const replaceChildren = vi.fn();
  const createErrorElement = vi.fn((title: string, message: string) => ({ title, message }) as unknown as HTMLElement);
  const showLateDiagnostic = vi.fn();
  const root = { replaceChildren };
  const dom: RejectionHandlerDom = {
    getRoot: vi.fn(() => root as unknown as HTMLElement),
    createErrorElement,
    showLateDiagnostic,
  };
  return { dom, root, createErrorElement, showLateDiagnostic };
}

describe("resolveRejectionPhase", () => {
  it("maps pre-bootstrap to startup", () => {
    expect(resolveRejectionPhase(false)).toBe("startup");
  });

  it("maps bootstrapped to runtime", () => {
    expect(resolveRejectionPhase(true)).toBe("runtime");
  });
});

describe("resolveRejectionAction", () => {
  describe("startup phase (not bootstrapped) — every surface is fatal", () => {
    (["app", "watcher", "drift-alarm", "privacy-review-concepts"] as const).forEach((surface) => {
      it(`treats a ${surface} rejection as startup-error`, () => {
        expect(resolveRejectionAction({ bootstrapped: false, surface })).toBe("startup-error");
      });
    });
  });

  describe("runtime phase (bootstrapped)", () => {
    it("preserves the main app tree", () => {
      expect(resolveRejectionAction({ bootstrapped: true, surface: "app" })).toBe("preserve");
    });

    it("preserves the privacy-review-concepts surface", () => {
      expect(resolveRejectionAction({ bootstrapped: true, surface: "privacy-review-concepts" })).toBe("preserve");
    });

    it("routes watcher to the late diagnostic", () => {
      expect(resolveRejectionAction({ bootstrapped: true, surface: "watcher" })).toBe("late-diagnostic");
    });

    it("routes drift-alarm to the late diagnostic", () => {
      expect(resolveRejectionAction({ bootstrapped: true, surface: "drift-alarm" })).toBe("late-diagnostic");
    });
  });
});

describe("applyRejectionAction", () => {
  it("preserves the root when action is preserve (regression: live main app must not be wiped)", () => {
    const { dom, root, createErrorElement, showLateDiagnostic } = createDomMock();
    const event = createEvent();

    applyRejectionAction("preserve", event, "boom", dom);

    expect(root.replaceChildren).not.toHaveBeenCalled();
    expect(dom.getRoot).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(showLateDiagnostic).not.toHaveBeenCalled();
    expect(createErrorElement).not.toHaveBeenCalled();
  });

  it("replaces #root with the startup error element on startup-error", () => {
    const { dom, root, createErrorElement } = createDomMock();
    const errorElement = { tagName: "DIV" } as unknown as HTMLElement;
    createErrorElement.mockReturnValue(errorElement);
    const event = createEvent();

    applyRejectionAction("startup-error", event, "fatal", dom);

    expect(createErrorElement).toHaveBeenCalledWith("Drifty startup error", "fatal");
    expect(root.replaceChildren).toHaveBeenCalledTimes(1);
    expect(root.replaceChildren).toHaveBeenCalledWith(errorElement);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("does not touch the DOM when #root is missing on startup-error", () => {
    const dom: RejectionHandlerDom = {
      getRoot: vi.fn(() => null),
      createErrorElement: vi.fn(),
      showLateDiagnostic: vi.fn(),
    };
    const event = createEvent();

    applyRejectionAction("startup-error", event, "fatal", dom);

    expect(dom.createErrorElement).not.toHaveBeenCalled();
    expect(dom.showLateDiagnostic).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("prevents default and shows the late diagnostic for companion windows", () => {
    const { dom, showLateDiagnostic, root } = createDomMock();
    const event = createEvent();

    applyRejectionAction("late-diagnostic", event, "late boom", dom);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(showLateDiagnostic).toHaveBeenCalledWith("late boom");
    expect(root.replaceChildren).not.toHaveBeenCalled();
  });
});
