import type { DisplayLanguage } from "../localization/LocalizationContext";

const KOREAN_ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  Coding: "코딩",
  "Product & Planning": "제품·기획",
  Designing: "디자인",
  Writing: "글쓰기",
  "Writing & Content": "글쓰기·콘텐츠",
  Researching: "리서치",
  "Research & Learning": "리서치·공부",
  Studying: "공부",
  "Data Analysis": "데이터 분석",
  Marketing: "마케팅",
  "Marketing & Sales": "마케팅·영업",
  Sales: "영업",
  Trading: "트레이딩",
  "Customer Support": "고객 지원",
  "Content Creation": "콘텐츠 제작",
  "Meetings & Communication": "회의 및 커뮤니케이션",
  "Project Management": "프로젝트 관리",
  Operations: "운영",
  Other: "기타",
};

const KOREAN_DOMAIN_LABELS: Readonly<Record<string, string>> = {
  Tech: "기술",
  SaaS: "SaaS",
  AI: "AI",
  Fashion: "패션",
  Beauty: "뷰티",
  Cosmetics: "화장품",
  Education: "교육",
  Research: "연구",
  Media: "미디어",
  Content: "콘텐츠",
  "E-commerce": "전자상거래",
  Retail: "소매",
  Finance: "금융",
  Business: "비즈니스",
  Design: "디자인",
  Creative: "크리에이티브",
  Health: "건강",
  Wellness: "웰니스",
  Gaming: "게임",
  Architecture: "건축",
  Music: "음악",
  Film: "영화",
  "Food & Beverage": "식음료",
  "Real Estate": "부동산",
  "Non-profit": "비영리",
  Government: "공공기관",
  Other: "기타",
  "It changes often": "자주 바뀜",
};

export function onboardingActivityLabel(value: string, language: DisplayLanguage): string {
  return language === "ko" ? KOREAN_ACTIVITY_LABELS[value] ?? value : value;
}

export function onboardingDomainLabel(value: string, language: DisplayLanguage): string {
  return language === "ko" ? KOREAN_DOMAIN_LABELS[value] ?? value : value;
}
