import { vi } from "vitest";

// jsdom has no IntersectionObserver. This mock lets tests drive the
// infinite-scroll behaviour by firing observed sentinels as intersecting.
class MockIntersectionObserver {
  static active = new Set<MockIntersectionObserver>();

  private readonly elements = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(element: Element): void {
    this.elements.add(element);
    MockIntersectionObserver.active.add(this);
  }

  unobserve(element: Element): void {
    this.elements.delete(element);
    if (this.elements.size === 0) MockIntersectionObserver.active.delete(this);
  }

  disconnect(): void {
    this.elements.clear();
    MockIntersectionObserver.active.delete(this);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  fire(isIntersecting: boolean): void {
    const entries = Array.from(this.elements, (target) => ({
      isIntersecting,
      target,
    }) as IntersectionObserverEntry);
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

export function installMockIntersectionObserver(): void {
  MockIntersectionObserver.active.clear();
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
}

export function fireIntersection(isIntersecting = true): void {
  for (const observer of Array.from(MockIntersectionObserver.active)) {
    observer.fire(isIntersecting);
  }
}
