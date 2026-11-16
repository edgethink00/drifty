import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import { decodeMemoryStatus } from "../screen-context/memoryWire";
import type { ScreenContextClient } from "../screen-context/screenContextClient";

/**
 * Memory rides on the agent skill (2026-11-16): the one "Add to agent" skill runs
 * `drifty memory ...`, which the app answers only while automatic memory is on. This
 * line says which state the person is in. See docs/architecture/automatic-memory.md.
 */
export function MemoryAgentsLine({ on, onOpenMemory }: { readonly on: boolean; readonly onOpenMemory: () => void }) {
  const { t } = useLocalization();
  return (
    <div className="desc developer-memory-line" data-setting-id="settings.developer.memoryAgents">
      <span className={"developer-memory-dot" + (on ? " is-on" : "")} aria-hidden="true" />
      <span>
        {on ? t("settings.developer.memoryAgentsOn") : (
          <>
            {t("settings.developer.memoryAgentsOff")}{" "}
            <button type="button" className="settings-inline-link" onClick={onOpenMemory}>{t("settings.developer.memoryAgentsOpen")}</button>
          </>
        )}
      </span>
    </div>
  );
}

const NO_CLIENT = { subscribe: () => () => undefined, getSnapshot: () => null };

/** Whether automatic memory is on for the bound account; null until read or without memory. */
export function useMemoryOnForAgents(client: ScreenContextClient | null): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const source = client ?? NO_CLIENT;
  const generation = useSyncExternalStore(source.subscribe, source.getSnapshot)?.generation ?? 0;
  useEffect(() => {
    if (!client) { setEnabled(null); return; }
    let current = true;
    // A read cut short by an account or connection change keeps the last answer; the
    // new generation reads again.
    void client.consume("memory_get_status", {}, decodeMemoryStatus, (value) => {
      if (current) setEnabled(value.preferences.enabled);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [client, generation]);
  return enabled;
}

/** Browser review only: `?memoryAgents=on|off` forces the state. */
export function memoryAgentsScenario(search: string, enabled = import.meta.env.DEV): boolean | null {
  if (!enabled) return null;
  const value = new URLSearchParams(search).get("memoryAgents");
  return value === "on" ? true : value === "off" ? false : null;
}
