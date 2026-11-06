/**
 * Browser review only: notes the engine wrote with claude-haiku-5-5 for the
 * synthetic "many" sessions (generated once from the same preview data; the
 * engine's own validation applied). Korean only. A note shows beside a
 * session only when its lines are exactly the session's, so sessions that
 * fall differently across midnight read as their lines, as in the app.
 */
export type CrowdNote = { readonly lineIds: readonly string[]; readonly title: string;
  readonly summary: readonly { readonly text: string; readonly lines: readonly string[] }[];
  readonly points: readonly { readonly text: string; readonly lines: readonly string[] }[] };

export const CROWD_NOTES: readonly CrowdNote[] = [
  { lineIds: ["d0000000001f"], title: "Lumen 문서 4분기 계획 검토", summary: [{ text: "[[Sana]]가 [[Lumen 문서]]의 [[4분기 계획]] 부분을 검토하고 있어요.", lines: ["d0000000001f"] }], points: [] },
  { lineIds: ["d0000000001e"], title: "Lumen 계획 담당 Lena", summary: [{ text: "[[Lena]]가 [[Lumen 문서]] 계획을 맡고 있어요.", lines: ["d0000000001e"] }], points: [] },
  { lineIds: ["d0000000003d"], title: "Lumen 초안에 의견 전달", summary: [{ text: "[[Tomas]]가 Lumen 초안에 의견을 보냈어요.", lines: ["d0000000003d"] }], points: [] },
  { lineIds: ["d0000000001d"], title: "Kestrel 릴리스 고객 피드백 검토", summary: [{ text: "[[Pia]]가 [[Kestrel 릴리스]]의 [[고객 피드백]] 부분을 검토하고 있어요.", lines: ["d0000000001d"] }], points: [] },
  { lineIds: ["d0000000001c"], title: "Kestrel 릴리스 계획 담당자 Kai", summary: [{ text: "[[Kai]]가 [[Kestrel 릴리스]] 계획을 맡고 있어요.", lines: ["d0000000001c"] }], points: [] },
  { lineIds: ["d0000000003c", "d0000000003b"], title: "Garnet 초안에 의견 보내기", summary: [{ text: "[[Sana]]는 이번 주 [[Tomas]]와 함께 일해요.", lines: ["d0000000003c"] }, { text: "[[Sana]]는 [[Garnet 결제]] 초안에 의견을 보냈어요.", lines: ["d0000000003b"] }], points: [] },
  { lineIds: ["d0000000003a"], title: "Beacon 초안에 의견 전달", summary: [{ text: "[[Ravi]]가 Beacon 초안에 의견을 보냈어요.", lines: ["d0000000003a"] }], points: [] },
  { lineIds: ["d0000000001b"], title: "Jasper 데모 금요일로 확정", summary: [{ text: "Jasper 데모는 금요일로 잡혔어요.", lines: ["d0000000001b"] }], points: [] },
  { lineIds: ["d0000000001a"], title: "Kestrel 릴리스 선행 조건", summary: [{ text: "[[Jasper 이전]]에서는 Kestrel이 먼저 끝나야 한다고 적혀 있어요.", lines: ["d0000000001a"] }], points: [] },
  { lineIds: ["d00000000019"], title: "Jasper 이전 보안 검토 진행 중", summary: [{ text: "[[Milo]]가 [[보안 검토]] 부분을 검토하고 있어요.", lines: ["d00000000019"] }], points: [] },
  { lineIds: ["d00000000018"], title: "Jasper 이전 계획 담당자 Jonas", summary: [{ text: "[[Jasper 이전]]의 계획은 [[Jonas]]가 맡고 있어요.", lines: ["d00000000018"] }], points: [] },
  { lineIds: ["d00000000039", "d00000000038"], title: "Quinn 관련 업무 메모", summary: [{ text: "[[Quinn]]은 이번 주 [[Ravi]]와 함께 일해요.", lines: ["d00000000039"] }, { text: "[[Quinn]]은 Ionic 초안에 의견을 보냈어요.", lines: ["d00000000038"] }], points: [] },
  { lineIds: ["d00000000037"], title: "Delta 초안에 의견 전달", summary: [{ text: "[[Pia]]가 Delta 초안에 의견을 보냈어요.", lines: ["d00000000037"] }], points: [] },
  { lineIds: ["d00000000017"], title: "Ionic SSO 채용 검토 진행 중", summary: [{ text: "[[Jonas]]가 [[채용]] 부분을 검토하고 있어요.", lines: ["d00000000017"] }], points: [] },
  { lineIds: ["d00000000016"], title: "Ionic 계획 담당은 Iris", summary: [{ text: "[[Iris]]가 [[Ionic SSO]] 계획을 맡고 있어요.", lines: ["d00000000016"] }], points: [] },
  { lineIds: ["d00000000036", "d00000000035"], title: "Oscar의 이번 주 Pia 협업과 Kestrel 초안 의견", summary: [{ text: "[[Oscar]]는 이번 주 [[Pia]]와 함께 일해요.", lines: ["d00000000036"] }, { text: "[[Oscar]]는 [[Kestrel 릴리스]] 초안에 의견을 보냈어요.", lines: ["d00000000035"] }], points: [] },
  { lineIds: ["d00000000043"], title: "Kestrel 리뷰 논의 기록", summary: [{ text: "Kestrel 리뷰에서 나온 내용이 [[4분기 계획]] 페이지에 기록되어 있어요.", lines: ["d00000000043"] }], points: [] },
  { lineIds: ["d00000000034", "d00000000015"], title: "Fjord 초안 의견과 Helix 분석 검토", summary: [{ text: "[[Noor]]가 Fjord 초안에 의견을 보냈어요.", lines: ["d00000000034"] }, { text: "[[Gus]]가 [[Helix 분석]]의 [[디자인 시스템]] 부분을 검토하고 있어요.", lines: ["d00000000015"] }], points: [] },
  { lineIds: ["d00000000014"], title: "Helix 분석 계획 담당자", summary: [{ text: "[[Hiro]]가 [[Helix 분석]] 계획을 맡고 있어요.", lines: ["d00000000014"] }], points: [] },
  { lineIds: ["d00000000033", "d00000000032"], title: "Milo, Noor와 Aurora 초안 작업", summary: [{ text: "[[Milo]]는 이번 주 [[Noor]]와 함께 일해요.", lines: ["d00000000033"] }, { text: "[[Milo]]는 Aurora 초안에 의견을 보냈어요.", lines: ["d00000000032"] }], points: [] },
  { lineIds: ["d00000000013"], title: "Garnet 결제 일정 선행 조건", summary: [{ text: "[[Garnet 결제]]은 [[Helix 분석]]이 먼저 끝나야 해요.", lines: ["d00000000013"] }], points: [] },
  { lineIds: ["d00000000012"], title: "Garnet 결제 요청 한도 검토 중", summary: [{ text: "[[Dev]]가 [[Garnet 결제]]의 [[요청 한도]] 부분을 검토하고 있어요.", lines: ["d00000000012"] }], points: [] },
  { lineIds: ["d00000000011", "d00000000031"], title: "Garnet 결제 계획과 Helix 초안 의견", summary: [{ text: "[[Gus]]가 [[Garnet 결제]] 계획을 맡고 있어요.", lines: ["d00000000011"] }, { text: "[[Lena]]가 Helix 초안에 의견을 보냈어요.", lines: ["d00000000031"] }], points: [] },
  { lineIds: ["d00000000042"], title: "Ionic 리뷰에서 나온 고객 피드백", summary: [{ text: "Ionic 리뷰에서 [[고객 피드백]]이 나왔어요.", lines: ["d00000000042"] }], points: [] },
  { lineIds: ["d00000000030", "d0000000002f"], title: "Kai의 Cobalt 초안 의견과 Lena와의 협업", summary: [{ text: "[[Kai]]는 Cobalt 초안에 의견을 보냈어요.", lines: ["d0000000002f"] }, { text: "[[Kai]]는 이번 주 [[Lena]]와 함께 일해요.", lines: ["d00000000030"] }], points: [] },
  { lineIds: ["d00000000010"], title: "Fjord 검색 데모 금요일로 확정", summary: [{ text: "[[Fjord 검색]] 데모는 금요일로 잡혀 있어요.", lines: ["d00000000010"] }], points: [] },
  { lineIds: ["d0000000000f"], title: "Ada의 4분기 계획 검토", summary: [{ text: "[[Ada]]가 [[4분기 계획]] 부분을 검토하고 있어요.", lines: ["d0000000000f"] }], points: [] },
  { lineIds: ["d0000000000e"], title: "Fjord 계획 담당자 Farah", summary: [{ text: "[[Farah]]가 [[Fjord 검색]] 계획을 맡고 있어요.", lines: ["d0000000000e"] }], points: [] },
  { lineIds: ["d0000000002e"], title: "Jasper 초안에 의견 전달", summary: [{ text: "[[Jonas]]가 Jasper 초안에 의견을 보냈어요.", lines: ["d0000000002e"] }], points: [] },
  { lineIds: ["d00000000041"], title: "보안 검토에서 Garnet 이야기가 나왔어요", summary: [{ text: "Garnet 리뷰에서 [[보안 검토]] 관련 내용이 나왔어요.", lines: ["d00000000041"] }], points: [] },
  { lineIds: ["d0000000002d", "d0000000002c"], title: "Iris와 Jonas, Ember 초안 의견 전달", summary: [{ text: "[[Iris]]는 이번 주 [[Jonas]]와 함께 일해요.", lines: ["d0000000002d"] }, { text: "[[Iris]]는 Ember 초안에 의견을 보냈어요.", lines: ["d0000000002c"] }], points: [] },
  { lineIds: ["d0000000000d"], title: "Ember 모바일 고객 피드백 검토", summary: [{ text: "[[Ravi]]가 [[고객 피드백]] 부분을 검토하고 있어요.", lines: ["d0000000000d"] }], points: [] },
  { lineIds: ["d0000000000c"], title: "Ember 모바일 계획 담당자 Elif", summary: [{ text: "[[Ember 모바일]]의 계획은 [[Elif]]가 맡고 있어요.", lines: ["d0000000000c"] }], points: [] },
  { lineIds: ["d0000000002b"], title: "Lumen 초안 의견 전달", summary: [{ text: "[[Hiro]]가 Lumen 초안에 의견을 보냈어요.", lines: ["d0000000002b"] }], points: [] },
  { lineIds: ["d0000000002a", "d00000000029"], title: "Gus와 Hiro의 협업 및 Garnet 초안 의견", summary: [{ text: "[[Gus]]는 이번 주 [[Hiro]]와 함께 일해요.", lines: ["d0000000002a"] }, { text: "[[Gus]]는 Garnet 초안에 의견을 보냈어요.", lines: ["d00000000029"] }], points: [] },
  { lineIds: ["d0000000000b"], title: "Delta 가격 개편 일정 순서", summary: [{ text: "[[Delta 가격 개편]]은 Ember가 먼저 끝나야 해요.", lines: ["d0000000000b"] }], points: [] },
  { lineIds: ["d0000000000a"], title: "Delta 가격 개편 보안 검토 진행", summary: [{ text: "[[Oscar]]가 [[Delta 가격 개편]]의 [[보안 검토]] 부분을 검토하고 있어요.", lines: ["d0000000000a"] }], points: [] },
  { lineIds: ["d00000000009", "d00000000040"], title: "Delta 가격 개편 계획 담당자 Dev", summary: [{ text: "[[Dev]]가 [[Delta 가격 개편]] 계획을 맡고 있어요.", lines: ["d00000000009"] }, { text: "이 내용은 [[채용]] 관련 Ember 리뷰에서도 나왔어요.", lines: ["d00000000040"] }], points: [] },
  { lineIds: ["d00000000028"], title: "Beacon 초안 의견 전달", summary: [{ text: "[[Farah]]이 Beacon 초안에 의견을 보냈어요.", lines: ["d00000000028"] }], points: [] },
  { lineIds: ["d00000000027", "d00000000026"], title: "Elif의 Ionic 초안 의견과 Farah와의 협업", summary: [{ text: "[[Elif]]은 이번 주 [[Farah]]와 함께 일해요.", lines: ["d00000000027"] }, { text: "[[Elif]]은 [[Ionic SSO]] 초안에 의견을 보냈어요.", lines: ["d00000000026"] }], points: [] },
  { lineIds: ["ba0000000001", "ba0000000002", "d00000000008"], title: "이번 주 우선순위와 Harbor 출시 연기", summary: [{ text: "[[이번 주 우선순위]]는 [[Juniper 릴리스]] 출시와 [[스테이징 배포]] 전환이에요.", lines: ["ba0000000001"] }, { text: "[[Harbor 인보이스 출시]]는 다음 주로 미뤘고 [[Nora]]도 동의했어요.", lines: ["ba0000000002"] }], points: [{ text: "[[Lena]]가 [[채용]] 부분을 검토하고 있어요.", lines: ["d00000000008"] }] },
  { lineIds: ["d00000000007"], title: "Cobalt API 계획 담당자", summary: [{ text: "[[Cobalt API]]의 계획은 [[Cleo]]가 맡고 있어요.", lines: ["d00000000007"] }], points: [] },
  { lineIds: ["b20000000002", "b70000000001", "b70000000002", "b70000000003", "d00000000025"], title: "Atlas CSV 내보내기 검토 현황", summary: [{ text: "[[Mira]]가 [[Atlas CSV 내보내기]] 최종 검토를 맡고 있어요.", lines: ["b20000000002", "b70000000003"] }, { text: "UTF-8 BOM 검증은 끝났고, 목요일 전에 CRLF 출력 테스트가 남아 있어요.", lines: ["b70000000001", "b70000000002"] }], points: [] },
  { lineIds: ["d0000000003f"], title: "Cobalt 리뷰에서 나온 디자인 시스템 이야기", summary: [{ text: "[[디자인 시스템]] 페이지에 Cobalt 리뷰에서 나왔다는 내용이 기록되어 있어요.", lines: ["d0000000003f"] }], points: [] },
  { lineIds: ["d00000000006"], title: "Beacon 온보딩 데모 금요일로 잡힘", summary: [{ text: "[[Beacon 온보딩]] 데모는 금요일로 잡혔어요.", lines: ["d00000000006"] }], points: [] },
  { lineIds: ["d00000000024", "d00000000023"], title: "Cleo, Kestrel 초안 의견 전달", summary: [{ text: "[[Cleo]]는 이번 주 [[Dev]]와 함께 일해요.", lines: ["d00000000024"] }, { text: "[[Cleo]]는 [[Kestrel 릴리스]] 초안에 의견을 보냈어요.", lines: ["d00000000023"] }], points: [] },
  { lineIds: ["d00000000005"], title: "Beacon 온보딩 디자인 시스템 검토", summary: [{ text: "[[Iris]]가 [[Beacon 온보딩]]의 [[디자인 시스템]] 부분을 검토하고 있어요.", lines: ["d00000000005"] }], points: [] },
  { lineIds: ["d00000000004"], title: "Beacon 온보딩 계획 담당자 Bram", summary: [{ text: "[[Beacon 온보딩]]의 계획은 [[Bram]]이 맡고 있어요.", lines: ["d00000000004"] }], points: [] },
  { lineIds: ["d00000000022"], title: "Fjord 초안 의견 전달", summary: [{ text: "[[Bram]]이 Fjord 초안에 의견을 보냈어요.", lines: ["d00000000022"] }], points: [] },
  { lineIds: ["d00000000003"], title: "Aurora 대시보드 선행 작업", summary: [{ text: "[[Beacon 온보딩]]이 먼저 끝나야 해요.", lines: ["d00000000003"] }], points: [] },
  { lineIds: ["b50000000001", "b60000000001", "d00000000021", "d00000000002", "d00000000020", "b10000000001", "b10000000004", "b10000000002", "b30000000001", "b10000000006", "b10000000003", "b30000000002", "b40000000001", "d0000000003e"], title: "Juniper 릴리스 차단 해제, 스테이징 배포 승인 대기", summary: [{ text: "[[Juniper 릴리스]]는 [[Theo]]가 화요일에 [[결제 웹훅]] 수정을 배포하면서 차단이 풀렸어요.", lines: ["b10000000006", "b30000000002", "b40000000001"] }, { text: "[[스테이징 배포]]는 드라이런 42/42를 통과했고 운영 전환은 목요일 [[Hana]] 승인을 기다리고 있어요.", lines: ["b50000000001", "b60000000001"] }], points: [{ text: "[[Juniper 릴리스]]의 스테이징 스모크 테스트는 18/18로 통과했어요.", lines: ["b10000000001"] }, { text: "[[Juniper 릴리스]]의 목표일은 아직 정해지지 않았어요.", lines: ["b10000000004"] }, { text: "[[Ada]]는 이번 주 [[Bram]]와 함께 일해요.", lines: ["d00000000021"] }, { text: "[[Ada]]는 [[Aurora 대시보드]] 초안에 의견을 보냈어요.", lines: ["d00000000020"] }, { text: "[[Farah]]가 [[Aurora 대시보드]]의 [[요청 한도]] 부분을 검토하고 있어요.", lines: ["d00000000002", "d0000000003e"] }] },
  { lineIds: ["d00000000001", "b10000000009", "b10000000007", "b10000000008", "b20000000001"], title: "Juniper 출시일 월요일로 변경", summary: [{ text: "[[Juniper 릴리스]]의 목표일이 지원팀 인력 배치 때문에 월요일로 옮겨졌고, [[Mira]]가 승인했어요.", lines: ["b10000000007"] }], points: [{ text: "[[Mira]]가 Slack에서 금요일엔 지원팀이 비어 있으니 출시를 월요일로 옮기자고 제안했어요.", lines: ["b10000000009"] }, { text: "[[Mira]]가 목요일에 릴리스를 승인했어요.", lines: ["b10000000008", "b20000000001"] }] },
];
