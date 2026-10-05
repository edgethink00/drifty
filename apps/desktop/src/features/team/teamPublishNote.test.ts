import { describe, expect, it } from "vitest";
import { translateFor } from "../localization/translate";
import { localizedPublishNote, sharedProjectTimeNote } from "./teamPublishNote";

describe("team share notes", () => {
  it("says how much time was shared and across how many projects", () => {
    const note = sharedProjectTimeNote([
      { project_id: "project-a", activity_date: "2026-10-01", seconds: 3600 },
      { project_id: "project-a", activity_date: "2026-10-02", seconds: 1200 },
      { project_id: "project-b", activity_date: "2026-10-02", seconds: 300 },
    ]);
    expect(note).toBe("Shared 1h 25m across 2 projects for this window.");
    expect(localizedPublishNote(note, "en", translateFor("en"))).toBe(note);
    expect(localizedPublishNote(note, "ko", translateFor("ko"))).toBe("이 기간에 2개 프로젝트의 시간 1시간 25분을 공유했습니다.");
  });

  it("uses the singular for one project", () => {
    const note = sharedProjectTimeNote([{ project_id: "project-a", activity_date: "2026-10-01", seconds: 1800 }]);
    expect(note).toBe("Shared 30m across 1 project for this window.");
    expect(localizedPublishNote(note, "ko", translateFor("ko"))).toBe("이 기간에 1개 프로젝트의 시간 30분을 공유했습니다.");
  });
});
