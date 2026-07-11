import { describe, expect, it } from "vitest";
import { localizedCategoryLabel, localizedProductivityLabel } from "./activityTranslations";
import { localizeAiConnectionTestMessage, localizeAiStatusLabel } from "./aiStatusTranslations";
import { localizeSettingsError, localizeUpdateMessage } from "./settingsMessageTranslations";
import type { LocalizationController } from "./LocalizationContext";
import { ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS, type TranslationKey } from "./translations";

const koreanT: LocalizationController["t"] = (key, params) => interpolate(KOREAN_TRANSLATIONS[key], params);

describe("Korean translations", () => {
  it("uses the agreed activity vocabulary", () => {
    expect(localizedProductivityLabel("focus", koreanT)).toBe("집중");
    expect(localizedProductivityLabel("drift", koreanT)).toBe("딴짓");
    expect(localizedProductivityLabel("neutral", koreanT)).toBe("중립");
    expect(localizedCategoryLabel("workspace", koreanT)).toBe("업무");
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
    expect(localizeAiConnectionTestMessage("Cloud AI connected via OpenRouter in 88 ms.", "success", "ko", koreanT)).toBe("Cloud AI 연결 완료 · OpenRouter · 88ms");
    expect(localizeAiConnectionTestMessage("socket closed", "error", "ko", koreanT)).toBe("연결하지 못했습니다. 설정과 네트워크를 확인한 뒤 다시 시도하세요. 세부 정보: socket closed");
    expect(localizeAiConnectionTestMessage("Provider returned HTTP 401.", "error", "ko", koreanT)).toContain("API 키와 제공업체 권한을 확인하세요");
    expect(localizeAiConnectionTestMessage("socket closed", "error", "en", koreanT)).toBe("socket closed");
  });

  it("avoids placeholder Korean particles in user-facing copy", () => {
    expect(Object.values(KOREAN_TRANSLATIONS).filter((value) => value.includes("을(를)"))).toEqual([]);
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
