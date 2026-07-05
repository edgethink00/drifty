import { useEffect, useState } from "react";
import type { TabId } from "./navigation";

export function shouldDeferTabBody(tabId: TabId): boolean {
  return tabId === "history" || tabId === "trends";
}

export function useDeferredTabBodyReady(activeTab: TabId): boolean {
  const [readyTab, setReadyTab] = useState<TabId | null>(() => (shouldDeferTabBody(activeTab) ? null : activeTab));

  useEffect(() => {
    if (!shouldDeferTabBody(activeTab)) {
      setReadyTab(activeTab);
      return undefined;
    }

    setReadyTab(null);
    const timeoutId = window.setTimeout(() => setReadyTab(activeTab), 0);
    return () => window.clearTimeout(timeoutId);
  }, [activeTab]);

  return readyTab === activeTab;
}
