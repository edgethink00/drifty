import { describe, expect, it } from "vitest";
import { localizedCategoryLabel, localizedProductivityLabel } from "./activityTranslations";
import { localizeAiConnectionTestMessage, localizeAiStatusLabel } from "./aiStatusTranslations";
import { localizeSettingsError, localizeUpdateMessage } from "./settingsMessageTranslations";
import type { LocalizationController } from "./LocalizationContext";
import { ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS, type TranslationKey } from "./translations";
import { SPANISH_TRANSLATIONS } from "./spanishTranslations";

const spanishT: LocalizationController["t"] = (key, params) => interpolate(SPANISH_TRANSLATIONS[key], params);

describe("Spanish translations", () => {
  it("covers every English key with matching interpolation variables", () => {
    expect(Object.keys(SPANISH_TRANSLATIONS).sort()).toEqual(Object.keys(ENGLISH_TRANSLATIONS).sort());
    for (const key of Object.keys(ENGLISH_TRANSLATIONS) as TranslationKey[]) {
      expect(placeholders(SPANISH_TRANSLATIONS[key]), key).toEqual(placeholders(ENGLISH_TRANSLATIONS[key]));
    }
  });

  it("keeps tracking, trial and privacy language accurate", () => {
    expect(SPANISH_TRANSLATIONS["tracker.pause"]).toBe("Pausar el registro");
    expect(SPANISH_TRANSLATIONS["billing.plan.trialBadge"]).toContain("Prueba");
    expect(SPANISH_TRANSLATIONS["onboarding.entry.headline"]).toContain("drifty");
    expect(SPANISH_TRANSLATIONS["settings.privacy.rawChip"]).toContain("no público");
    expect(SPANISH_TRANSLATIONS["settings.aiPrivacy.rawLocal"]).toContain("no se envía al proveedor de IA");
    expect(SPANISH_TRANSLATIONS["settings.account.syncRetention"]).toMatch(/elimina.*60 días/);
    expect(SPANISH_TRANSLATIONS["settings.account.deleteCloudDescription"]).toContain("actividad guardada en tus dispositivos");
  });

  it("keeps raw settings failures actionable in Spanish", () => {
    expect(localizeSettingsError("network unavailable", "es", spanishT))
      .toBe("No se pudo completar esta acción. Detalles: network unavailable");
  });
});

const koreanT: LocalizationController["t"] = (key, params) => interpolate(KOREAN_TRANSLATIONS[key], params);

describe("Korean translations", () => {
  it("uses the agreed activity vocabulary", () => {
    expect(localizedProductivityLabel("focus", koreanT)).toBe("집중");
    expect(localizedProductivityLabel("drift", koreanT)).toBe("딴짓");
    expect(localizedProductivityLabel("neutral", koreanT)).toBe("중립");
    expect(localizedCategoryLabel("workspace", koreanT)).toBe("작업");
    expect(localizedCategoryLabel("communication", koreanT)).toBe("커뮤니케이션");
    expect(localizedCategoryLabel("utility", koreanT)).toBe("유틸리티");
    expect(localizedCategoryLabel("unknown", koreanT)).toBe("미분류");
  });

  it("keeps the split onboarding hint grammatically joined", () => {
    const sentence = [
      KOREAN_TRANSLATIONS["onboarding.job.hintBefore"],
      KOREAN_TRANSLATIONS["onboarding.job.hintStrong"],
      KOREAN_TRANSLATIONS["onboarding.job.hintAfter"],
    ].join(" ");

    expect(sentence).toContain("자동 분류하므로 타임라인이");
    expect(sentence).not.toMatch(/\s[.!?]/u);
  });

  it("localizes known AI status labels without changing provider names", () => {
    expect(localizeAiStatusLabel("AI setup needed", koreanT)).toBe("AI 설정 필요");
    expect(localizeAiStatusLabel("Sign-in needed", koreanT)).toBe("로그인 필요");
    expect(localizeAiStatusLabel("1,234 left", koreanT)).toBe("1,234개 남음");
    expect(localizeAiStatusLabel("Qwen 3.5", koreanT)).toBe("Qwen 3.5");
  });

  it("localizes connection-test outcomes and wraps unknown technical errors", () => {
    expect(localizeAiConnectionTestMessage("Connected in 24 ms.", "success", "ko", koreanT)).toBe("연결 완료 · 24ms");
    expect(localizeAiConnectionTestMessage("Cloud AI connected in 88 ms.", "success", "ko", koreanT)).toBe("Cloud AI 연결 완료 · 88ms");
    expect(localizeAiConnectionTestMessage("socket closed", "error", "ko", koreanT)).toBe("연결하지 못했습니다. 설정과 네트워크를 확인한 뒤 다시 시도하세요. 세부 정보: socket closed");
    expect(localizeAiConnectionTestMessage("Provider returned HTTP 401.", "error", "ko", koreanT)).toContain("API 키와 제공업체 권한을 확인하세요");
    expect(localizeAiConnectionTestMessage(
      "The endpoint returned a web page instead of an API response. Check the base URL; it usually ends in /v1.",
      "error", "ko", koreanT,
    )).toBe("엔드포인트가 API 응답 대신 웹 페이지를 반환했습니다. 기본 URL을 확인하세요. 보통 /v1로 끝납니다.");
    expect(localizeAiConnectionTestMessage(
      "The endpoint returned a server error (HTTP 502). Check the server and the account it uses.",
      "error", "ko", koreanT,
    )).toBe("엔드포인트에서 서버 오류가 발생했습니다(HTTP 502). 서버와 서버가 쓰는 계정 상태를 확인하세요.");
    expect(localizeAiConnectionTestMessage("socket closed", "error", "en", koreanT)).toBe("socket closed");
    expect(localizeAiConnectionTestMessage(
      'The endpoint does not have the model "gpt-6-luna--fast". Use Fetch models to choose one it lists.',
      "error", "ko", koreanT,
    )).toBe('엔드포인트에 "gpt-6-luna--fast" 모델이 없습니다. 모델 불러오기로 제공되는 모델을 고르세요.');
    expect(localizeAiConnectionTestMessage("The endpoint returned HTTP 401: Your session expired.", "error", "ko", koreanT))
      .toBe("엔드포인트 응답 HTTP 401: Your session expired.");
  });

  it("avoids placeholder Korean particles in user-facing copy", () => {
    const placeholderParticles = ["을(를)", "이(가)", "은(는)", "와(과)", "으로(로)"];
    expect(Object.values(KOREAN_TRANSLATIONS).filter((value) => placeholderParticles.some((particle) => value.includes(particle)))).toEqual([]);
  });

  it("uses consistent Korean labels for localized beta terms", () => {
    expect(KOREAN_TRANSLATIONS["common.beta"]).toBe("베타");
    expect(KOREAN_TRANSLATIONS["common.new"]).toBe("신규");
    expect(KOREAN_TRANSLATIONS["billing.plan.proNote"]).toBe("최고 성능의 AI");
    expect(Object.values(KOREAN_TRANSLATIONS).filter((value) => value.includes("Local AI"))).toEqual([]);
  });

  it("uses device-neutral copy for records and account data on Windows and Mac", () => {
    expect(koreanT("history.deleteConfirmDetailSingle")).toBe("이 기기에서 로컬 활동 기록 1개를 삭제합니다.");
    expect(koreanT("history.deleteConfirmDetail", { count: 3 })).toBe("이 기기에서 로컬 활동 기록 3개를 삭제합니다.");
    expect(KOREAN_TRANSLATIONS["settings.account.deleteRetainedHeading"]).toBe("이 기기에 남는 항목");
    expect(KOREAN_TRANSLATIONS["settings.account.deleteLocalImpact"]).toContain("이 기기의 활동 기록");
    expect(KOREAN_TRANSLATIONS["billing.plan.proFeature4"]).toContain("최대 3대");
    for (const table of [ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS]) {
      expect(Object.values(table).filter((value) => /Mac/u.test(value))).toEqual([]);
    }
  });

  it("keeps interpolation parameters aligned with the English source", () => {
    for (const key of Object.keys(ENGLISH_TRANSLATIONS) as TranslationKey[]) {
      const englishPlaceholders = placeholders(ENGLISH_TRANSLATIONS[key]);
      const koreanPlaceholders = placeholders(KOREAN_TRANSLATIONS[key]);
      if (key === "settings.appearance.customColorAria") {
        expect(koreanPlaceholders, key).toEqual(["label"]);
        continue;
      }
      expect(koreanPlaceholders, key).toEqual(englishPlaceholders);
    }
  });

  it("describes raw history against public and AI boundaries, not as always local", () => {
    expect(KOREAN_TRANSLATIONS["settings.privacy.rawChip"]).toBe("원본 기록은 공개 안 함");
    expect(KOREAN_TRANSLATIONS["settings.aiPrivacy.rawLocal"]).toContain("AI 제공업체에 전송하지 않음");
    expect(KOREAN_TRANSLATIONS["settings.account.syncRetention"]).toMatch(/이용 권한이 끝나면.*60일.*삭제/);
    expect(KOREAN_TRANSLATIONS["settings.account.deleteCloudDescription"]).toMatch(/각 기기에 저장된 활동은 그대로/);
  });

  it("keeps Korean account-deletion claims aligned with actual deletion and retention behavior", () => {
    expect(KOREAN_TRANSLATIONS["settings.account.deleteCloudImpact"]).toMatch(/있다면 즉시 종료/);
    expect(KOREAN_TRANSLATIONS["settings.account.deleteLocalImpact"]).toMatch(/삭제되지 않습니다.*동기화는 꺼지고.*클라우드 사본은 삭제/);
    expect(KOREAN_TRANSLATIONS["settings.account.deleteFutureSyncImpact"]).toMatch(/다른 계정.*업로드될 수/);
    expect(KOREAN_TRANSLATIONS["settings.account.deleteBillingRetention"]).toMatch(/Polar.*과거 결제 기록이 남/);
    expect(KOREAN_TRANSLATIONS["settings.account.deleteAnalyticsRetention"]).toMatch(/PostHog.*삭제되지/);
    expect(KOREAN_TRANSLATIONS["settings.account.deleteTeamsImpact"]).toMatch(/다른 멤버.*계정 삭제를 차단/);
    // Owners can now clear a shared team themselves, so the blocked message
    // names those exits instead of saying cleanup is unsupported.
    expect(KOREAN_TRANSLATIONS["settings.account.deleteErrorSharedTeam"]).toMatch(/데이터를 보호.*계정 삭제를 차단.*팀 설정에서 멤버를 내보내거나 팀을 삭제/);
    expect(ENGLISH_TRANSLATIONS["settings.account.deleteErrorSharedTeam"]).toContain("delete the team in Team settings");
    expect(KOREAN_TRANSLATIONS["settings.account.deleteErrorSharedTeamAfterBilling"]).toMatch(/팀 설정에서.*팀을 삭제/);
    expect(ENGLISH_TRANSLATIONS["settings.account.deleteErrorSharedTeamAfterBilling"]).toContain("delete the team in Team settings");
    for (const key of ["settings.account.deleteErrorSharedTeam", "settings.account.deleteErrorSharedTeamAfterBilling"] as const) {
      expect(KOREAN_TRANSLATIONS[key]).not.toContain("지원하지 않습니다");
      expect(ENGLISH_TRANSLATIONS[key]).not.toContain("does not yet support");
    }
    expect(KOREAN_TRANSLATIONS["settings.account.deleteErrorSharedTeam"]).not.toContain("지원팀");
    // The app can now release an organization seat, so the blocked message has
    // to name that exit instead of reading as a dead end.
    expect(KOREAN_TRANSLATIONS["settings.account.deleteErrorSharedTeam"]).toContain("팀을 나가");
    expect(ENGLISH_TRANSLATIONS["settings.account.deleteErrorSharedTeam"]).toContain("leave that team");
    expect(KOREAN_TRANSLATIONS["settings.account.deleteErrorBillingStopped"]).toMatch(/결제 고객 정리는 완료.*구독이 있었다면 종료.*계정 삭제는 끝나지/);
    expect(KOREAN_TRANSLATIONS["settings.account.deleteErrorGuestBillingCleared"]).toMatch(/결제 고객은 정리.*게스트 계정 삭제가 끝나지/);
    expect(KOREAN_TRANSLATIONS["settings.account.deleteErrorGuestBillingCleared"]).not.toContain("구독");
  });

  it("localizes update states and preserves technical error details", () => {
    expect(localizeUpdateMessage("Drifty 1.2.17 is available.", "status", "ko", koreanT)).toBe("새 버전 설치 가능 · Drifty 1.2.17");
    expect(localizeUpdateMessage("Update check failed: offline", "error", "ko", koreanT)).toBe("업데이트를 확인하지 못했습니다. 세부 정보: offline");
    expect(localizeSettingsError("network unavailable", "ko", koreanT)).toBe("작업을 완료하지 못했습니다. 세부 정보: network unavailable");
    expect(localizeSettingsError("network unavailable", "en", koreanT)).toBe("network unavailable");
  });
});

function placeholders(value: string): string[] {
  return Array.from(value.matchAll(/\{\{(\w+)\}\}/gu), (match) => match[1]).sort();
}

function interpolate(
  template: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/gu, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}
