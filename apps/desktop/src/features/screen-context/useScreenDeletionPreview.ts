import { useEffect, useState } from "react";
import type { ScreenDeletionPreview } from "@drifty/domain";
import type { ScreenContextClient } from "./screenContextClient";
import { decodeScreenDeletionPreview } from "./screenContextWire";

export type ScreenDeleteRange = "1" | "24" | "all";
export type ScreenDeletionPreviewResult = { readonly generation: number; readonly range: ScreenDeleteRange;
  readonly startMs: number | null; readonly endMs: number | null; readonly value: ScreenDeletionPreview };
export type ScreenDeletionPreviewState = { readonly current: ScreenDeletionPreviewResult | null; readonly failed: boolean; readonly retry: () => void };
type Preview = ScreenDeletionPreviewResult;

export function useScreenDeletionPreview(client: ScreenContextClient, open: boolean, range: ScreenDeleteRange, generation: number): ScreenDeletionPreviewState {
  const [result, setResult] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setResult(null); setFailed(false);
    if (!open) return;
    let active = true;
    const endMs = range === "all" ? null : Date.now();
    const startMs = endMs === null ? null : Math.max(0, endMs - Number(range) * 3_600_000);
    void client.consume("screen_context_preview_deletion", { startMs, endMs }, decodeScreenDeletionPreview, (value, replyGeneration) => {
      if (active) setResult({ generation: replyGeneration, range, startMs, endMs, value });
    }).catch(() => { if (active && client.isCurrent(generation)) setFailed(true); });
    return () => { active = false; };
  }, [client, open, range, generation, attempt]);
  const current = open && result?.range === range && result.generation === generation && client.canDisplay(generation) ? result : null;
  return { current, failed, retry: () => { setResult(null); setFailed(false); setAttempt(value => value + 1); } };
}
