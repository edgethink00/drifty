import type { MemoryWikiPage } from "../screen-context/memoryWire";
import type { WikiKind } from "./memoryWikiModel";

/** Bundle IDs the wiki records, shown by their app names. */
export const APP_NAMES: Record<string, string> = { "com.apple.TextEdit": "TextEdit", "com.apple.Preview": "Preview", "com.microsoft.VSCode": "VS Code", "com.tinyspeck.slackmacgap": "Slack", "com.hnc.Discord": "Discord", "com.todesktop.230313mzl4w4u92": "Cursor", "com.openai.codex": "ChatGPT", "com.cmuxterm.app": "cmux", "com.microsoft.Powerpoint": "PowerPoint", "at.studio.AsideBrowser": "Aside", "com.google.Chrome": "Chrome" };

export function appName(app: string): string {
  return APP_NAMES[app] ?? app;
}

const DAY = 86_400_000;
function dayStart(ms: number): number {
  const day = new Date(ms); day.setHours(0, 0, 0, 0); return day.getTime();
}

/**
 * One vocabulary for every view. A remembered sentence is a "memory"; a
 * stretch of work is a "session" in the flow; a page gathers the memories
 * about one project, person or topic. Only "updated today" is marked in colour.
 */
export const MEMORY_COPY = {
  ko: {
    nav: "기억", title: "기억", views: "보기", flow: "흐름", pages: "페이지", graph: "그래프", manage: "관리", settings: "기억 설정",
    kinds: { project: "프로젝트", person: "사람", topic: "주제" } as Record<WikiKind, string>,
    groups: { project: "프로젝트", person: "사람", topic: "주제" } as Record<WikiKind, string>,
    pageList: "페이지 목록", sessionList: "작업 흐름", search: "기억 검색", findPlaceholder: "기억에서 찾기", noMatch: "맞는 페이지가 없어요.", noSession: "맞는 작업이 없어요.",
    nowTitle: "지금", nowDoing: "하고 있는 일", nowWaiting: "기다리는 일", nowDone: "최근 끝낸 일",
    meTitle: "나에 대해", meRole: "하는 일", meOwns: "맡고 있는 일", mePeople: "함께 일하는 사람",
    meUpdated: (time: string) => time + " 정리 · 최근 2주 기억으로 하루에 한 번 다시 써요",
    myNote: "내 메모", myNoteAdd: "내 메모 추가", myNoteEdit: "메모 고치기",
    myNotePlaceholder: "이 페이지에 덧붙일 생각이나 할 일을 적어 두세요. 자동 정리는 이 메모를 바꾸지 않아요.",
    myNoteSave: "저장", myNoteSaved: "메모를 저장했어요.", myNoteCleared: "메모를 지웠어요.",
    myNoteUpdated: (time: string) => time + " 수정", myNoteLimit: (left: number) => left + "자 남음",
    nowUpdated: (time: string) => time + " 정리",
    off: "자동 기억 꺼짐",
    turnOn: "켜기", unsupported: "이 컴퓨터에서는 자동 기억을 쓸 수 없어요.",
    loading: "기억을 불러오는 중…", failed: "기억을 불러오지 못했어요.", retry: "다시 시도",
    emptyOffTitle: "일하는 동안 본 내용을 자동으로 정리해 둬요",
    emptyOffBody: "고른 업무 앱의 보이는 창을 읽어 작업 흐름과 프로젝트·사람·주제별 페이지로 정리해요. 메모를 따로 쓸 필요가 없어요. 원본 화면은 24시간 뒤 지워지고, 기억은 직접 지울 때까지 남아요.",
    emptyOffAction: "설정에서 기억 켜기",
    emptyOnTitle: "아직 정리된 기억이 없어요", emptyOnBody: "고른 앱에서 일하면 작업 흐름과 페이지가 자동으로 채워져요.",
    clock: (ms: number) => new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    day: (ms: number, now: Date) => {
      const date = new Date(ms).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" }).replace(/\((.)\)/, "$1");
      const today = dayStart(now.getTime());
      return ms >= today ? "오늘 · " + date : ms >= today - DAY ? "어제 · " + date : date;
    },
    dayShort: (ms: number, now: Date) => {
      const today = dayStart(now.getTime());
      return ms >= today ? "오늘" : ms >= today - DAY ? "어제" : new Date(ms).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
    },
    sessions: (count: number) => "작업 " + count,
    periods: { today: "오늘", week: "이번 주", all: "전체" },
    period: "기간",
    remembered: "여기서 기억한 것",
    originals: "원본 화면",
    changed: "바뀜", changedLater: "이후 바뀜",
    openSession: (title: string) => "작업 열기: " + title,
    updated: (time: string) => time + " 업데이트", lines: (count: number) => "기억 " + count + "개",
    updatedToday: "오늘 업데이트", earlier: (count: number) => "이전 내용 " + count + "개",
    ask: "채팅에서 묻기", openPage: "페이지 열기", showInGraph: "그래프에서 보기", allPages: "모든 페이지",
    deletePage: "페이지 삭제", deleteLine: "이 기억 지우기", deleteShort: "삭제",
    confirmPage: (title: string) => "‘" + title + "’ 페이지를 지울까요? 원본 화면과 활동 기록은 남아요.",
    confirmDelete: "지우기", cancel: "취소",
    original: "원본 보기", orphans: "교체된 이전 내용", replacedAt: (time: string) => time + "에 교체",
    linked: "이어진 페이지", content: "기억",
    lineDetail: "기억 상세", closeDetail: "상세 닫기",
    history: "변경 이력",
    originalKept: (hours: number) => "원본 화면은 " + hours + "시간 동안만 보관돼요.",
    originalGone: "원본 화면은 보관 기간이 지나 지워졌어요.",
    filters: "기억 거르기", filterAll: "전체", filterToday: "오늘", filterEarlier: "이전 내용 있음",
    colText: "내용", colPage: "페이지", colSource: "출처", colTime: "시각",
    selectLine: (text: string) => "선택: " + text, selectAll: "보이는 기억 모두 선택",
    selected: (count: number) => count + "개 선택됨", clearSelection: "선택 해제",
    confirmLines: (count: number) => count + "개를 지울까요? 원본 화면은 그대로예요.",
    linesDeleted: (count: number) => count + "개를 지웠어요. 원본 화면은 그대로예요.", listEmpty: "맞는 기억이 없어요.",
    graphLabel: (pages: number, links: number) => "페이지 " + pages + "개와 연결 " + links + "개로 된 기억 그래프",
    zoomIn: "확대", zoomOut: "축소", zoomFit: "전체 보기", closePanel: "닫기", more: "더 보기", back: "뒤로", forward: "앞으로", resizePanel: "문서 너비 조절",
    evidence: "근거", pending: "새로 들어온 기억",
    cite: (number: number) => "근거 " + number + " 보기", goneLink: (title: string) => title + " 페이지는 지워졌어요",
    copyMarkdown: "마크다운으로 복사", copied: "마크다운으로 복사했어요.", copyFailed: "복사하지 못했어요.",
    exact: (ms: number) => new Date(ms).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }),
    lineDeleted: "기억을 지웠어요. 원본 화면은 그대로예요.", pageDeleted: "페이지를 지웠어요.", forgotten: "이 출처의 기억을 잊었어요.",
    changeFailed: "변경하지 못했어요. 잠시 뒤 다시 시도해 주세요.", viewerTitle: "기억의 원본",
    askPrompt: (page: MemoryWikiPage) => page.kind === "person" ? page.title + "와 관련해서 최근에 무슨 일이 있었는지 알려줘"
      : page.kind === "topic" ? page.title + "에 대해 기억하는 내용을 정리해줘" : page.title + " 지금 상태가 어때?",
  },
  en: {
    nav: "Memory", title: "Work memory", views: "View", flow: "Flow", pages: "Pages", graph: "Graph", manage: "Manage", settings: "Memory settings",
    kinds: { project: "Project", person: "Person", topic: "Topic" } as Record<WikiKind, string>,
    groups: { project: "Projects", person: "People", topic: "Topics" } as Record<WikiKind, string>,
    pageList: "Pages", sessionList: "Work flow", search: "Search memory", findPlaceholder: "Find in memory", noMatch: "No matching pages.", noSession: "No matching sessions.",
    nowTitle: "Now", nowDoing: "In progress", nowWaiting: "Waiting on", nowDone: "Recently done",
    meTitle: "About me", meRole: "What I do", meOwns: "What I lead", mePeople: "Who I work with",
    meUpdated: (time: string) => "Written " + time + " · rewritten daily from the last two weeks of memories",
    myNote: "My note", myNoteAdd: "Add my note", myNoteEdit: "Edit note",
    myNotePlaceholder: "Your own thoughts or to-dos for this page. Automatic rewrites never change this note.",
    myNoteSave: "Save", myNoteSaved: "Note saved.", myNoteCleared: "Note removed.",
    myNoteUpdated: (time: string) => "Edited " + time, myNoteLimit: (left: number) => left + " characters left",
    nowUpdated: (time: string) => "Written " + time,
    off: "Automatic memory off",
    turnOn: "Turn on", unsupported: "Automatic memory isn’t available on this computer.",
    loading: "Loading memory…", failed: "Couldn’t load memory.", retry: "Try again",
    emptyOffTitle: "Keep what you saw while working, organized for you",
    emptyOffBody: "Drifty reads visible windows of the work apps you choose and organizes them into a work flow and pages by project, person and topic. No notes required. Original screens are deleted after 24 hours; memories stay until you delete them.",
    emptyOffAction: "Turn on memory in Settings",
    emptyOnTitle: "Nothing remembered yet", emptyOnBody: "As you work in the chosen apps, the flow and pages fill in on their own.",
    clock: (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    day: (ms: number, now: Date) => {
      const date = new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const today = dayStart(now.getTime());
      return ms >= today ? "Today · " + date : ms >= today - DAY ? "Yesterday · " + date : date;
    },
    dayShort: (ms: number, now: Date) => {
      const today = dayStart(now.getTime());
      return ms >= today ? "Today" : ms >= today - DAY ? "Yesterday" : new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    },
    sessions: (count: number) => count === 1 ? "1 session" : count + " sessions",
    periods: { today: "Today", week: "This week", all: "All" },
    period: "Period",
    remembered: "Remembered here",
    originals: "Original screens",
    changed: "Changed", changedLater: "Changed since",
    openSession: (title: string) => "Open session: " + title,
    updated: (time: string) => "Updated " + time, lines: (count: number) => count === 1 ? "1 memory" : count + " memories",
    updatedToday: "Updated today", earlier: (count: number) => count === 1 ? "1 earlier version" : count + " earlier versions",
    ask: "Ask in Chat", openPage: "Open page", showInGraph: "Show in graph", allPages: "All pages",
    deletePage: "Delete page", deleteLine: "Delete this memory", deleteShort: "Delete",
    confirmPage: (title: string) => "Delete the “" + title + "” page? Original screens and activity stay.",
    confirmDelete: "Delete", cancel: "Cancel",
    original: "View original", orphans: "Earlier, replaced memories", replacedAt: (time: string) => "replaced " + time,
    linked: "Linked pages", content: "Memories",
    lineDetail: "Memory details", closeDetail: "Close details",
    history: "History",
    originalKept: (hours: number) => "Original screens are kept for " + hours + " hours only.",
    originalGone: "The original screen was deleted after its retention period.",
    filters: "Filter memories", filterAll: "All", filterToday: "Today", filterEarlier: "Has earlier versions",
    colText: "Memory", colPage: "Page", colSource: "Source", colTime: "Time",
    selectLine: (text: string) => "Select: " + text, selectAll: "Select all visible memories",
    selected: (count: number) => count === 1 ? "1 selected" : count + " selected", clearSelection: "Clear selection",
    confirmLines: (count: number) => (count === 1 ? "Delete 1 memory?" : "Delete " + count + " memories?") + " Original screens stay.",
    linesDeleted: (count: number) => (count === 1 ? "1 memory deleted." : count + " memories deleted.") + " Original screens stay.", listEmpty: "No matching memories.",
    graphLabel: (pages: number, links: number) => "Memory graph of " + pages + " pages and " + links + " links",
    zoomIn: "Zoom in", zoomOut: "Zoom out", zoomFit: "Fit to view", closePanel: "Close", more: "More", back: "Back", forward: "Forward", resizePanel: "Resize document",
    evidence: "Evidence", pending: "Newly remembered",
    cite: (number: number) => "Show evidence " + number, goneLink: (title: string) => "The " + title + " page was deleted",
    copyMarkdown: "Copy as Markdown", copied: "Copied as Markdown.", copyFailed: "Couldn’t copy.",
    exact: (ms: number) => new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
    lineDeleted: "Memory deleted. The original screen stays.", pageDeleted: "Page deleted.", forgotten: "Memories from this source were forgotten.",
    changeFailed: "Couldn’t make the change. Try again in a moment.", viewerTitle: "Memory source",
    askPrompt: (page: MemoryWikiPage) => page.kind === "person" ? "What has happened recently with " + page.title + "?"
      : page.kind === "topic" ? "Summarize what you remember about " + page.title + "." : "What is the current status of " + page.title + "?",
  },
};
export type MemoryCopy = typeof MEMORY_COPY.ko;
