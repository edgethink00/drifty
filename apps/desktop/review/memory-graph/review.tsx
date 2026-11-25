import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationTestProvider } from "../../src/features/localization/LocalizationContext";
import { MemoryPage } from "../../src/features/memory/MemoryPage";
import { createMemoryPreviewClient } from "../../src/features/memory/memoryPreview";
import { graphReviewDatasets, graphReviewPages, type GraphReviewDataset } from "./fixture";
import "../../src/styles.css";
import "./review.css";

const variants = [
  { id: "before", name: "수정 전", hint: "이전 연결 규칙과 제목 표시 방식입니다." },
  { id: "overview", name: "A · 정돈된 전체", hint: "노드를 선택하면 직접 연결과 페이지 상세를 볼 수 있습니다." },
] as const;

function Review() {
  const [variant, setVariant] = useState<"before" | "overview">(() =>
    new URLSearchParams(location.search).get("variant") === "before" ? "before" : "overview");
  const [dataset, setDataset] = useState<GraphReviewDataset>(() =>
    new URLSearchParams(location.search).get("dataset") === "dense" ? "dense" : "small");
  const active = variants.find((item) => item.id === variant);
  const client = useMemo(() => createMemoryPreviewClient(true, "on", Date.now, graphReviewPages(Date.now(), dataset)), [dataset]);
  const [settings, setSettings] = useState(false);

  return (
    <LocalizationTestProvider>
      <div className="memory-review">
        <header className="memory-review__header">
          <div>
            <h1>Memory 그래프 비교</h1>
            <p>합성 데이터 · Drifty Memory 화면</p>
          </div>
          <nav className="memory-review__choices" aria-label="비교할 그래프">
            {variants.map((item) => <button key={item.id} type="button" aria-pressed={item.id === variant} onClick={() => setVariant(item.id)}>{item.name}</button>)}
          </nav>
        </header>
        <div className="memory-review__scope">
          <p>{dataset === "dense" && variant === "overview" ? "가운데 ‘Sandlight 운영 점검 허브’를 눌러 연결을 확인하세요." : active?.hint}</p>
          <div className="memory-review__choices" role="group" aria-label="그래프 예시 데이터">
            {(["small", "dense"] as const).map((sample) => {
              const { label, pages } = graphReviewDatasets[sample];
              return <button key={sample} type="button" aria-pressed={dataset === sample} onClick={() => setDataset(sample)}>{label} · {pages}개</button>;
            })}
          </div>
        </div>
        <main className="memory-review__app">
          <MemoryPage key={dataset} client={client} graphPreview={variant} onOpenSettings={() => setSettings(true)} />
        </main>
        {settings && <div className="memory-review__notice" role="status">
          이 비교에서는 합성 데이터와 그래프 탐색을 사용합니다.
          <button type="button" onClick={() => setSettings(false)}>닫기</button>
        </div>}
      </div>
    </LocalizationTestProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Review />);
