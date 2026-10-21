import { ACTIVITY_TIMELINE_CARD_PROMPT_VERSION, activityBlockLabelKey, type ActivityTimelineWindowRecord, type ActivitySegment } from "@drifty/domain";
import { localDateKey } from "../formatting";

/*
 * Timeline cards for the browser preview (?driftyPreview=1&previewCards=1):
 * the names the card generator would have written for the fixture days, so
 * the Day and Week surfaces can be reviewed with cards without a model. Each
 * card names a run of fixture records; its time is theirs.
 */

type PreviewCardSpec = readonly [segmentIds: readonly string[], en: readonly [title: string, description: string], ko: readonly [title: string, description: string]];

const TODAY: readonly PreviewCardSpec[] = [
  [["preview-t1"], ["Inbox triage", "Read the morning inbox."], ["받은편지함 정리", "아침 메일을 읽었다."]],
  [["preview-t2", "preview-t3", "preview-t4"], ["Dashboard page refactor", "Reworked DashboardPage and FlowChartView, checked pull request #284."], ["대시보드 페이지 리팩터링", "DashboardPage와 FlowChartView를 손보고 PR #284를 확인했다."]],
  [["preview-t5", "preview-t6", "preview-t7"], ["Category rhythm design", "Design-engineering thread, then the Category rhythm board in Figma."], ["카테고리 리듬 디자인", "디자인 엔지니어링 스레드를 보고 Figma에서 카테고리 리듬 보드를 작업했다."]],
  [["preview-t8"], ["Product teardown video", "Watched a product teardown on YouTube."], ["제품 분석 영상", "YouTube에서 제품 분석 영상을 봤다."]],
  [["preview-t9", "preview-t10"], ["App usage panel", "AppUsagePanel.tsx, with a short Messages exchange."], ["앱 사용 패널", "AppUsagePanel.tsx 작업, 중간에 Messages 대화."]],
  [["preview-t11"], ["Homepage crop options", "Homepage crop options in Figma."], ["홈페이지 크롭 옵션", "Figma에서 홈페이지 크롭 옵션을 다듬었다."]],
  [["preview-t12", "preview-t13"], ["Reddit and YouTube break", "r/productivity, then a short review on YouTube."], ["Reddit·YouTube 휴식", "r/productivity를 보고 YouTube 짧은 리뷰를 봤다."]],
  [["preview-t14"], ["Dashboard QA", "Dashboard QA in Visual Studio Code."], ["대시보드 QA", "Visual Studio Code에서 대시보드 QA."]],
  [["preview-t15", "preview-t16", "preview-t17"], ["Homepage demo build", "Checked the drifty.so homepage preview and built the homepage demo; launch replies on X."], ["홈페이지 데모 작업", "drifty.so 홈페이지 미리보기를 확인하고 데모를 만들었다. X 런치 답글."]],
  [["preview-t18", "preview-t19", "preview-t20"], ["Demo follow-up", "Demo follow-up in Linear and Visual Studio Code, then #launch-room."], ["데모 후속 작업", "Linear와 Visual Studio Code에서 데모 후속 작업, 이어서 #launch-room."]],
];

const WEEK: Readonly<Record<string, readonly PreviewCardSpec[]>> = {
  thu: [
    [["thu-mail"], ["Investor updates", "Investor updates in Mail."], ["투자자 업데이트", "Mail에서 투자자 업데이트를 읽었다."]],
    [["thu-code-a", "thu-github"], ["Billing entitlement", "billingService.ts, then the billing entitlement pull request review."], ["결제 권한 작업", "billingService.ts 작업, 이어서 결제 권한 PR 리뷰."]],
    [["thu-slack"], ["#launch-room check-in", "A check-in in #launch-room."], ["#launch-room 확인", "#launch-room을 확인했다."]],
    [["thu-figma"], ["Pricing empty states", "Pricing empty states in Figma."], ["가격 빈 상태 디자인", "Figma에서 가격 화면의 빈 상태를 작업했다."]],
    [["thu-linear"], ["AI setup copy (DTM-231)", "DTM-231 · AI setup copy in Linear."], ["AI 설정 문구 (DTM-231)", "Linear에서 DTM-231 AI 설정 문구."]],
    [["thu-code-b"], ["AI setup panel", "AiSetupPanel.tsx in Visual Studio Code."], ["AI 설정 패널", "Visual Studio Code에서 AiSetupPanel.tsx."]],
    [["thu-youtube"], ["WWDC recaps", "WWDC recaps on YouTube."], ["WWDC 요약 영상", "YouTube에서 WWDC 요약 영상을 봤다."]],
  ],
  wed: [
    [["wed-notion"], ["Release checklist", "The release checklist in Notion."], ["릴리스 체크리스트", "Notion에서 릴리스 체크리스트를 정리했다."]],
    [["wed-code-a", "wed-docs"], ["Week dashboard store", "WeekDashboard.tsx, with the tauri-plugin-store docs."], ["주간 대시보드 저장소", "WeekDashboard.tsx 작업, tauri-plugin-store 문서 참고."]],
    [["wed-spotify"], ["Deep Focus playlist", "Deep Focus on Spotify."], ["Deep Focus 재생목록", "Spotify에서 Deep Focus."]],
    [["wed-code-b"], ["Preview data fixtures", "previewData.ts in Visual Studio Code."], ["미리보기 데이터 픽스처", "Visual Studio Code에서 previewData.ts."]],
    [["wed-slack"], ["Design QA thread", "The design QA thread in Slack."], ["디자인 QA 스레드", "Slack 디자인 QA 스레드."]],
    [["wed-figma"], ["Homepage crop options", "Homepage crop options in Figma."], ["홈페이지 크롭 옵션", "Figma에서 홈페이지 크롭 옵션."]],
    [["wed-x"], ["Launch replies on X", "Launch replies on X."], ["X 런치 답글", "X에서 런치 답글을 달았다."]],
  ],
  tue: [
    [["tue-mail"], ["Feedback digest", "The feedback digest in Mail."], ["피드백 다이제스트", "Mail에서 피드백 다이제스트."]],
    [["tue-figma"], ["Cloud connected state", "Cloud connected state in Figma."], ["클라우드 연결 상태 디자인", "Figma에서 클라우드 연결 상태."]],
    [["tue-code-a", "tue-github"], ["AI unavailable state", "dashboardAiUnavailableState.ts, then Actions run #842."], ["AI 사용 불가 상태", "dashboardAiUnavailableState.ts, 이어서 Actions 실행 #842."]],
    [["tue-linear"], ["Visual regression triage", "Triage of visual regressions in Linear."], ["시각 회귀 분류", "Linear에서 시각 회귀를 분류했다."]],
    [["tue-code-b"], ["Flow hover groups", "flowHoverGroups.ts in Visual Studio Code."], ["플로우 호버 그룹", "Visual Studio Code에서 flowHoverGroups.ts."]],
    [["tue-reddit"], ["r/tauri browsing", "r/tauri on Reddit."], ["r/tauri 둘러보기", "Reddit r/tauri."]],
  ],
  mon: [
    [["mon-notion"], ["Weekly plan", "The weekly plan in Notion."], ["주간 계획", "Notion에서 주간 계획."]],
    [["mon-code-a"], ["Classification view data", "classificationViewData.ts in Visual Studio Code."], ["분류 뷰 데이터", "Visual Studio Code에서 classificationViewData.ts."]],
    [["mon-slack", "mon-stack"], ["#product and a sticky rail", "#product in Slack, then CSS grid sticky rail on Stack Overflow."], ["#product와 고정 레일", "Slack #product, 이어서 Stack Overflow에서 CSS grid 고정 레일."]],
    [["mon-code-b"], ["App usage panel", "AppUsagePanel.tsx in Visual Studio Code."], ["앱 사용 패널", "Visual Studio Code에서 AppUsagePanel.tsx."]],
    [["mon-figma"], ["Week calendar density", "Week calendar density in Figma."], ["주간 캘린더 밀도", "Figma에서 주간 캘린더 밀도."]],
    [["mon-youtube"], ["Desk setup review", "A desk setup review on YouTube."], ["책상 세팅 리뷰 영상", "YouTube에서 책상 세팅 리뷰."]],
  ],
};

const WEEK_OFFSETS: Readonly<Record<string, number>> = { thu: 1, wed: 2, tue: 3, mon: 4 };

/*
 * What the card generator's title evidence would name each fixture record, in
 * both card languages, so a card's detail log reads as activities (as stored
 * cards with details do) rather than bare app and site names. Records outside
 * every card keep their app name, as they do with real cards.
 */
const DETAILS: Readonly<Record<string, readonly [en: string, ko: string]>> = {
  "preview-t1": ["Morning inbox replies", "아침 메일 확인과 답장"],
  "preview-t2": ["DashboardPage layout cleanup", "DashboardPage 레이아웃 정리"],
  "preview-t3": ["Pull request #284 review", "PR #284 리뷰 확인"],
  "preview-t4": ["FlowChartView wiring", "FlowChartView 연결 수정"],
  "preview-t5": ["#design-engineering thread", "#design-engineering 스레드 읽기"],
  "preview-t6": ["Category rhythm board", "카테고리 리듬 보드 디자인"],
  "preview-t7": ["Launch replies on X", "X 런치 답글 확인"],
  "preview-t8": ["Product teardown video", "제품 분석 영상 시청"],
  "preview-t9": ["AppUsagePanel alignment fix", "AppUsagePanel 정렬 수정"],
  "preview-t10": ["Messages with Min", "Min과 메시지"],
  "preview-t11": ["Homepage crop options", "홈페이지 크롭 옵션 다듬기"],
  "preview-t12": ["r/productivity browsing", "r/productivity 둘러보기"],
  "preview-t13": ["Short review on YouTube", "YouTube 짧은 리뷰 영상"],
  "preview-t14": ["Dashboard QA fixes", "대시보드 QA와 버그 수정"],
  "preview-t15": ["drifty.so homepage preview", "drifty.so 홈페이지 미리보기 확인"],
  "preview-t16": ["Homepage demo build", "홈페이지 데모 빌드"],
  "preview-t17": ["Launch replies on X", "X 런치 답글"],
  "preview-t18": ["Demo follow-up issues", "Linear 데모 후속 이슈 정리"],
  "preview-t19": ["Demo feedback changes", "데모 피드백 반영"],
  "preview-t20": ["Update in #launch-room", "#launch-room 공유"],
  "thu-mail": ["Investor updates", "투자자 업데이트 읽기"],
  "thu-code-a": ["Billing entitlement logic", "billingService 결제 권한 로직"],
  "thu-github": ["Billing entitlement PR review", "결제 권한 PR 리뷰"],
  "thu-slack": ["#launch-room check-in", "#launch-room 확인"],
  "thu-figma": ["Pricing empty states", "가격 화면 빈 상태 디자인"],
  "thu-linear": ["DTM-231 AI setup copy", "DTM-231 AI 설정 문구 정리"],
  "thu-code-b": ["AiSetupPanel implementation", "AiSetupPanel 구현"],
  "thu-youtube": ["WWDC recap videos", "WWDC 요약 영상 시청"],
  "wed-notion": ["Release checklist", "릴리스 체크리스트 정리"],
  "wed-code-a": ["WeekDashboard persistence", "WeekDashboard 저장 로직"],
  "wed-docs": ["tauri-plugin-store docs", "tauri-plugin-store 문서 읽기"],
  "wed-spotify": ["Deep Focus playlist", "Deep Focus 재생목록"],
  "wed-code-b": ["Preview data fixtures", "미리보기 데이터 픽스처 작성"],
  "wed-slack": ["Design QA thread replies", "디자인 QA 스레드 답변"],
  "wed-figma": ["Homepage crop option drafts", "홈페이지 크롭 옵션 시안"],
  "wed-x": ["Launch replies on X", "X 런치 답글"],
  "tue-mail": ["Feedback digest", "피드백 다이제스트 읽기"],
  "tue-figma": ["Cloud connected state screens", "클라우드 연결 상태 화면"],
  "tue-code-a": ["AI unavailable state handling", "AI 사용 불가 상태 처리"],
  "tue-github": ["Actions run #842 check", "Actions 실행 #842 확인"],
  "tue-linear": ["Visual regression triage", "시각 회귀 이슈 분류"],
  "tue-code-b": ["Flow hover groups", "플로우 호버 그룹 수정"],
  "tue-reddit": ["r/tauri browsing", "r/tauri 둘러보기"],
  "mon-notion": ["Weekly plan", "주간 계획 작성"],
  "mon-code-a": ["Classification view data", "분류 뷰 데이터 정리"],
  "mon-slack": ["#product discussion", "#product 논의"],
  "mon-stack": ["CSS grid sticky rail answer", "CSS grid 고정 레일 해법 찾기"],
  "mon-code-b": ["AppUsagePanel work", "AppUsagePanel 작업"],
  "mon-figma": ["Week calendar density", "주간 캘린더 밀도 시안"],
  "mon-youtube": ["Desk setup review video", "책상 세팅 리뷰 영상"],
};
/** The preview's day boundary, the app's default. */
const PREVIEW_START_OF_DAY_MINUTES = 4 * 60;

function logicalDayOf(startedAt: string): string {
  const date = new Date(startedAt);
  date.setMinutes(date.getMinutes() - PREVIEW_START_OF_DAY_MINUTES);
  return localDateKey(date);
}

export function previewCardsRequested(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("previewCards") === "1";
}

/** AI card records for the fixture records, in both card languages. */
export function buildPreviewTimelineCards(segments: readonly ActivitySegment[]): ActivityTimelineWindowRecord[] {
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  const specs: Array<readonly [ids: readonly string[], spec: PreviewCardSpec]> = [
    ...TODAY.map((spec) => [spec[0], spec] as const),
    ...Object.entries(WEEK).flatMap(([set, list]) => list.map((spec) => [spec[0].map((id) => "preview-w" + WEEK_OFFSETS[set] + "-" + id), spec] as const)),
  ];
  const records: ActivityTimelineWindowRecord[] = [];
  for (const [ids, spec] of specs) {
    const found = ids.map((id) => byId.get(id)).filter((segment): segment is ActivitySegment => Boolean(segment));
    const base = new Map(ids.map((id, index) => [id, spec[0][index]!]));
    if (found.length === 0) continue;
    const starts = found.map((segment) => segment.startedAt).sort();
    const ends = found.map((segment) => segment.endedAt).sort();
    const startedAt = starts[0]!;
    const endedAt = ends[ends.length - 1]!;
    const logicalDay = logicalDayOf(startedAt);
    const segmentIds = found.map((segment) => segment.id);
    // The title names the card's longest record.
    const longest = [...found].sort((a, b) => b.durationSeconds - a.durationSeconds)[0]!.id;
    for (const [language, text] of [["en", spec[1]], ["ko", spec[2]]] as const) {
      const byActivity = new Map<string, string[]>();
      for (const id of segmentIds) {
        const names = DETAILS[base.get(id) ?? id];
        if (!names) continue;
        const activity = language === "en" ? names[0] : names[1];
        byActivity.set(activity, [...(byActivity.get(activity) ?? []), id]);
      }
      const details = [...byActivity].map(([activity, ids]) => ({ activity, segmentIds: ids, named: ids.includes(longest) }));
      records.push({
        windowKey: activityBlockLabelKey(logicalDay, segmentIds) + ":" + language,
        logicalDay,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        language,
        model: "preview",
        provider: "preview",
        promptVersion: ACTIVITY_TIMELINE_CARD_PROMPT_VERSION,
        createdAt: new Date(endedAt).toISOString(),
        cards: [{ position: 0, startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(),
          segmentIds, status: "ready", variant: "strict", title: text[0], description: text[1], details }],
      });
    }
  }
  return records;
}
