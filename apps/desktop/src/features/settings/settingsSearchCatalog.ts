import type { TranslationKey } from "../localization/translations";
import type { SettingsSection } from "./SettingsSidebar";
import { DEV_SETTINGS_SUBSECTIONS, type DevSettingsSubsection } from "./devSettingsNavigation";

export type SettingsSearchEntry = {
  readonly id: string;
  readonly section: SettingsSection;
  readonly titleKey: TranslationKey;
  readonly descriptionKey?: TranslationKey;
  readonly keywords?: string;
  readonly reveal?: string;
  readonly aiTab?: "providers" | "intelligence" | "profile";
  readonly aiProvider?: "openrouter" | "custom";
  readonly devSubsection?: DevSettingsSubsection;
  readonly gate?: "dev" | "intelligence" | "backgroundUpdates" | "authenticated" | "deviceSync" | "accessibility";
};

// Reuse visible labels and descriptions; aliases contain vocabulary only.
// Each id is anchored on the owning row or block, never a setting value.
export const SETTINGS_SECTION_LABELS: Record<SettingsSection, TranslationKey> = {
  "general": "settings.section.general",
  "appearance": "settings.section.appearance",
  "pet": "settings.pet.title",
  "notifications": "settings.section.notifications",
  "permissions": "settings.section.permissions",
  "account": "settings.section.account",
  "privacy": "settings.section.privacy",
  "aiSetup": "settings.section.aiSetup",
  "classification": "classification.rules.title",
  "developer": "settings.section.developer",
  "dev": "common.dev"
};

export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  {
    id: "settings.general.language",
    section: "general",
    titleKey: "settings.general.language",
    keywords: "언어 한국어 영어 English Korean",
    descriptionKey: "settings.general.languageDescription",
  },
  {
    id: "settings.general.startOfDay",
    section: "general",
    titleKey: "settings.general.startOfDay",
    keywords: "자정 날짜 기준 하루 시작 midnight day boundary",
    descriptionKey: "settings.general.startOfDayDescription",
  },
  {
    id: "settings.general.startOfWeek",
    section: "general",
    titleKey: "settings.general.startOfWeek",
    keywords: "요일 월요일 일요일 Monday Sunday week",
    descriptionKey: "settings.general.startOfWeekDescription",
  },
  {
    id: "settings.general.dayReviewTime",
    section: "general",
    titleKey: "settings.general.dayReviewTime",
    keywords: "하루 리뷰 일일 요약 daily review summary",
    descriptionKey: "settings.general.dayReviewTimeDescription",
  },
  {
    id: "settings.general.openAtLogin",
    section: "general",
    titleKey: "settings.general.openAtLogin",
    keywords: "자동 실행 자동실행 시작 프로그램 부팅 startup launch login autostart",
    descriptionKey: "settings.general.openAtLoginDescription",
  },
  {
    id: "settings.general.autoUpdates",
    section: "general",
    titleKey: "settings.general.autoUpdates",
    keywords: "자동 업데이트 update download",
    descriptionKey: "settings.general.autoUpdatesDescription",
    gate: "backgroundUpdates",
  },
  {
    id: "settings.general.manualUpdate",
    section: "general",
    titleKey: "settings.general.manualUpdate",
    keywords: "업데이트 버전 확인 update version check",
    descriptionKey: "settings.general.manualUpdateDescription",
  },
  {
    id: "settings.appearance.theme",
    section: "appearance",
    titleKey: "settings.appearance.theme",
    keywords: "다크 모드 라이트 모드 dark mode light mode 테마",
    descriptionKey: "settings.appearance.themeDescription",
  },
  {
    id: "settings.appearance.categoryColors",
    section: "appearance",
    titleKey: "settings.appearance.categoryColors",
    keywords: "카테고리 색상 category color",
    descriptionKey: "settings.appearance.categoryColorsDescription",
    reveal: "appearance-colors",
  },
  {
    id: "settings.appearance.accent",
    section: "appearance",
    titleKey: "settings.appearance.accent",
    keywords: "강조색 포인트색 accent color",
    descriptionKey: "settings.appearance.accentDescription",
    reveal: "appearance-colors",
  },
  {
    id: "settings.appearance.productivityColors",
    section: "appearance",
    titleKey: "settings.appearance.productivityColors",
    keywords: "집중 딴짓 중립 색상 focus drift neutral colors",
    descriptionKey: "settings.appearance.productivityColorsDescription",
    reveal: "appearance-colors",
  },
  {
    id: "settings.pet.show",
    section: "pet",
    titleKey: "settings.pet.show",
    keywords: "고양이 펫 켜기 끄기 cat pet on off hide show",
  },
  {
    id: "settings.pet.presence",
    section: "pet",
    titleKey: "settings.pet.presence",
    keywords: "고양이 펫 항상 딴짓할 때만 화면 밖 숨기기 cat pet always drift only off screen",
    descriptionKey: "settings.pet.presenceDriftOnlyDescription",
  },
  {
    id: "settings.pet.coat",
    section: "pet",
    titleKey: "settings.pet.coat",
    keywords: "고양이 털 색상 무늬 cat fur coat color",
  },
  {
    id: "settings.pet.size",
    section: "pet",
    titleKey: "settings.pet.size",
    keywords: "고양이 크기 확대 축소 pet size zoom",
  },
  {
    id: "settings.pet.allowOutings",
    section: "pet",
    titleKey: "settings.pet.allowOutings",
    keywords: "고양이 외출 돌아다니기 roaming outings",
    descriptionKey: "settings.pet.allowOutingsDescription",
  },
  {
    id: "settings.companion.visibility",
    section: "notifications",
    titleKey: "settings.companion.visibility",
    keywords: "컴패니언 숨기기 끄기 알약 메뉴바 pill hide off menu bar",
  },
  {
    id: "settings.notifications.showDriftAlerts",
    section: "notifications",
    titleKey: "settings.notifications.showDriftAlerts",
    keywords: "알림 끄기 알람 끄기 딴짓 경고 알림 켜기 notifications alarms disable alerts",
    descriptionKey: "settings.notifications.driftAlertsDescription",
  },
  {
    id: "settings.notifications.extreme",
    section: "notifications",
    titleKey: "settings.notifications.extreme",
    keywords: "자동 닫기 강제 종료 차단 close block distracting tabs apps",
    descriptionKey: "settings.notifications.extremeOnDescription",
  },
  {
    id: "settings.notifications.timing",
    section: "notifications",
    titleKey: "settings.notifications.timing",
    keywords: "알림 시간 지연 주기 delay alert timing",
  },
  {
    id: "settings.alarmCopy.label",
    section: "notifications",
    titleKey: "settings.alarmCopy.label",
    keywords: "알림 문구 메시지 커스텀 notification message copy",
    descriptionKey: "settings.alarmCopy.description",
  },
  {
    id: "settings.permissions.title",
    section: "permissions",
    titleKey: "settings.permissions.title",
    keywords: "권한 전체 디스크 접근 Safari history full disk access permission",
  },
  {
    id: "settings.permissions.accessibility",
    section: "permissions",
    titleKey: "settings.permissions.accessibility",
    keywords: "손쉬운 사용 접근성 창 제목 accessibility window title",
    descriptionKey: "settings.permissions.accessibilityDescription",
    gate: "accessibility",
  },
  {
    id: "settings.permissions.notifications",
    section: "permissions",
    titleKey: "settings.permissions.notifications",
    keywords: "시스템 알림 권한 허용 notification permission",
    descriptionKey: "settings.permissions.notificationsDescription",
  },
  {
    id: "settings.section.account",
    section: "account",
    titleKey: "settings.section.account",
    keywords: "구독 결제 요금제 가격 Pro 플랜 billing subscription pricing payment calendar 캘린더",
  },
  {
    id: "settings.account.signedIn",
    section: "account",
    titleKey: "settings.account.signedIn",
    keywords: "로그인 계정 이메일 login sign in email account",
  },
  {
    id: "settings.account.publicProfile",
    section: "account",
    titleKey: "settings.account.publicProfile",
    keywords: "공개 프로필 리더보드 이름 profile leaderboard display name",
    descriptionKey: "settings.account.profileDescription",
  },
  {
    id: "settings.account.syncMacs",
    section: "account",
    titleKey: "settings.account.syncMacs",
    keywords: "기기 동기화 맥 동기화 device sync macs",
    descriptionKey: "settings.account.syncDescription",
    gate: "deviceSync",
  },
  {
    id: "settings.account.deleteTitle",
    section: "account",
    titleKey: "settings.account.deleteTitle",
    keywords: "회원 탈퇴 계정 삭제 delete account",
    descriptionKey: "settings.account.deleteSettingsDescription",
    gate: "authenticated",
  },
  {
    id: "settings.account.couponTitle",
    section: "account",
    titleKey: "settings.account.couponTitle",
    keywords: "프로모션 할인 쿠폰 코드 promo coupon discount",
    reveal: "coupon",
  },
  {
    id: "settings.privacy.aiSending",
    section: "privacy",
    titleKey: "settings.privacy.aiSending",
    keywords: "AI 전송 개인정보 privacy sending consent 데이터 제공",
    descriptionKey: "settings.privacy.aiSubtitle",
    reveal: "privacy-ai",
  },
  {
    id: "settings.data.database",
    section: "privacy",
    titleKey: "settings.data.database",
    keywords: "로컬 데이터베이스 저장 경로 local database storage path",
  },
  {
    id: "settings.data.iconCache",
    section: "privacy",
    titleKey: "settings.data.iconCache",
    keywords: "아이콘 캐시 비우기 clear icon cache",
    descriptionKey: "settings.data.iconCacheDescription",
  },
  {
    id: "settings.privacy.deleteTitle",
    section: "privacy",
    titleKey: "settings.privacy.deleteTitle",
    keywords: "데이터 삭제 기록 삭제 활동 삭제 history delete clear data",
    descriptionKey: "settings.privacy.deleteDescription",
  },
  {
    id: "settings.developer.cliTitle",
    section: "developer",
    titleKey: "settings.developer.cliTitle",
    keywords: "CLI 터미널 명령줄 설치 command line install terminal",
  },
  {
    id: "settings.developer.skillSectionTitle",
    section: "developer",
    titleKey: "settings.developer.skillSectionTitle",
    keywords: "에이전트 스킬 agent skill codex claude",
  },
  {
    id: "settings.developer.skillPathLabel",
    section: "developer",
    titleKey: "settings.developer.skillPathLabel",
    keywords: "스킬 파일 경로 agent skill path",
  },
  {
    id: "classification.rules.title",
    section: "classification",
    titleKey: "classification.rules.title",
    keywords: "수동 분류 규칙 수정 사이트 앱 custom manual classification rules",
  },
  {
    id: "settings.classification.addDomain",
    section: "classification",
    titleKey: "settings.classification.addDomain",
    keywords: "도메인 사이트 URL 규칙 website domain rule",
    descriptionKey: "settings.classification.addDomainDescription",
    reveal: "classification-add",
  },
  {
    id: "settings.classification.addApp",
    section: "classification",
    titleKey: "settings.classification.addApp",
    keywords: "앱 프로그램 규칙 application app rule",
    descriptionKey: "settings.classification.addAppDescription",
    reveal: "classification-add",
  },
  {
    id: "settings.ai.modelBeingUsed",
    section: "aiSetup",
    titleKey: "settings.ai.modelBeingUsed",
    keywords: "AI 모델 로컬 클라우드 다운로드 LLM model local cloud provider",
    aiTab: "providers",
  },
  {
    id: "settings.ai.openRouterApiKey",
    section: "aiSetup",
    titleKey: "settings.ai.openRouterApiKey",
    keywords: "API 키 API key OpenRouter BYOK 연결 인증",
    aiTab: "providers",
    aiProvider: "openrouter",
  },
  {
    id: "settings.ai.customEndpoint",
    section: "aiSetup",
    titleKey: "settings.ai.customEndpoint",
    keywords: "커스텀 서버 엔드포인트 Ollama LM Studio URL API 키 custom endpoint self hosted",
    aiTab: "providers",
    aiProvider: "custom",
  },
  {
    id: "settings.ai.intelligence",
    section: "aiSetup",
    titleKey: "settings.ai.intelligence",
    keywords: "프로젝트 분석 모델 project analysis intelligence",
    aiTab: "intelligence",
    gate: "intelligence",
  },
  {
    id: "settings.ai.workProfile",
    section: "aiSetup",
    titleKey: "settings.ai.workProfile",
    keywords: "업무 프로필 직업 하는 일 work profile job context",
    aiTab: "profile",
    reveal: "work-profile",
  },
  {
    id: "settings.ai.memoryHeroTitle",
    section: "aiSetup",
    titleKey: "settings.ai.memoryHeroTitle",
    keywords: "메모리 기억 학습 memory learned patterns Soul",
    aiTab: "profile",
  },
  ...DEV_SETTINGS_SUBSECTIONS.map((subsection): SettingsSearchEntry => ({
    id: `dev-${subsection.id}`, section: "dev", titleKey: subsection.labelKey,
    keywords: "개발자 디버그 진단 debug developer diagnostics", gate: "dev", devSubsection: subsection.id,
  })),
];
