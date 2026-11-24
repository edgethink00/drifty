import type { ScreenContextStatus } from "@drifty/domain";
import type { MemoryStatus } from "../screen-context/memoryWire";

/** Capture, extraction and query reservations are distinct facts, never a billing estimate. */
export function MemoryActivityStatus({ status, capture, ko, now = Date.now() }: {
  readonly status: MemoryStatus; readonly capture: ScreenContextStatus | null; readonly ko: boolean; readonly now?: number;
}) {
  const d = status.diagnostics;
  const time = (ms: number | null | undefined) => ms == null ? (ko ? "아직 없음" : "Not yet")
    : new Date(ms).toLocaleString(ko ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
  const fresh = d !== null && now - d.as_of_ms <= 15000 && d.as_of_ms <= now + 5000;
  const phases = {
    unavailable: ["기억 엔진에 연결하지 못했어요.", "Memory engine is unavailable."],
    extracting: ["화면 내용에서 기억을 만들고 있어요.", "Extracting memories from a screen."],
    limited: ["추출 요청 한도에 도달해 기다리고 있어요.", "Waiting for the extraction request limit to reset."],
    retrying: ["추출에 실패해 한 번 더 시도할 예정이에요.", "An extraction failed; one retry is scheduled."],
    pending: ["새 화면의 추출을 기다리고 있어요.", "Waiting to extract a new screen."],
    failed: ["추출에 실패한 화면이 있어요. 자동 재시도는 끝났어요.", "Some screens failed extraction and have no retries left."],
    ready: ["처리가 끝났어요. 새 화면을 기다리고 있어요.", "Processing is complete. Waiting for new screens."],
    waiting_for_source: ["아직 기억에 사용할 화면이 없어요.", "No screens are available for memory yet."],
  };
  const message = capture?.paused || capture?.globalPaused || capture && !capture.preferences.enabled
    ? ko ? "화면 기록이 멈춰 있어 새 기억을 만들지 않아요." : "Screen recording is paused or off; new memories are not being created."
    : status.error === "memory_credentials_required" ? ko ? "AI 연결에서 Drifty Cloud나 Anthropic 키를 확인해 주세요." : "Check Drifty Cloud or your Anthropic key in AI connection."
    : status.error ? ko ? "기억 상태를 확인하지 못했어요. AI 연결과 화면 기록을 확인해 주세요." : "Memory is unavailable. Check AI connections and screen recording."
    : !fresh ? ko ? "최신 처리 상태를 확인하고 있어요." : "Checking the latest processing status."
    : phases[d.phase][ko ? 0 : 1];
  return <div className="memory-activity-status">
    <p className="desc" role="status">{message}</p>
    <p className="desc">{ko ? "마지막 화면 저장" : "Last screen saved"}: {time(capture?.lastAcceptedAtMs)}<br />
      {ko ? "최근 기억 입력" : "Latest memory input"}: {time(d?.last_source_at_ms)}<br />
      {ko ? "마지막 추출 완료" : "Last extraction completed"}: {time(d?.last_extracted_at_ms)}</p>
    {d && <>
      <p className="desc">{ko ? `원본 ${status.sources}개 · 기억 ${d.facts}개 · 처리 중 ${d.running}개 · 대기 ${d.waiting}개 · 재시도 종료 ${d.exhausted}개`
        : `${status.sources} sources · ${d.facts} memories · ${d.running} processing · ${d.waiting} waiting · ${d.exhausted} exhausted`}</p>
      <p className="desc">{ko ? "요청 횟수 (실패 포함, 청구액과 다름)" : "Request reservations (including failures, not billing)"}<br />
        {ko ? "추출" : "Extraction"}: {d.writes_hour}/{d.writes_hour_limit} ({ko ? "시간당" : "per hour"}), {d.writes_day}/{d.writes_day_limit} ({ko ? "일일 한도" : "daily limit"}) · {ko ? "검색" : "Search"}: {d.queries_hour}/{d.queries_hour_limit}<br />
        {ko ? "시간 한도 초기화" : "Hourly reset"}: {time(d.hour_resets_at_ms)} · {ko ? "일일 한도 초기화" : "Daily reset"}: {time(d.day_resets_at_ms)}
        {d.next_attempt_at_ms !== null && <><br />{ko ? "다음 추출 가능 시각" : "Next extraction eligible"}: {time(d.next_attempt_at_ms)}</>}
      </p>
      {!fresh && <p className="desc">{ko ? "위 처리 수치는 마지막 확인 시점 기준이에요" : "Processing counts are from the last update"}: {time(d.as_of_ms)}</p>}
    </>}
    {/* An excluded app or a browser page off the work-site list is skipped by choice, not a failure. */}
    {capture?.lastFailure && capture.lastFailure !== "excluded" && <p className="desc">{ko ? "최근 화면 수집이 완료되지 않았어요. 화면 기록 설정에서 권한·제외·일시정지 상태를 확인해 주세요." : "The latest screen capture did not complete. Check permissions, exclusions and pause in screen recording settings."}</p>}
  </div>;
}
