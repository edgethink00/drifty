export type MenuArea = { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number };

const isSet = (value: string | null | undefined): boolean => Boolean(value) && value !== "none" && value !== "normal" && value !== "auto";
const clipsOverflow = (value: string): boolean => value === "hidden" || value === "auto" || value === "scroll" || value === "clip";

/** Whether an element anchors fixed-position descendants (and so lets its clipping boxes cut them). */
function anchorsFixedDescendants(style: CSSStyleDeclaration): boolean {
  const backdrop = style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter");
  return isSet(style.transform) || isSet(style.perspective) || isSet(style.filter) || isSet(backdrop)
    || /paint|layout|strict|content/.test(style.contain ?? "")
    || /transform|perspective|filter/.test(style.willChange ?? "");
}

/**
 * The part of the window where the floating menu can be seen. A fixed menu is
 * placed against the window and escapes scrolled lists, unless an ancestor (a
 * modal's blurred backdrop, a transform) anchors it: then every clipping box
 * up to that ancestor cuts it too, and the menu must stay inside them, or its
 * top hides under a dialog's header.
 */
export function visibleMenuArea(root: HTMLElement): MenuArea {
  const window_ = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
  const clips: DOMRect[] = [];
  for (let node = root.parentElement; node && node !== document.documentElement; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (clipsOverflow(style.overflowX) || clipsOverflow(style.overflowY)) clips.push(node.getBoundingClientRect());
    if (!anchorsFixedDescendants(style)) continue;
    const area = clips.reduce<MenuArea>((current, rect) => ({
      top: Math.max(current.top, rect.top),
      bottom: Math.min(current.bottom, rect.bottom),
      left: Math.max(current.left, rect.left),
      right: Math.min(current.right, rect.right),
    }), window_);
    // A box too small to hold a useful menu (or one not laid out yet) keeps the window.
    return area.bottom - area.top >= 96 && area.right - area.left >= 160 ? area : window_;
  }
  return window_;
}
