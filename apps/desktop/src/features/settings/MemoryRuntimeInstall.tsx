import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Status = { phase: "missing" | "downloading" | "verifying" | "ready" | "failed" | "unsupported"; received: number; total: number };
export function MemoryRuntimeInstall({ ko, onReady }: { ko: boolean; onReady: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () => void invoke<Status>("memory_runtime_status").then((next) => {
      if (!live) return;
      setStatus(next);
      if (next.phase === "ready") onReady();
    }).catch(() => { if (live) setFailed(true); });
    read();
    const timer = setInterval(read, 1000);
    return () => { live = false; clearInterval(timer); };
  }, [onReady]);
  const working = busy || status?.phase === "downloading" || status?.phase === "verifying";
  const install = async () => {
    if (working) return;
    setBusy(true); setFailed(false);
    try { await invoke("memory_runtime_install"); onReady(); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  };
  const downloading = status?.phase === "downloading";
  const percent = status?.total ? Math.min(100, Math.floor(status.received / status.total * 100)) : 0;
  return <div className="settings-row">
    <div className="memory-settings__grow">
      <div className="lbl">{ko ? "기억 엔진" : "Memory engine"}</div>
      <div className="desc" role="status">
        {status?.phase === "unsupported" ? (ko ? "Apple Silicon과 macOS 14 이상이 필요해요." : "Requires Apple Silicon and macOS 14 or later.")
          : failed || status?.phase === "failed" ? (ko ? "내려받지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요." : "Couldn't install. Check your connection and try again.")
          : status?.phase === "verifying" ? (ko ? "안전하게 설치할 수 있는 파일인지 확인하고 있어요." : "Verifying the download.")
          : downloading ? (ko ? `내려받는 중 · ${percent}%` : `Downloading · ${percent}%`)
          : ko ? "처음 한 번 내려받아요. 검색 모델은 기억을 켤 때 별도로 받아요." : "Download once. The search model downloads separately when you turn memory on."}
      </div>
      {downloading && <progress aria-label={ko ? "기억 엔진 다운로드" : "Memory engine download"} value={status.received} max={status.total} />}
    </div>
    <div className="ctrl"><button type="button" className="settings-btn" disabled={working || !status || status.phase === "unsupported"} onClick={() => void install()}>
      {working ? (ko ? "설치 중…" : "Installing…") : failed || status?.phase === "failed" ? (ko ? "다시 시도" : "Try again") : (ko ? "내려받기" : "Download")}
    </button></div>
  </div>;
}
