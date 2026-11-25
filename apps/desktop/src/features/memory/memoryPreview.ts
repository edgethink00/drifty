import { ScreenContextClient } from "../screen-context/screenContextClient";
import { CROWD_NOTES } from "./memoryPreviewNotes";
import type { InstallProgress, MemoryInstaller } from "./memoryInstaller";

/**
 * Browser review only (preview data mode): a screen-context client whose
 * native side is a small in-memory stand-in with the synthetic Juniper work
 * used in VM QA. It answers the same commands the Memory page and the screen
 * viewer use, so deleting, forgetting and opening originals behave as they do
 * in the app. Nothing here reads real activity or screens.
 */
/**
 * "many" adds synthetic pages so the graph can be reviewed at a realistic density;
 * "setup" is memory off with screen recording paused and no OpenRouter key, for
 * reviewing what Settings asks for before memory can start. "start" is a first
 * start on a fresh Mac: nothing downloaded, recording not yet allowed; allowing
 * it reloads the page the way macOS quits and reopens Drifty.
 * "paused" is memory on while screen recording is paused, so the Memory page
 * says why it cannot load; resuming recording in Settings loads it again.
 */
export type MemoryPreviewState = "on" | "off" | "empty" | "many" | "setup" | "start" | "paused";

const LEASE = "0f0e0d0c-0b0a-4908-8706-050403020100";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Text = readonly [en: string, ko: string];
type PreviewLine = { id: string; text: Text; status: "current" | "past"; app: string; source: string | null; created: number; replaced?: number; replaces?: string };
type PreviewPoint = { text: Text; lines: string[] };
/** A page's written document; pending lists memories that arrived after it was written. */
type PreviewDoc = { summary: PreviewPoint[]; sections: { heading: Text; points: PreviewPoint[] }[]; compiled: number; pending: string[] };
export type PreviewPage = {
  id: string; title: Text; kind: "project" | "person" | "topic"; lines: PreviewLine[]; doc?: PreviewDoc | null;
  /** A document taken down by a removal, back once "rewritten" a few seconds later. */
  rewrite?: { doc: PreviewDoc | null; at: number };
  /** The person's own note; the preview keeps it in the language it was written in. */
  note?: { text: string; updated: number };
};
type PreviewSource = { id: string; app: string; observed: number; terminal?: boolean; text: string };
/** A written note for one session of the flow, by the exact lines it was written from. */
type PreviewNote = { lineIds: string[]; title: Text; summary: PreviewPoint[]; points: PreviewPoint[] };
/** The "now" page, by section; it cites only current lines, as the engine writes it. */
type PreviewNow = { doing: PreviewPoint[]; waiting: PreviewPoint[]; done: PreviewPoint[]; compiled: number };
/** The "about me" page, by section, cited like "now". */
type PreviewMe = { role: PreviewPoint[]; owns: PreviewPoint[]; people: PreviewPoint[]; compiled: number };

const CHROME = "com.google.Chrome";
const TEXTEDIT = "com.apple.TextEdit";
const PREVIEW_APP = "com.apple.Preview";
const CMUX = "com.cmuxterm.app";
const SLACK = "com.tinyspeck.slackmacgap";

function scenario(now: number): { pages: PreviewPage[]; sources: PreviewSource[]; notes: PreviewNote[]; now: PreviewNow | null; me: PreviewMe | null } {
  const ago = (minutes: number) => now - minutes * MINUTE;
  const yesterday = (hour: number, minute: number) => {
    const day = new Date(now); day.setDate(day.getDate() - 1); day.setHours(hour, minute, 0, 0); return day.getTime();
  };
  const sources: PreviewSource[] = [
    { id: "6f1c2a3b-4d5e-4f60-8a7b-1c2d3e4f5a60", app: CMUX, observed: ago(95), terminal: true,
      text: "$ ./deploy.sh staging\nexport API_KEY=[redacted]\ndry run passed 42/42\nprod cutover: waiting for Hana's approval (Thu)" },
    { id: "6f1c2a3b-4d5e-4f60-8a7b-1c2d3e4f5a61", app: CHROME, observed: ago(61),
      text: "Juniper release notes (synthetic)\nStaging smoke test passed 18/18.\nRelease is blocked on the billing webhook fix owned by Theo.\nTarget date not agreed yet." },
    { id: "6f1c2a3b-4d5e-4f60-8a7b-1c2d3e4f5a62", app: CHROME, observed: ago(59),
      text: "Juniper release update (synthetic)\nTheo shipped the billing webhook fix on Tuesday.\nThe release target date is now Friday, pending sign-off from Mira." },
    { id: "6f1c2a3b-4d5e-4f60-8a7b-1c2d3e4f5a63", app: CHROME, observed: ago(10),
      text: "Juniper release sign-off (synthetic)\nMira signed off on Thursday.\nThe release target date moved to Monday so support can staff the launch." },
    { id: "6f1c2a3b-4d5e-4f60-8a7b-1c2d3e4f5a64", app: SLACK, observed: ago(24),
      text: "#juniper-release (synthetic)\nMira: Support is short-staffed on Friday.\nMira: Let's move the Juniper launch to Monday." },
  ];
  const [deploy, notes, update, signoff, thread] = sources.map((source) => source.id);
  const pages: PreviewPage[] = [
    { id: "a10000000001", kind: "project", title: ["Juniper release", "Juniper 릴리스"], lines: [
      { id: "b10000000007", status: "current", app: CHROME, source: signoff, created: ago(9), replaces: "b10000000003",
        text: ["The target date moved to Monday so support can staff the launch; Mira signed off.", "목표일이 월요일로 옮겨졌어요. 지원팀 인력 배치 때문이고 Mira가 승인했어요."] },
      { id: "b10000000008", status: "current", app: CHROME, source: signoff, created: ago(4),
        text: ["Mira signed off on the release on Thursday.", "Mira가 목요일에 릴리스를 승인했어요."] },
      { id: "b10000000009", status: "current", app: SLACK, source: thread, created: ago(23),
        text: ["Support is short-staffed on Friday, so Mira proposed moving the launch to Monday in Slack.", "금요일엔 지원팀이 비어서 출시를 월요일로 옮기자고 Mira가 Slack에서 제안했어요."] },
      { id: "b10000000006", status: "current", app: CHROME, source: update, created: ago(58), replaces: "b10000000002",
        text: ["Theo shipped the billing webhook fix on Tuesday, which unblocked the release.", "Theo가 결제 웹훅 수정을 화요일에 배포해 릴리스 차단이 풀렸어요."] },
      { id: "b10000000001", status: "current", app: CHROME, source: notes, created: ago(60),
        text: ["Staging smoke test passed 18/18.", "스테이징 스모크 테스트 18/18 통과."] },
      { id: "b10000000003", status: "past", app: CHROME, source: update, created: ago(58), replaced: ago(9), replaces: "b10000000004",
        text: ["The target date is Friday, pending sign-off from Mira.", "목표일은 금요일, Mira 승인 대기."] },
      { id: "b10000000004", status: "past", app: CHROME, source: notes, created: ago(60), replaced: ago(58),
        text: ["The target date has not been agreed yet.", "목표일은 아직 정해지지 않았어요."] },
      { id: "b10000000002", status: "past", app: CHROME, source: notes, created: ago(60), replaced: ago(58),
        text: ["The release is blocked on the billing webhook fix, owned by Theo.", "결제 웹훅 수정을 기다리느라 릴리스가 막혀 있어요 (담당 Theo)."] },
    ] },
    { id: "a10000000002", kind: "person", title: ["Mira", "Mira"], lines: [
      { id: "b20000000001", status: "current", app: CHROME, source: signoff, created: ago(9),
        text: ["Signed off on the Juniper release on Thursday.", "Juniper 릴리스를 목요일에 승인했어요."] },
      { id: "b20000000002", status: "current", app: TEXTEDIT, source: null, created: yesterday(14, 2),
        text: ["Owns the final review of the Atlas CSV export.", "Atlas CSV 내보내기 최종 검토 담당이에요."] },
    ] },
    { id: "a10000000003", kind: "person", title: ["Theo", "Theo"], lines: [
      { id: "b30000000002", status: "current", app: CHROME, source: update, created: ago(58), replaces: "b30000000001",
        text: ["Owns the billing webhook fix and shipped it on Tuesday.", "결제 웹훅 수정 담당이고 화요일에 배포했어요."] },
      { id: "b30000000001", status: "past", app: CHROME, source: notes, created: ago(60), replaced: ago(58),
        text: ["Working on the billing webhook fix.", "결제 웹훅 수정 진행 중이에요."] },
    ] },
    { id: "a10000000004", kind: "topic", title: ["Billing webhook", "결제 웹훅"], lines: [
      { id: "b40000000001", status: "current", app: CHROME, source: update, created: ago(58),
        text: ["The fix shipped on Tuesday and unblocked the Juniper release.", "화요일에 수정이 배포돼 Juniper 릴리스의 차단이 풀렸어요."] },
    ] },
    { id: "a10000000005", kind: "project", title: ["Staging deploy", "스테이징 배포"], lines: [
      { id: "b50000000001", status: "current", app: CMUX, source: deploy, created: ago(94),
        text: ["The dry run passed 42/42; the prod cutover waits for Hana's approval on Thursday.", "드라이런 42/42 통과. 운영 전환은 목요일 Hana 승인을 기다려요."] },
    ] },
    { id: "a10000000006", kind: "person", title: ["Hana", "Hana"], lines: [
      { id: "b60000000001", status: "current", app: CMUX, source: deploy, created: ago(94),
        text: ["Approves the prod cutover of the staging deploy on Thursday.", "목요일에 스테이징 배포의 운영 전환을 승인해요."] },
    ] },
    { id: "a10000000007", kind: "project", title: ["Atlas CSV export", "Atlas CSV 내보내기"], lines: [
      { id: "b70000000001", status: "current", app: TEXTEDIT, source: null, created: yesterday(14, 2),
        text: ["CRLF output still needs a test before Thursday.", "목요일 전에 CRLF 출력 테스트가 남아 있어요."] },
      { id: "b70000000002", status: "current", app: TEXTEDIT, source: null, created: yesterday(14, 2),
        text: ["UTF-8 BOM validation is complete.", "UTF-8 BOM 검증은 끝났어요."] },
      { id: "b70000000003", status: "current", app: TEXTEDIT, source: null, created: yesterday(14, 2),
        text: ["Mira owns the final review.", "최종 검토는 Mira 담당이에요."] },
    ] },
    { id: "a10000000008", kind: "project", title: ["Harbor invoice rollout", "Harbor 인보이스 출시"], lines: [
      { id: "b80000000001", status: "current", app: PREVIEW_APP, source: null, created: yesterday(15, 16),
        text: ["The tax-code export test must be finished by Friday.", "세무 코드 내보내기 테스트는 금요일까지 끝내야 해요."] },
      { id: "b80000000002", status: "current", app: PREVIEW_APP, source: null, created: yesterday(15, 16),
        text: ["The invoice PDF layout check is complete.", "인보이스 PDF 레이아웃 확인은 끝났어요."] },
      { id: "b80000000003", status: "current", app: PREVIEW_APP, source: null, created: yesterday(15, 16),
        text: ["Nora owns the final approval.", "최종 승인은 Nora 담당이에요."] },
    ] },
    { id: "a10000000009", kind: "person", title: ["Nora", "Nora"], lines: [
      { id: "b90000000001", status: "current", app: PREVIEW_APP, source: null, created: yesterday(15, 16),
        text: ["Owns the final approval of the Harbor invoice rollout.", "Harbor 인보이스 출시의 최종 승인 담당이에요."] },
    ] },
    { id: "a1000000000a", kind: "topic", title: ["Weekly priorities", "이번 주 우선순위"], lines: [
      { id: "ba0000000001", status: "current", app: CHROME, source: null, created: yesterday(10, 5),
        text: ["This week's priorities are the Juniper release and the Staging deploy cutover.", "이번 주 우선순위는 Juniper 출시와 스테이징 배포 전환이에요."] },
      { id: "ba0000000002", status: "current", app: CHROME, source: null, created: yesterday(10, 8),
        text: ["Harbor invoice rollout moves to next week; Nora agreed.", "Harbor 인보이스 출시는 다음 주로 미뤘고 Nora도 동의했어요."] },
    ] },
  ];
  const point = (en: string, ko: string, ...lines: string[]): PreviewPoint => ({ text: [en, ko], lines });
  const docs: Record<string, Omit<PreviewDoc, "compiled" | "pending"> & { compiled?: number; pending?: string[] }> = {
    a10000000001: { compiled: ago(7), pending: ["b10000000008"], summary: [
      point("The launch target moved from Friday to Monday because support is short-staffed on Friday.", "출시 목표일이 금요일에서 월요일로 옮겨졌어요. 금요일엔 지원팀이 비어서예요.", "b10000000007", "b10000000009"),
      point("The [[Billing webhook]] fix shipped and unblocked the release.", "[[결제 웹훅]] 수정이 배포돼 릴리스를 막던 문제는 풀렸어요.", "b10000000006"),
    ], sections: [
      { heading: ["Dates", "일정"], points: [
        point("The target is Monday; it was undecided, then Friday, before it moved.", "목표일은 월요일이에요. 처음엔 정해지지 않았다가 금요일을 거쳐 바뀌었어요.", "b10000000007"),
        point("[[Mira]] proposed the Monday launch in Slack and signed off on it.", "월요일 출시는 [[Mira]]가 Slack에서 제안했고 승인까지 했어요.", "b10000000009", "b10000000007"),
      ] },
      { heading: ["Progress", "진행 상황"], points: [
        point("[[Theo]] shipped the billing webhook fix on Tuesday.", "[[Theo]]가 화요일에 결제 웹훅 수정을 배포했어요.", "b10000000006"),
        point("The staging smoke test passed 18/18.", "스테이징 스모크 테스트는 18/18 통과했어요.", "b10000000001"),
      ] },
    ] },
    // Mira, Nora and the billing webhook: written by claude-haiku-5-5 from their own lines and what other pages say about them.
    a10000000002: { summary: [
      point("Mira signed off on the [[Juniper release]] on Thursday. Its target date moved to Monday because of support staffing.", "Mira는 [[Juniper 릴리스]]를 목요일에 승인했어요. 같은 릴리스의 목표일은 지원팀 인력 배치 때문에 월요일로 옮겨졌어요.", "b20000000001", "b10000000007", "b10000000008"),
      point("Mira owns the final review of the [[Atlas CSV export]].", "Mira는 [[Atlas CSV 내보내기]]의 최종 검토 담당이에요.", "b20000000002", "b70000000003"),
    ], sections: [{ heading: ["Juniper release dates", "Juniper 릴리스 일정"], points: [
      point("With support short-staffed on Friday, she proposed in Slack moving the launch to Monday.", "금요일에는 지원팀 인력이 비어서 출시를 월요일로 옮기자고 Slack에서 제안했어요.", "b10000000009"),
      point("Mira signed off on moving the target date to Monday.", "목표일을 월요일로 옮기는 결정은 Mira가 승인했어요.", "b10000000007"),
    ] }] },
    a10000000004: { summary: [
      point("The billing webhook fix shipped on Tuesday and unblocked the [[Juniper release]].", "화요일에 결제 웹훅 수정이 배포되어 [[Juniper 릴리스]]의 차단이 풀렸어요.", "b40000000001"),
      point("[[Theo]] owned the billing webhook fix and shipped it on Tuesday.", "[[Theo]]가 결제 웹훅 수정을 맡아 화요일에 배포했어요.", "b30000000002", "b10000000006"),
    ], sections: [] },
    a10000000005: { summary: [point("The dry run passed 42/42.", "드라이런은 42/42 통과했어요.", "b50000000001")],
      sections: [{ heading: ["Remaining", "남은 일"], points: [point("The prod cutover waits for [[Hana]]'s approval on Thursday.", "운영 전환은 목요일에 [[Hana]]의 승인을 기다려요.", "b50000000001")] }] },
    a10000000007: { summary: [point("UTF-8 BOM validation is done; the CRLF output test remains before Thursday.", "UTF-8 BOM 검증은 끝났고, 목요일 전에 CRLF 출력 테스트가 남아 있어요.", "b70000000002", "b70000000001")],
      sections: [
        { heading: ["Remaining", "남은 일"], points: [point("Test the CRLF output before Thursday.", "CRLF 출력 테스트를 목요일 전에 해야 해요.", "b70000000001")] },
        { heading: ["People", "사람"], points: [point("[[Mira]] owns the final review.", "최종 검토는 [[Mira]] 담당이에요.", "b70000000003")] },
      ] },
    a10000000008: { summary: [point("The invoice PDF layout check is done; the tax-code export test must be finished by Friday.", "인보이스 PDF 레이아웃 확인은 끝났고, 세무 코드 내보내기 테스트를 금요일까지 끝내야 해요.", "b80000000002", "b80000000001")],
      sections: [{ heading: ["People", "사람"], points: [point("[[Nora]] owns the final approval.", "최종 승인은 [[Nora]] 담당이에요.", "b80000000003")] }] },
    a10000000009: { summary: [
      point("Nora owns the final approval of the [[Harbor invoice rollout]].", "Nora는 [[Harbor 인보이스 출시]]의 최종 승인 담당이에요.", "b90000000001", "b80000000003"),
      point("The [[Harbor invoice rollout]] moved to next week, and Nora agreed.", "[[Harbor 인보이스 출시]]는 다음 주로 미뤘고, Nora도 이에 동의했어요.", "ba0000000002"),
    ], sections: [] },
    a1000000000a: { summary: [point("This week's priorities are the [[Juniper release]] and the [[Staging deploy]] cutover.", "이번 주 우선순위는 [[Juniper 릴리스]]와 [[스테이징 배포]] 전환이에요.", "ba0000000001")],
      sections: [{ heading: ["Deferred", "미룬 일"], points: [point("The [[Harbor invoice rollout]] moves to next week; [[Nora]] agreed.", "[[Harbor 인보이스 출시]]는 다음 주로 미뤘고 [[Nora]]도 동의했어요.", "ba0000000002")] }] },
  };
  // Hana and Theo have a line of their own and one elsewhere: too little for a document.
  for (const page of pages) {
    const doc = docs[page.id];
    if (!doc) continue;
    page.doc = { ...doc, compiled: doc.compiled ?? Math.max(...page.lines.map((line) => line.created)) + 2 * MINUTE, pending: doc.pending ?? [] };
  }
  // The flow's notes, written by claude-haiku-5-5 once each session closed (the engine's validation applied).
  const sessionNotes: PreviewNote[] = [
    { lineIds: ["b10000000009", "b10000000007", "b10000000008", "b20000000001"], title: ["Juniper launch moved to Monday", "Juniper 출시일 월요일로 변경"],
      summary: [
        point("The [[Juniper release]] target moved from Friday to Monday because of support staffing.", "[[Juniper 릴리스]] 목표일이 금요일에서 월요일로 옮겨졌어요. 지원팀 인력 배치 때문이에요.", "b10000000007", "b10000000009"),
        point("[[Mira]] signed off on the release.", "[[Mira]]가 릴리스를 승인했어요.", "b10000000007", "b10000000008", "b20000000001"),
      ],
      points: [point("[[Mira]] proposed in Slack moving the launch to Monday, as support is short-staffed on Friday.", "[[Mira]]가 Slack에서 금요일엔 지원팀이 비어 있으니 출시를 월요일로 옮기자고 제안했어요.", "b10000000009")] },
    { lineIds: ["b10000000001", "b10000000004", "b10000000002", "b30000000001", "b10000000006", "b10000000003", "b30000000002", "b40000000001"], title: ["Juniper release unblocked", "Juniper 릴리스 차단 해제"],
      summary: [
        point("The [[Juniper release]] was unblocked when the [[Billing webhook]] fix shipped on Tuesday.", "[[Juniper 릴리스]]는 [[결제 웹훅]] 수정이 화요일에 배포되면서 차단이 풀렸어요.", "b10000000006", "b40000000001"),
        point("[[Theo]] owned the [[Billing webhook]] fix and shipped it on Tuesday.", "[[Theo]]가 [[결제 웹훅]] 수정을 담당해 화요일에 배포했어요.", "b30000000002"),
      ],
      points: [
        point("The [[Juniper release]] was blocked waiting on the [[Billing webhook]] fix.", "[[Juniper 릴리스]]는 [[결제 웹훅]] 수정을 기다리느라 막혀 있었어요.", "b10000000002"),
        point("[[Theo]] was working on the [[Billing webhook]] fix.", "[[Theo]]가 [[결제 웹훅]] 수정을 진행하고 있었어요.", "b30000000001"),
        point("The [[Juniper release]] target was set to Friday, pending [[Mira]]'s sign-off.", "[[Juniper 릴리스]]의 목표일은 금요일로 정해졌고 [[Mira]]의 승인을 기다리고 있었어요.", "b10000000003"),
        point("The staging smoke test passed 18 of 18.", "스테이징 스모크 테스트는 18개 중 18개가 통과했어요.", "b10000000001"),
      ] },
    { lineIds: ["b50000000001", "b60000000001"], title: ["Staging cutover awaits Thursday sign-off", "스테이징 배포 운영 전환 목요일 승인 대기"],
      summary: [point("The [[Staging deploy]] dry run passed 42/42; the prod cutover waits for [[Hana]]'s approval on Thursday.", "[[스테이징 배포]]는 드라이런 42/42를 통과했고, 운영 전환은 목요일 [[Hana]]의 승인을 기다리고 있어요.", "b50000000001", "b60000000001")], points: [] },
    { lineIds: ["b80000000001", "b80000000002", "b80000000003", "b90000000001"], title: ["Harbor invoice rollout sign-off prep", "Harbor 인보이스 출시 승인 준비"],
      summary: [
        point("The [[Harbor invoice rollout]] PDF layout check is done.", "[[Harbor 인보이스 출시]]의 PDF 레이아웃 확인은 끝났어요.", "b80000000002"),
        point("[[Nora]] owns the final approval.", "최종 승인은 [[Nora]]가 맡아요.", "b80000000003", "b90000000001"),
      ],
      points: [point("The tax-code export test must be finished by Friday.", "세무 코드 내보내기 테스트는 금요일까지 끝내야 해요.", "b80000000001")] },
    { lineIds: ["b20000000002", "b70000000001", "b70000000002", "b70000000003"], title: ["Atlas CSV export review status", "Atlas CSV 내보내기 검토 현황"],
      summary: [
        point("[[Mira]] owns the final review of the [[Atlas CSV export]].", "[[Atlas CSV 내보내기]]의 최종 검토는 [[Mira]]가 담당해요.", "b20000000002", "b70000000003"),
        point("The CRLF output test remains before Thursday; UTF-8 BOM validation is done.", "목요일 전에 CRLF 출력 테스트가 남아 있고, UTF-8 BOM 검증은 끝났어요.", "b70000000001", "b70000000002"),
      ], points: [] },
    { lineIds: ["ba0000000001", "ba0000000002"], title: ["Weekly priorities and the Harbor delay", "이번 주 우선순위와 Harbor 출시 연기"],
      summary: [
        point("[[Weekly priorities]] are the [[Juniper release]] and the [[Staging deploy]] cutover.", "[[이번 주 우선순위]]는 [[Juniper 릴리스]] 출시와 [[스테이징 배포]] 전환이에요.", "ba0000000001"),
        point("The [[Harbor invoice rollout]] moved to next week, and [[Nora]] agreed.", "[[Harbor 인보이스 출시]]는 다음 주로 미뤄졌고, [[Nora]]도 이에 동의했어요.", "ba0000000002"),
      ], points: [] },
  ];
  // Hand-written for browser review in the shape the engine writes: newest lines of the last two days, every sentence cited.
  const nowPage: PreviewNow = { compiled: ago(3),
    doing: [
      point("The [[Juniper release]] now launches on Monday, and [[Mira]] signed off.", "[[Juniper 릴리스]]는 월요일 출시로 바뀌었고 [[Mira]]가 승인했어요.", "b10000000007", "b10000000008"),
      point("The [[Staging deploy]] cutover is the other priority this week.", "이번 주 다른 우선순위는 [[스테이징 배포]] 전환이에요.", "ba0000000001"),
    ],
    waiting: [
      point("The prod cutover waits for [[Hana]]'s approval on Thursday.", "운영 전환은 목요일 [[Hana]]의 승인을 기다려요.", "b50000000001", "b60000000001"),
      point("The [[Atlas CSV export]] still needs its CRLF output test before Thursday.", "[[Atlas CSV 내보내기]]는 목요일 전에 CRLF 출력 테스트가 남았어요.", "b70000000001"),
    ],
    done: [
      point("[[Theo]] shipped the [[Billing webhook]] fix, which unblocked the release.", "[[Theo]]가 [[결제 웹훅]] 수정을 배포해 릴리스 차단이 풀렸어요.", "b10000000006", "b30000000002"),
      point("The staging smoke test passed 18/18.", "스테이징 스모크 테스트는 18/18 통과했어요.", "b10000000001"),
    ] };
  const mePage: PreviewMe = { compiled: ago(6 * 60),
    role: [
      point("Runs billing product releases and their cutovers, collecting each approval they need.", "결제 제품의 릴리스와 운영 전환을 맡아 필요한 승인을 챙겨요.", "b10000000007", "b50000000001"),
      point("Checks smoke tests and dry runs before a launch goes ahead.", "출시 전에 스모크 테스트와 드라이런 결과를 확인해요.", "b10000000001", "b50000000001"),
    ],
    owns: [
      point("Moved the [[Juniper release]] to Monday and got [[Mira]]'s sign-off.", "[[Juniper 릴리스]] 출시를 월요일로 옮기고 [[Mira]]의 승인을 받았어요.", "b10000000007", "b10000000008"),
      point("Took the [[Staging deploy]] through a 42/42 dry run; the prod cutover waits for [[Hana]].", "[[스테이징 배포]]는 드라이런 42/42를 통과했고 운영 전환은 [[Hana]]를 기다려요.", "b50000000001"),
      point("Moved the [[Harbor invoice rollout]] to next week with [[Nora]]'s agreement.", "[[Nora]]와 합의해 [[Harbor 인보이스 출시]]를 다음 주로 미뤘어요.", "ba0000000002", "b80000000003"),
    ],
    people: [
      point("[[Mira]] signs off releases and owns the final review of the [[Atlas CSV export]].", "[[Mira]]는 릴리스를 승인하고 [[Atlas CSV 내보내기]] 최종 검토를 맡아요.", "b20000000001", "b20000000002"),
      point("[[Theo]] owns the [[Billing webhook]] fix that unblocked the release.", "[[Theo]]는 릴리스 차단을 푼 [[결제 웹훅]] 수정을 맡았어요.", "b30000000002"),
      point("[[Hana]] approves the prod cutover and [[Nora]] the Harbor rollout.", "운영 전환은 [[Hana]]가, Harbor 출시는 [[Nora]]가 승인해요.", "b60000000001", "b90000000001"),
    ] };
  return { pages, sources, notes: sessionNotes, now: nowPage, me: mePage };
}

const CROWD_PEOPLE = ["Ada", "Bram", "Cleo", "Dev", "Elif", "Farah", "Gus", "Hiro", "Iris", "Jonas", "Kai", "Lena", "Milo", "Noor", "Oscar", "Pia", "Quinn", "Ravi", "Sana", "Tomas"];
const CROWD_PROJECTS: readonly Text[] = [
  ["Aurora dashboard", "Aurora 대시보드"], ["Beacon onboarding", "Beacon 온보딩"], ["Cobalt API", "Cobalt API"], ["Delta pricing", "Delta 가격 개편"],
  ["Ember mobile", "Ember 모바일"], ["Fjord search", "Fjord 검색"], ["Garnet billing", "Garnet 결제"], ["Helix analytics", "Helix 분석"],
  ["Ionic SSO", "Ionic SSO"], ["Jasper migration", "Jasper 이전"], ["Kestrel release", "Kestrel 릴리스"], ["Lumen docs", "Lumen 문서"],
];
const CROWD_TOPICS: readonly Text[] = [["Rate limits", "요청 한도"], ["Design system", "디자인 시스템"], ["Hiring", "채용"], ["Security review", "보안 검토"], ["Customer feedback", "고객 피드백"], ["Q4 planning", "4분기 계획"]];

/** Synthetic projects, people and topics that name each other, spread over the last week. */
function crowd(now: number): PreviewPage[] {
  const hex = (prefix: string, n: number) => prefix + n.toString(16).padStart(11, "0");
  let lineNo = 0;
  const line = (minutesAgo: number, en: string, ko: string): PreviewLine => ({ id: hex("d", (lineNo += 1)), status: "current", app: CHROME, source: null, created: now - minutesAgo * MINUTE, text: [en, ko] });
  const short = (title: Text) => title[0].split(" ")[0];
  const projects: PreviewPage[] = CROWD_PROJECTS.map((title, i) => {
    const owner = CROWD_PEOPLE[i % CROWD_PEOPLE.length]; const helper = CROWD_PEOPLE[(i * 3 + 5) % CROWD_PEOPLE.length];
    const topic = CROWD_TOPICS[i % CROWD_TOPICS.length]; const next = CROWD_PROJECTS[(i + 1) % CROWD_PROJECTS.length];
    const ago = 40 + i * 610;
    const lines = [
      line(ago, owner + " owns the " + title[0] + " plan.", owner + "가 " + short(title) + " 계획을 맡고 있어요."),
      line(ago + 30, helper + " is reviewing the " + topic[0] + " part.", helper + "가 " + topic[1] + " 부분을 검토하고 있어요."),
    ];
    if (i % 3 === 0) lines.push(line(ago + 90, "It needs " + short(next) + " to land first.", short(next) + "가 먼저 끝나야 해요."));
    if (i % 4 === 1) lines.push(line(ago + 120, "The demo is set for Friday.", "데모는 금요일로 잡혔어요."));
    return { id: hex("c", i + 1), kind: "project", title, lines };
  });
  const people: PreviewPage[] = CROWD_PEOPLE.map((name, i) => {
    const project = CROWD_PROJECTS[(i * 5) % CROWD_PROJECTS.length];
    const partner = CROWD_PEOPLE[(i + 1) % CROWD_PEOPLE.length];
    const lines = [line(70 + i * 330, "Sent notes on the " + project[0] + " draft.", short(project) + " 초안에 의견을 보냈어요.")];
    if (i % 2 === 0) lines.push(line(80 + i * 330, "Pairs with " + partner + " this week.", "이번 주 " + partner + "와 함께 일해요."));
    return { id: hex("e", i + 1), kind: "person", title: [name, name], lines };
  });
  const topics: PreviewPage[] = CROWD_TOPICS.map((title, i) => {
    const project = CROWD_PROJECTS[(i * 2) % CROWD_PROJECTS.length];
    return { id: hex("f", i + 1), kind: "topic", title, lines: [line(55 + i * 900, "Came up in the " + project[0] + " review.", short(project) + " 리뷰에서 나왔어요.")] };
  });
  const crowd = [...projects, ...people, ...topics];
  // Each page's document links the other pages its memories name.
  const titles = crowd.map((page) => page.title);
  // Link the first plain mention of each other page; a Korean particle may follow a name.
  const linkOnce = (text: string, title: string) => {
    if (text.includes("[[" + title + "]]")) return text;
    for (let at = text.indexOf(title); at >= 0; at = text.indexOf(title, at + 1)) {
      const before = text[at - 1] ?? " "; const after = text[at + title.length] ?? " ";
      if (/[\p{L}\p{N}[]/u.test(before) || /[A-Za-z0-9\]]/.test(after)) continue;
      return text.slice(0, at) + "[[" + title + "]]" + text.slice(at + title.length);
    }
    return text;
  };
  const linkify = (text: string, language: 0 | 1, own: Text) => titles.filter((title) => title !== own).map((title) => title[language])
    .sort((a, b) => b.length - a.length).reduce(linkOnce, text);
  for (const page of crowd) {
    const [first, ...rest] = page.lines;
    const docPoint = (item: PreviewLine): PreviewPoint => ({ text: [linkify(item.text[0], 0, page.title), linkify(item.text[1], 1, page.title)], lines: [item.id] });
    page.doc = { summary: [docPoint(first)], compiled: Math.max(...page.lines.map((item) => item.created)) + 2 * MINUTE, pending: [],
      sections: rest.length === 0 ? [] : [{ heading: page.kind === "person" ? ["Recent", "최근"] : ["Status", "현황"], points: rest.map(docPoint) }] };
  }
  return crowd;
}


/** A plain rendering of the synthetic window, so the viewer shows a screen and not only text. */
function frame(source: PreviewSource): string | null {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 960; canvas.height = 560;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = source.terminal ? "#1f1f1c" : "#ffffff";
    context.fillRect(0, 0, 960, 560);
    context.fillStyle = source.terminal ? "#2c2c28" : "#ecebe6";
    context.fillRect(0, 0, 960, 36);
    ["#ec6a5e", "#f4bf4f", "#61c554"].forEach((color, index) => {
      context.fillStyle = color; context.beginPath(); context.arc(22 + index * 20, 18, 6, 0, Math.PI * 2); context.fill();
    });
    const [title, ...rest] = source.text.split("\n");
    context.fillStyle = source.terminal ? "#e2e1da" : "#1f1f1c";
    context.font = source.terminal ? "18px Menlo, monospace" : "600 34px -apple-system, Helvetica, sans-serif";
    context.fillText(source.terminal ? title : title, 40, source.terminal ? 84 : 104);
    context.font = source.terminal ? "18px Menlo, monospace" : "22px -apple-system, Helvetica, sans-serif";
    rest.forEach((line, index) => context.fillText(line, 40, (source.terminal ? 120 : 164) + index * (source.terminal ? 32 : 40)));
    const url = canvas.toDataURL("image/png");
    return /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(url) ? url : null;
  } catch {
    return null;
  }
}

export function memoryPreviewState(search = typeof window === "undefined" ? "" : window.location.search): MemoryPreviewState {
  const value = new URLSearchParams(search).get("memoryPreview");
  return value === "off" || value === "empty" || value === "many" || value === "setup" || value === "start" || value === "paused" ? value : "on";
}

/** What "start" has done so far, kept for the tab so the reload after allowing recording keeps it. */
const START_KEY = "drifty.memoryPreview.start.";
function startDone(step: "engine" | "models" | "granted" | "requested"): boolean {
  try { return window.sessionStorage.getItem(START_KEY + step) === "1"; } catch { return false; }
}
function markStartDone(step: "engine" | "models" | "granted" | "requested"): void {
  try { window.sessionStorage.setItem(START_KEY + step, "1"); } catch { /* the preview forgets on reload */ }
}

/**
 * The "start" state's downloads at measured sizes and a typical 8 MB/s
 * (memoryPreviewSpeed multiplies it); every other state has both installed.
 */
export function createMemoryPreviewInstaller(state: MemoryPreviewState = memoryPreviewState(), search = typeof window === "undefined" ? "" : window.location.search): MemoryInstaller {
  const ENGINE = 69_008_782, MODELS = 266_984_674, VERIFY_MS = 5000;
  const rate = 8 * 1024 * 1024 * Math.max(0.1, Number(new URLSearchParams(search).get("memoryPreviewSpeed")) || 1);
  const progress: Record<"engine" | "models", InstallProgress> = {
    engine: { phase: state !== "start" || startDone("engine") ? "ready" : "missing", received: 0, total: ENGINE },
    models: { phase: state !== "start" || startDone("models") ? "ready" : "missing", received: 0, total: MODELS },
  };
  const run = async (step: "engine" | "models") => {
    if (progress[step].phase === "ready") return;
    const total = progress[step].total;
    for (let received = 0; received < total;) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      received = Math.min(total, received + rate / 10);
      progress[step] = { phase: "downloading", received, total };
    }
    if (step === "engine") { progress[step] = { phase: "verifying", received: total, total }; await new Promise((resolve) => setTimeout(resolve, VERIFY_MS)); }
    progress[step] = { phase: "ready", received: 0, total };
    markStartDone(step);
  };
  return {
    engine: async () => progress.engine,
    installEngine: () => run("engine"),
    models: async () => progress.models,
    installModels: () => run("models"),
  };
}

export function createMemoryPreviewClient(korean: boolean, state: MemoryPreviewState = memoryPreviewState(), clock: () => number = Date.now, reviewPages?: PreviewPage[]): ScreenContextClient {
  // As on macOS, a grant takes effect once the app has been reopened. Any other load starts over.
  if (state === "start") {
    const reopened = startDone("requested");
    try { for (const step of ["engine", "models", "granted", "requested"]) window.sessionStorage.removeItem(START_KEY + step); } catch { /* nothing kept */ }
    if (reopened) for (const step of ["engine", "models", "granted"] as const) markStartDone(step);
  }
  const started = clock();
  const data = state === "empty" || state === "start" ? { pages: [] as PreviewPage[], sources: [] as PreviewSource[], notes: [] as PreviewNote[], now: null as PreviewNow | null, me: null as PreviewMe | null } : scenario(started);
  if (reviewPages) { data.pages = reviewPages; data.sources = []; data.notes = []; data.now = null; data.me = null; }
  const juniper = data.pages.find((page) => page.id === "a10000000001");
  if (juniper) juniper.note = { updated: started - 2 * HOUR, text: korean
    ? "월요일 출시 전에 지원팀 FAQ 업데이트 확인하기.\nTheo에게 웹훅 모니터링 알림 기준 물어보기."
    : "Check the support FAQ update before Monday's launch.\nAsk Theo about the webhook monitoring alert threshold." };
  // Files the preview's Markdown export "wrote", by name.
  const exported = new Map<string, string>();
  if (state === "many") data.pages.push(...crowd(started));
  const deletedSources = new Set<string>();
  const language = korean ? 1 : 0;
  const live = (id: string | null) => id !== null && !deletedSources.has(id) && data.sources.some((source) => source.id === id);
  // As in the engine: a person or topic also counts the current lines of other pages that name it.
  const names = (title: string, text: string) => new RegExp("(?<![\\p{L}\\p{N}_])" + title.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&")
    + (/[A-Za-z0-9]$/.test(title) ? "(?![A-Za-z0-9_])" : ""), "iu").test(text);
  const mentions = (page: PreviewPage) => page.kind === "project" ? 0 : data.pages.filter((other) => other !== page)
    .reduce((count, other) => count + other.lines.filter((line) => line.status === "current" && names(page.title[language], line.text[language])).length, 0);
  const docView = (page: PreviewPage) => {
    if (page.rewrite && clock() >= page.rewrite.at) { page.doc = page.rewrite.doc && { ...page.rewrite.doc, compiled: page.rewrite.at }; page.rewrite = undefined; }
    const doc = page.doc;
    // As in the engine, a page of a line or two (counting what others say about a person or topic) has no document.
    if (!doc || page.lines.filter((line) => line.status === "current").length + mentions(page) < 3) return {};
    const point = (item: PreviewPoint) => ({ text: item.text[language], lines: item.lines });
    return { doc: { summary: doc.summary.map(point), sections: doc.sections.map((section) => ({ heading: section.heading[language], points: section.points.map(point) })),
      compiled_at_ms: doc.compiled, compiled_at_utc: "", pending_line_ids: page.lines.filter((line) => line.status === "current" && doc.pending.includes(line.id)).map((line) => line.id) } };
  };
  // As in the engine: removing a memory a document was written from takes the document down; it is written again shortly.
  const removeLines = (page: PreviewPage, ids: ReadonlySet<string>) => {
    const removed = page.lines.filter((line) => ids.has(line.id)).map((line) => line.id);
    if (removed.length === 0) return;
    page.lines = page.lines.filter((line) => !ids.has(line.id));
    const doc = page.doc ?? page.rewrite?.doc;
    if (!doc) return;
    const pending = doc.pending.filter((id) => !removed.includes(id));
    if (page.doc && removed.every((id) => doc.pending.includes(id))) { page.doc = { ...doc, pending }; return; }
    const keep = (item: PreviewPoint) => ({ ...item, lines: item.lines.filter((id) => !removed.includes(id)) });
    const summary = doc.summary.map(keep).filter((item) => item.lines.length > 0);
    const sections = doc.sections.map((section) => ({ ...section, points: section.points.map(keep).filter((item) => item.lines.length > 0) })).filter((section) => section.points.length > 0);
    page.doc = null;
    page.rewrite = { doc: summary.length + sections.length === 0 ? null : { summary, sections, compiled: clock(), pending }, at: clock() + 4000 };
  };
  const pageView = (page: PreviewPage) => ({
    ...docView(page),
    id: page.id, title: page.title[language], kind: page.kind,
    ...(page.note ? { my_note: { text: page.note.text, updated_at_ms: page.note.updated, updated_at_utc: "" } } : {}),
    updated_at_ms: Math.max(...page.lines.map((line) => line.replaced ?? line.created)), updated_at_utc: "",
    lines: page.lines.map((line) => ({
      id: line.id, text: line.text[language], status: line.status, app: line.app,
      observed_at_ms: data.sources.find((source) => source.id === line.source)?.observed ?? line.created, observed_at_utc: "",
      original_available: live(line.source), original_source_ids: live(line.source) ? [line.source] : [],
      created_at_ms: line.created, ...(line.replaced ? { replaced_at_ms: line.replaced } : {}), ...(line.replaces ? { replaces: line.replaces } : {}),
    })),
  });
  const latest = () => Math.max(started - 9 * MINUTE, ...data.sources.map((source) => source.observed));
  // Settings can switch the preview's memory on and off and edit its choices.
  const memoryPrefs: { enabled: boolean; retentionHours: number; workSites: string[]; apps: string[]; ownKey?: true } = {
    enabled: state === "on" || state === "many" || state === "paused", retentionHours: 24, workSites: ["localhost"], apps: ["cursor", "slack", "cmux", "chrome"] };
  const status = (withCredentials: boolean) => ({
    supported: state !== "start" || startDone("engine"),
    preferences: { ...memoryPrefs },
    // Setup shows what is missing; the other states hold both a Drifty Cloud session and a key, so
    // Settings offers the route choice.
    ...(withCredentials ? { credentials: { anthropic: state !== "setup", cloud: state !== "setup" } } : {}),
    status: !memoryPrefs.enabled ? null : {
      active: true, sources: data.sources.length, remembered_groups: data.sources.length, wiki: { pages: data.pages.length },
      route: { kind: memoryPrefs.ownKey ? "own" : "cloud", error: null, embedding: "ready" },
      diagnostics: { phase: "ready", as_of_ms: clock(), last_source_at_ms: latest(), last_extracted_at_ms: latest() + 20_000, next_attempt_at_ms: null,
        facts: 11, running: 0, waiting: 0, exhausted: 0, errors: 0, writes_hour: 3, writes_day: 7, queries_hour: 2,
        writes_hour_limit: 12, writes_day_limit: 60, queries_hour_limit: 30, hour_resets_at_ms: clock() + HOUR, day_resets_at_ms: clock() + 12 * HOUR },
    },
  });
  const screenStatus = {
    preferences: { enabled: state !== "empty" && state !== "start", replayEnabled: true, visibleTextEnabled: true, ocrEnabled: true, allowedApps: ["slack", "cursor", "chrome", "cmux"], intervalSeconds: 30 },
    preferencesInvalid: false, captureEnabled: state !== "empty" && state !== "start", helperInstalled: true, globalPaused: false, ocrSupported: true,
    supportedApps: [{ id: "textedit", name: "TextEdit" }, { id: "preview", name: "Preview" }, { id: "vscode", name: "Visual Studio Code" }, { id: "cursor", name: "Cursor" },
      { id: "slack", name: "Slack" }, { id: "discord", name: "Discord" }, { id: "chatgpt", name: "ChatGPT" }, { id: "cmux", name: "cmux" },
      { id: "powerpoint", name: "Microsoft PowerPoint" }, { id: "aside", name: "Aside" }, { id: "chrome", name: "Google Chrome" }],
    paused: state === "setup" || state === "paused", running: state !== "empty" && state !== "setup" && state !== "start" && state !== "paused", preparing: false,
    accepted: 4, dropped: 0, lastFailure: null, lastAcceptedAtMs: latest(),
  };
  const dropSource = (id: string) => {
    deletedSources.add(id);
    for (const page of data.pages) removeLines(page, new Set(page.lines.filter((line) => line.source === id).map((line) => line.id)));
    data.pages = data.pages.filter((page) => page.lines.length > 0);
  };
  // A note shows only while every line it was written from is still there, as in the engine.
  const notesView = () => {
    const ids = new Set(data.pages.flatMap((page) => page.lines.map((line) => line.id)));
    const point = (item: PreviewPoint) => ({ text: item.text[language], lines: item.lines });
    const own = data.notes.map((note) => ({ lineIds: note.lineIds, title: note.title[language], summary: note.summary.map(point), points: note.points.map(point) }));
    return [...own, ...(state === "many" && korean ? CROWD_NOTES : [])].filter((note) => note.lineIds.every((id) => ids.has(id)))
      .map((note) => ({ key: note.lineIds[0], line_ids: note.lineIds, title: note.title, summary: note.summary, points: note.points, compiled_at_ms: started, compiled_at_utc: "" }));
  };
  // As in the engine, removing a line the "now" page cites takes the page down until it is rewritten.
  const nowView = () => {
    const page = data.now;
    if (!page) return null;
    const current = new Set(data.pages.flatMap((item) => item.lines.filter((line) => line.status === "current").map((line) => line.id)));
    const cited = [...page.doing, ...page.waiting, ...page.done].flatMap((item) => item.lines);
    if (!cited.every((id) => current.has(id))) { data.now = null; return null; }
    const point = (item: PreviewPoint) => ({ text: item.text[language], lines: item.lines });
    return { doing: page.doing.map(point), waiting: page.waiting.map(point), done: page.done.map(point), line_ids: [...new Set(cited)].sort(),
      compiled_at_ms: page.compiled, compiled_at_utc: "" };
  };
  const meView = () => {
    const page = data.me;
    if (!page) return null;
    const current = new Set(data.pages.flatMap((item) => item.lines.filter((line) => line.status === "current").map((line) => line.id)));
    const cited = [...page.role, ...page.owns, ...page.people].flatMap((item) => item.lines);
    if (!cited.every((id) => current.has(id))) { data.me = null; return null; }
    const point = (item: PreviewPoint) => ({ text: item.text[language], lines: item.lines });
    return { role: page.role.map(point), owns: page.owns.map(point), people: page.people.map(point), line_ids: [...new Set(cited)].sort(),
      compiled_at_ms: page.compiled, compiled_at_utc: "" };
  };
  const invoke = async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    let value: unknown;
    switch (command) {
      case "screen_context_revoke_account": return undefined;
      // Lease-free like the native preflight; the preview's Mac already allows recording.
      case "screen_context_permission_status": return { granted: state !== "start" || startDone("granted") };
      // macOS records the grant, then quits and reopens the app; the preview reloads the page.
      case "screen_context_request_permission":
        markStartDone("requested");
        setTimeout(() => window.location.reload(), 1500);
        value = { granted: false };
        break;
      case "screen_context_bind_account": value = { mode: "local", expiresAtMs: clock() + 15 * MINUTE }; break;
      case "memory_get_status": value = status(args?.includeCredentials === true); break;
      case "screen_context_get_status": value = screenStatus; break;
      case "memory_configure": {
        // Starting memory launches the engine, which takes a moment in the app.
        if (state === "start") await new Promise((resolve) => setTimeout(resolve, 1500));
        const next = args?.preferences as typeof memoryPrefs;
        Object.assign(memoryPrefs, { enabled: next.enabled, retentionHours: next.retentionHours, workSites: [...next.workSites], apps: [...next.apps] });
        if (next.ownKey) memoryPrefs.ownKey = true; else delete memoryPrefs.ownKey;
        value = { saved: true };
        break;
      }
      case "memory_purge": data.pages = []; data.notes = []; data.now = null; data.me = null; memoryPrefs.enabled = false; value = { purged: true }; break;
      case "screen_context_configure": {
        const next = args?.preferences as typeof screenStatus.preferences;
        screenStatus.preferences = { ...screenStatus.preferences, enabled: next.enabled, allowedApps: [...next.allowedApps] };
        screenStatus.captureEnabled = next.enabled;
        screenStatus.paused = false;
        screenStatus.running = next.enabled;
        value = screenStatus;
        break;
      }
      case "memory_wiki_pages":
        // As in the app, memory reads nothing while the recording it reads from is paused.
        if (memoryPrefs.enabled && screenStatus.paused) throw "memory_recording_required";
        value = { pages: data.pages.map(pageView), notes: notesView(), now: nowView(), me: meView() };
        break;
      case "memory_wiki_note": {
        const page = data.pages.find((item) => item.id === args?.pageId);
        const text = String(args?.text ?? "").trim();
        if (page) page.note = text ? { text, updated: clock() } : undefined;
        value = { saved: Boolean(page) };
        break;
      }
      case "memory_export_markdown": {
        const files = (args?.files ?? []) as { name: string; text: string }[];
        const removed = [...exported.keys()].filter((name) => !files.some((file) => file.name === name)).length;
        exported.clear();
        for (const file of files) exported.set(file.name, file.text);
        value = { written: files.length, removed, skipped: 0 };
        break;
      }
      case "memory_export_clear": value = { removed: exported.size }; exported.clear(); break;
      case "memory_export_open": value = exported.size > 0; break;
      case "memory_wiki_delete": {
        const page = data.pages.find((item) => item.id === args?.pageId);
        if (page && typeof args?.lineId === "string") removeLines(page, new Set([args.lineId]));
        data.pages = data.pages.filter((item) => item !== page || (typeof args?.lineId === "string" && item.lines.length > 0));
        value = { deleted: Boolean(page) };
        break;
      }
      case "memory_forget_source": dropSource(String(args?.recordId)); value = { forgotten: true }; break;
      case "screen_context_delete_evidence": dropSource(String(args?.recordId)); value = { removedCount: 1, pendingFiles: 0 }; break;
      case "screen_context_read_evidence": {
        const source = data.sources.find((item) => item.id === args?.recordId && !deletedSources.has(item.id));
        value = source ? { id: source.id, observedAtMs: source.observed, expiresAtMs: source.observed + 24 * HOUR,
          textEvidence: { source: "ocr", state: "recognized", text: source.text }, frameUrl: args?.includeFrame === true ? frame(source) : null } : null;
        break;
      }
      default: throw "screen_context_unavailable";
    }
    return { leaseId: LEASE, value };
  };
  const client = new ScreenContextClient(invoke, true);
  client.setAccount(null);
  return client;
}
