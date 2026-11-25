import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationTestProvider } from "../../src/features/localization/LocalizationContext";
import { MemoryPage } from "../../src/features/memory/MemoryPage";
import { createMemoryPreviewClient } from "../../src/features/memory/memoryPreview";
import type { GraphReview } from "../../src/features/memory/memoryGraphReview";
import { graphReviewPages } from "./fixture";
import "../../src/styles.css";
import "./review.css";

const variants = [
  { id: "before", name: "수정 전", hint: "현재 연결 규칙과 제목 표시 방식을 적용한 원본 그래프입니다." },
  { id: "overview", name: "A · 정돈된 전체", hint: "겹치지 않는 제목과 근거가 분명한 연결을 전체 지도에서 봅니다." },
  { id: "neighborhood", name: "B · 연결 탐색", hint: "노드를 선택해 바로 연결된 페이지를 보고, 필요하면 한 단계 더 펼칩니다." },
  { id: "types", name: "C · 유형 필터", hint: "프로젝트, 사람, 주제별로 지도를 좁히거나 전체 관계를 봅니다." },
] as const;
const kinds = [
  ["all", "전체"], ["project", "프로젝트"], ["person", "사람"], ["topic", "주제"],
] as const;

function Review() {
  const [variant, setVariant] = useState<GraphReview["variant"]>(() => {
    const value = new URLSearchParams(location.search).get("variant");
    return variants.find((item) => item.id === value)?.id ?? "before";
  });
  const [depth, setDepth] = useState<GraphReview["depth"]>(1);
  const [kind, setKind] = useState<GraphReview["kind"]>("all");
  const active = variants.find((item) => item.id === variant);
  const review = useMemo(() => ({ variant, depth, kind }), [variant, depth, kind]);
  const client = useMemo(() => createMemoryPreviewClient(true, "on", Date.now, graphReviewPages(Date.now())), []);
  const [settings, setSettings] = useState(false);

  return (
    <LocalizationTestProvider>
      <div className="memory-review">
        <header className="memory-review__header">
          <div>
            <h1>Memory 그래프 비교</h1>
            <p>합성 데이터 18페이지 · Drifty Memory 화면</p>
          </div>
          <nav className="memory-review__choices" aria-label="비교할 그래프">
            {variants.map((item) => <button key={item.id} type="button" aria-pressed={item.id === variant} onClick={() => setVariant(item.id)}>{item.name}</button>)}
          </nav>
        </header>
        <div className="memory-review__scope">
          <p>{active?.hint}</p>
          {variant === "neighborhood" && <div className="memory-review__choices" role="group" aria-label="연결 범위">
            {([1, 2] as const).map((step) => <button key={step} type="button" aria-pressed={depth === step} onClick={() => setDepth(step)}>{step}단계</button>)}
          </div>}
          {variant === "types" && <div className="memory-review__choices" role="group" aria-label="페이지 유형">
            {kinds.map(([value, label]) => <button key={value} type="button" data-kind={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>)}
          </div>}
        </div>
        <main className="memory-review__app">
          <MemoryPage client={client} graphReview={review} onOpenSettings={() => setSettings(true)} />
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
