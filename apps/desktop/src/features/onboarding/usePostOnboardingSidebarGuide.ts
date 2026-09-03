import { useCallback, useEffect, useState } from "react";
import {
  POST_ONBOARDING_SIDEBAR_GUIDE_LIFETIME_MS,
  advancePostOnboardingSidebarGuide,
  beginPostOnboardingSidebarGuide,
  completePostOnboardingSidebarGuide,
  dismissPostOnboardingSidebarGuide,
  persistPostOnboardingSidebarGuideRecord,
  readPostOnboardingSidebarGuideRecord,
  resolvePostOnboardingSidebarGuideRecord,
  restartPostOnboardingSidebarGuide,
  retreatPostOnboardingSidebarGuide,
  type PostOnboardingSidebarGuideRecord,
} from "./postOnboardingSidebarGuide";

type PostOnboardingSidebarGuideSnapshot = {
  readonly userId: string;
  readonly record: PostOnboardingSidebarGuideRecord | null;
};

export function usePostOnboardingSidebarGuide(userId: string) {
  const [snapshot, setSnapshot] = useState<PostOnboardingSidebarGuideSnapshot>(() => ({
    userId,
    record: resolvePostOnboardingSidebarGuideRecord(readPostOnboardingSidebarGuideRecord(userId)),
  }));
  const record = snapshot.userId === userId ? snapshot.record : null;

  useEffect(() => {
    const next = resolvePostOnboardingSidebarGuideRecord(readPostOnboardingSidebarGuideRecord(userId));
    setSnapshot({ userId, record: next });
    if (next?.status === "expired") persistPostOnboardingSidebarGuideRecord(userId, next);
  }, [userId]);

  useEffect(() => {
    if (record?.status !== "active") return undefined;
    const expiresAt = Date.parse(record.startedAt) + POST_ONBOARDING_SIDEBAR_GUIDE_LIFETIME_MS;
    const timeout = window.setTimeout(() => {
      setSnapshot((current) => {
        if (current.userId !== userId) return current;
        const next = resolvePostOnboardingSidebarGuideRecord(current.record);
        if (next?.status === "expired") persistPostOnboardingSidebarGuideRecord(userId, next);
        return { userId, record: next };
      });
    }, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [record?.startedAt, record?.status, userId]);

  const update = useCallback((transform: (current: PostOnboardingSidebarGuideRecord) => PostOnboardingSidebarGuideRecord) => {
    setSnapshot((current) => {
      const source = current.userId === userId
        ? current.record
        : resolvePostOnboardingSidebarGuideRecord(readPostOnboardingSidebarGuideRecord(userId));
      if (!source) return { userId, record: null };
      const next = transform(source);
      persistPostOnboardingSidebarGuideRecord(userId, next);
      return { userId, record: next };
    });
  }, [userId]);

  const begin = useCallback(() => {
    setSnapshot((current) => {
      const stored = current.userId === userId
        ? current.record ?? readPostOnboardingSidebarGuideRecord(userId)
        : readPostOnboardingSidebarGuideRecord(userId);
      const next = beginPostOnboardingSidebarGuide(stored);
      persistPostOnboardingSidebarGuideRecord(userId, next);
      return { userId, record: next };
    });
  }, [userId]);

  const restart = useCallback(() => {
    const next = restartPostOnboardingSidebarGuide();
    persistPostOnboardingSidebarGuideRecord(userId, next);
    setSnapshot({ userId, record: next });
  }, [userId]);

  return {
    isActive: record?.status === "active",
    step: record?.status === "active" ? record.step : null,
    begin,
    restart,
    advance: useCallback(() => update((current) => advancePostOnboardingSidebarGuide(current)), [update]),
    retreat: useCallback(() => update((current) => retreatPostOnboardingSidebarGuide(current)), [update]),
    complete: useCallback(() => update((current) => completePostOnboardingSidebarGuide(current)), [update]),
    dismiss: useCallback(() => update((current) => dismissPostOnboardingSidebarGuide(current)), [update]),
  };
}
