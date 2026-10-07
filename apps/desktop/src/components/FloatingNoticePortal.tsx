import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./FloatingNoticePortal.css";

const hosts = new WeakMap<Document, { element: HTMLDivElement; users: number }>();

/** One top-right lane keeps concurrent app notices from covering each other. */
export function FloatingNoticePortal({ children }: { readonly children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (typeof document === "undefined") return undefined;
    let entry = hosts.get(document);
    if (!entry) {
      const element = document.createElement("div");
      element.className = "floating-notice-stack";
      document.body.appendChild(element);
      entry = { element, users: 0 };
      hosts.set(document, entry);
    }
    entry.users += 1;
    setHost(entry.element);
    return () => {
      entry.users -= 1;
      if (entry.users === 0) { entry.element.remove(); hosts.delete(document); }
    };
  }, []);
  return host ? createPortal(children, host) : null;
}
