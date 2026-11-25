import type { PreviewPage } from "../../src/features/memory/memoryPreview";

const work = [
  ["Sandlight 화면 기록 권한 요청 흐름 수정 비교", "project", "Sandlight 권한 안내를 닫고 다시 열었을 때 문구와 버튼을 비교했다.", [1, 9, 10]],
  ["Sandlight 시작 화면 녹화 안내 문구 검토", "project", "Sandlight 첫 실행에서 승인 전후의 문구를 기록했다.", [9]],
  ["Sandlight 도움말 도메인과 문서 경로 정리", "project", "Sandlight 도움말에서 주소 이동과 검색 결과를 확인했다.", [8]],
  ["Sandlight 실행 도구 실험 결과 비교", "project", "Sandlight 실행 도구가 읽는 설정을 샘플 계정에서 비교했다.", [4, 11]],
  ["Sandlight 다른 기기에서 메모리 로드 지연 진단", "project", "Sandlight 창을 다시 열었을 때 로드 순서를 점검했다.", [11]],
  ["Sandlight 홈 화면 제목 후보 검토", "project", "Sandlight 첫 화면에서 사용한 한국어 문구 길이를 확인했다.", [2]],
  ["Sandlight 로그인 메일 링크 재발송 흐름", "project", "Sandlight 메일에서 재발송 간격을 확인했다.", [7]],
  ["Sandlight 미리보기 배포 및 테스트 계정 준비", "project", "Sandlight 미리보기에서 새 계정과 기존 계정을 검증했다.", [10, 12]],
  ["Sandlight 공개 저장소와 배포 파일 색인", "topic", "Sandlight 다운로드 문서의 링크와 색인 여부를 정리했다.", [7]],
  ["macOS 화면 기록 권한", "topic", "앱을 다시 시작해야 하는 경우와 승인 위치를 정리했다.", []],
  ["윤하늘", "person", "권한 흐름과 계정 준비의 검토를 맡았다.", []],
  ["로컬 요약 모델 비교", "topic", "짧은 문서와 긴 문서의 요약 결과를 비교했다.", []],
  ["배포 전 확인 항목", "topic", "지원 문서와 설치 상태를 확인하는 순서를 정리했다.", [2]],
  ["푸른섬 연구 환경 가동률 조사", "project", "실험 장비의 시간대별 사용량을 정리했다.", []],
  ["가을 데모 참가 일정", "topic", "참가 신청 일정과 발표 시간을 확인했다.", []],
  ["최다온", "person", "다음 모델 비교에 쓸 검토 기준을 정리했다.", [11]],
  ["초록숲 데이터 정리 및 다음 실험 준비", "project", "이전 결과를 정리하고 검토를 요청했다.", [15]],
  ["세미나 발표 자료 최종 확인", "topic", "발표 전에 도표와 인용 문구를 확인했다.", []],
] as const;

export function graphReviewPages(now: number): PreviewPage[] {
  return work.map(([title, kind, text, related], i) => {
    const id = (i + 1).toString(16).padStart(12, "a");
    const updated = now - (i < 3 ? i + 1 : 32 + i) * 3_600_000;
    const summary = related.map((other) => "[[" + work[other][0] + "]]");
    const lineId = (index: number) => (i * 3 + index + 1).toString(16).padStart(12, "b");
    const lines = [text, "확인한 내용을 예시 문서에 정리했다.", "다음 검토에서 결과를 다시 확인한다."];
    return {
      id, kind, title: [title, title],
      lines: lines.map((line, j) => ({
        id: lineId(j), text: [line, line], app: "com.apple.TextEdit",
        source: null, created: updated - j * 600_000, status: "current",
      })),
      doc: {
        summary: [{ text: [text, text], lines: [lineId(0)] }],
        sections: summary.length === 0 ? [] : [{
          heading: ["연결된 페이지", "연결된 페이지"],
          points: summary.map((link) => ({ text: [link, link], lines: [lineId(0)] })),
        }],
        pending: [],
        compiled: updated,
      },
    };
  });
}
