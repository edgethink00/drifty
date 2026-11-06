import { useState } from "react";
import type { ScreenContextClient } from "../screen-context/screenContextClient";
import { ScreenReplayViewer } from "../screen-context/ScreenReplayViewer";
import type { ChatToolStep } from "./chatTypes";
import { memoryEvidence } from "./chatMemory";

const APPS: Record<string, string> = { "com.apple.TextEdit": "TextEdit", "com.apple.Preview": "Preview", "com.microsoft.VSCode": "VS Code", "com.tinyspeck.slackmacgap": "Slack", "com.hnc.Discord": "Discord", "com.todesktop.230313mzl4w4u92": "Cursor", "com.openai.codex": "ChatGPT", "com.cmuxterm.app": "cmux", "com.microsoft.Powerpoint": "PowerPoint", "at.studio.AsideBrowser": "Aside", "com.google.Chrome": "Chrome" };

export function ChatMemorySources({ tools, client, korean, onForgetMemory }: { readonly tools: readonly ChatToolStep[]; readonly client?: ScreenContextClient; readonly korean: boolean; readonly onForgetMemory?: (recordId: string) => Promise<void> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const evidence = memoryEvidence(tools).filter((source) => source.expiresAt > Date.now());
  if (!client || evidence.length === 0) return null;
  const title = korean ? "기억의 원본" : "Memory sources";
  return <div className="chat-memory-sources ph-no-capture">
    <span className="chat-answer__note">{title}</span>
    {evidence.map((source) => <button key={source.id} className="settings-inline-link" type="button" onClick={() => setSelected(source.id)}>
      {APPS[source.app] ?? source.app} · {new Date(source.observedAt).toLocaleString(korean ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
    </button>)}
    {selected ? <ScreenReplayViewer client={client} source={{ kind: "evidence", recordId: selected }} title={title} onForgetMemory={onForgetMemory} initialRecordId={selected} onClose={() => setSelected(null)} onInvalidated={() => setSelected(null)} /> : null}
  </div>;
}
