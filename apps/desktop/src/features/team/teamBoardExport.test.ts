import { describe, expect, it } from "vitest";

import { teamBoardCsvCell, teamBoardCsvFileName, teamBoardCsvHours } from "./teamBoardExport";

describe("team export CSV pieces", () => {
  it("writes hours as decimals a spreadsheet can add", () => {
    expect(teamBoardCsvHours(25 * 3600 + 51 * 60)).toBe(25.85);
    expect(teamBoardCsvHours(0)).toBe(0);
  });

  it("keeps names that look like formulas as text and quotes what needs quoting", () => {
    expect(teamBoardCsvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(teamBoardCsvCell("+1 Sales")).toBe("'+1 Sales");
    expect(teamBoardCsvCell("Sales, East")).toBe('"Sales, East"');
    expect(teamBoardCsvCell("Q4 Campaign")).toBe("Q4 Campaign");
    expect(teamBoardCsvCell(null)).toBe("");
    expect(teamBoardCsvCell(-2)).toBe("-2");
  });

  it("names the file without characters a desktop refuses", () => {
    expect(teamBoardCsvFileName(["Sales / East", "팀 현황", "2026-10-15–2026-10-21"])).toBe("Sales - East 팀 현황 2026-10-15–2026-10-21.csv");
    expect(teamBoardCsvFileName(["", " "])).toBe("drifty-team.csv");
  });
});
