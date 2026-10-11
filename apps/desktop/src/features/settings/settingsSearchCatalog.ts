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
  readonly gate?: "dev" | "intelligence" | "backgroundUpdates" | "authenticated" | "deviceSync" | "accessibility" | "windows" | "promoCode" | "friendInvite";
};

// Reuse visible labels and descriptions; aliases contain vocabulary only.
// Each id is anchored on the owning row or block, never a setting value.
export const SETTINGS_SECTION_LABELS: Record<SettingsSection, TranslationKey> = {
  "general": "settings.section.general",
  "appearance": "settings.section.appearance",
  "pet": "settings.pet.title",
  "notifications": "settings.section.notifications",
  "account": "settings.section.account",
  "privacy": "settings.section.privacy",
  "aiSetup": "settings.section.aiSetup",
  "classification": "classification.rules.title",
  "developer": "settings.section.developer",
  "dev": "common.dev"
};

/** The friend invite card's block; the account menu shortcut lands here too. */
export const FRIEND_INVITE_SETTING_ID = "settings.account.friendInviteSection";

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
  },
  {
    id: "settings.general.devMode",
    section: "general",
    titleKey: "settings.general.devMode",
    keywords: "개발자 모드 베타 업데이트 진단 미리보기 developer mode beta update diagnostics preview",
    descriptionKey: "settings.general.devModeDescriptionWindows",
    gate: "windows",
  },
  {
    id: "settings.appearance.theme",
    section: "appearance",
    titleKey: "settings.appearance.theme",
    keywords: "다크 모드 라이트 모드 dark mode light mode 테마",
    descriptionKey: "settings.appearance.themeDescription",
  },
  {
    id: "settings.appearance.windowsBlur",
    section: "appearance",
    titleKey: "settings.windowsBlur.title",
    descriptionKey: "settings.windowsBlur.description",
    keywords: "블러 배경 투명 불투명 blur background transparency opaque",
    gate: "windows",
  },
  {
    id: "settings.appearance.categoryColors",
    section: "appearance",
    titleKey: "settings.appearance.categoryColors",
    keywords: "카테고리 색상 category color",
  },
  {
    id: "settings.appearance.accent",
    section: "appearance",
    titleKey: "settings.appearance.accent",
    keywords: "강조색 포인트색 accent color",
    descriptionKey: "settings.appearance.accentDescription",
  },
  {
    id: "settings.appearance.productivityColors",
    section: "appearance",
    titleKey: "settings.appearance.productivityColors",
    keywords: "집중 딴짓 중립 색상 focus drift neutral colors",
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
    id: "settings.pet.showHoverControls",
    section: "pet",
    titleKey: "settings.pet.showHoverControls",
    descriptionKey: "settings.pet.showHoverControlsDescription",
    keywords: "고양이 호버 빠른 제어 바 촬영 화면 공유 숨기기 pet hover quick controls recording filming screen sharing hide toolbar",
  },
  {
    id: "settings.pet.allowOutings",
    section: "pet",
    titleKey: "settings.pet.allowOutings",
    keywords: "고양이 외출 돌아다니기 roaming outings",
    descriptionKey: "settings.pet.allowOutingsDescription",
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
    reveal: "notifications-drift",
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
    id: "settings.notifications.macosNotification",
    reveal: "notifications-drift",
    section: "notifications",
    titleKey: "settings.notifications.macosNotification",
    keywords: "맥 알림 알림 센터 배너 macOS notification center banner",
    descriptionKey: "settings.notifications.macosNotificationDescription",
  },
  {
    id: "settings.moments.celebrations",
    section: "notifications",
    titleKey: "settings.moments.celebrations",
    keywords: "축하 마일스톤 기록 리더보드 celebration milestone record confetti",
    descriptionKey: "settings.moments.celebrationsDescription",
  },
  {
    id: "settings.moments.dayReview",
    section: "notifications",
    titleKey: "settings.moments.dayReview",
    keywords: "하루 리뷰 일일 요약 daily review summary",
    descriptionKey: "settings.moments.dayReviewDescription",
  },
  {
    id: "settings.general.dayReviewTime",
    section: "notifications",
    titleKey: "settings.general.dayReviewTime",
    keywords: "하루 리뷰 시각 daily review time",
    descriptionKey: "settings.general.dayReviewTimeDescription",
  },
  {
    id: "settings.quietHours.enabled",
    section: "notifications",
    titleKey: "settings.quietHours.enabled",
    keywords: "조용한 시간 방해 금지 밤 야간 quiet hours do not disturb night",
    descriptionKey: "settings.quietHours.description",
  },
  {
    id: "settings.permissions.title",
    section: "general",
    titleKey: "settings.permissions.title",
    keywords: "권한 전체 디스크 접근 Safari history full disk access permission",
  },
  {
    id: "settings.permissions.accessibility",
    section: "general",
    titleKey: "settings.permissions.accessibility",
    keywords: "손쉬운 사용 접근성 창 제목 accessibility window title",
    descriptionKey: "settings.permissions.accessibilityDescription",
    gate: "accessibility",
  },
  {
    id: "settings.permissions.notifications",
    section: "general",
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
    gate: "promoCode",
  },
  {
    id: FRIEND_INVITE_SETTING_ID,
    section: "account",
    titleKey: "settings.account.friendInviteSection",
    keywords: "친구 초대 추천 선물 초대 코드 무료 refer referral invite friend gift free month code",
    gate: "friendInvite",
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
    id: "settings.privacy.excludedApps",
    section: "privacy",
    titleKey: "settings.privacy.excludedAppsTitle",
    keywords: "앱 제외 기록하지 않을 앱 password manager exclude unblock 비밀번호 관리자",
    descriptionKey: "settings.privacy.excludedAppsSubtitle",
  },
  {
    id: "settings.privacy.productAnalyticsTitle",
    reveal: "privacy-sharing",
    section: "privacy",
    titleKey: "settings.privacy.productAnalyticsTitle",
    keywords: "제품 사용 분석 통계 공유 analytics telemetry PostHog opt out 데이터 전송 끄기",
    descriptionKey: "settings.privacy.productAnalyticsDescription",
  },
  {
    id: "settings.privacy.driftySharing",
    reveal: "privacy-sharing",
    section: "privacy",
    titleKey: "settings.privacy.sharingDetails",
    keywords: "Drifty 데이터 공유 개인정보처리방침 privacy policy data use 원본 기록 공개 리더보드 프로필",
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
