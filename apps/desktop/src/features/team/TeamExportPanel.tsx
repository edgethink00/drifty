import { useState } from "react";
import { shiftIsoDate } from "@drifty/domain";

import { useLocalization } from "../localization/LocalizationContext";
import { downloadTeamBoardCsv, teamBoardCsvFileName } from "./teamBoardExport";
import { TeamExportDateField } from "./TeamExportDateField";
import { TEAM_EXPORT_MAX_DAYS, teamExportDayCount, teamExportPresetWindow, type TeamExportWindow } from "./teamExportRange";
import { teamExportCsv, type TeamExportRow } from "./teamExportRows";

export type TeamExportPanelProps = {
  readonly scopeName: string;
  readonly today: string;
  readonly earliest: string;
  /** The range's rows as this seat may see them; null when they could not be read. */
  readonly readRows: (range: TeamExportWindow) => Promise<readonly TeamExportRow[] | null>;
};

const DOWNLOAD = <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2.5v7.5M4.75 7 8 10.25 11.25 7M3 13.25h10" /></svg>;
const ARROW = <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>;

/**
 * Settings › Export (owner decision 2026-10-22): one card in Dayflow's order.
 * A title and its line, a start and an end day shown short with their weekday,
 * a line on the file, then the button on the left with its result beside it.
 * The file is one table, a row per day, person and project, as Rize's and
 * RescueTime's are, holding what this seat may see. The board menu keeps its
 * own export.
 */
export function TeamExportPanel({ scopeName, today, earliest, readRows }: TeamExportPanelProps): JSX.Element {
  const { t } = useLocalization();
  const [range, setRange] = useState<TeamExportWindow>(() => teamExportPresetWindow("thisWeek", today));
  const [status, setStatus] = useState<{ readonly tone: "busy" } | { readonly tone: "error" } | { readonly tone: "done"; readonly rows: number } | null>(null);
  // A range is a year at most: moving one end past that brings the other along.
  const setStart = (day: string) => {
    const end = day > range.end_date ? day : teamExportDayCount({ start_date: day, end_date: range.end_date }) > TEAM_EXPORT_MAX_DAYS ? shiftIsoDate(day, TEAM_EXPORT_MAX_DAYS - 1) : range.end_date;
    setRange({ start_date: day, end_date: end > today ? today : end });
    setStatus(null);
  };
  const setEnd = (day: string) => {
    const start = day < range.start_date ? day : teamExportDayCount({ start_date: range.start_date, end_date: day }) > TEAM_EXPORT_MAX_DAYS ? shiftIsoDate(day, -(TEAM_EXPORT_MAX_DAYS - 1)) : range.start_date;
    setRange({ start_date: start < earliest ? earliest : start, end_date: day });
    setStatus(null);
  };
  const dates = range.start_date === range.end_date ? range.start_date : range.start_date + "–" + range.end_date;
  const fileName = teamBoardCsvFileName([scopeName, dates]);
  const download = async () => {
    setStatus({ tone: "busy" });
    const rows = await readRows(range);
    if (!rows) {
      setStatus({ tone: "error" });
      return;
    }
    downloadTeamBoardCsv(fileName, teamExportCsv(rows, {
      date: t("team.export.col.date"),
      team: t("team.export.col.team"),
      person: t("team.export.col.person"),
      project: t("team.export.col.project"),
      hours: t("team.export.col.hours"),
    }));
    setStatus({ tone: "done", rows: rows.length });
  };

  const busy = status?.tone === "busy";
  return (
    <section className="team-set-section team-export" aria-labelledby="team-export-title">
      <div className="team-export__body">
        <div className="team-export__head">
          <h3 id="team-export-title" className="team-export__title">{t("team.export.title")}</h3>
          <p className="team-export__lede">{t("team.export.lede")}</p>
        </div>
        <div className="team-export__dates">
          <TeamExportDateField label={t("team.export.start")} value={range.start_date} range={range} minDay={earliest} maxDay={today} onChange={setStart} />
          <span className="team-export__arrow" aria-hidden="true">{ARROW}</span>
          <TeamExportDateField label={t("team.export.end")} value={range.end_date} range={range} minDay={earliest} maxDay={today} onChange={setEnd} />
        </div>
        <div className="team-export__closing">
          <p className="team-export__hint">{t("team.export.hint")}</p>
          <div className="team-export__actions">
            <button type="button" className="modal-btn modal-btn--primary team-export__button" disabled={busy} aria-busy={busy || undefined} onClick={() => void download()}>
              {DOWNLOAD}
              {busy ? t("team.export.exporting") : t("team.board.export")}
            </button>
            {status?.tone === "done" ? (
              <span className="team-export__status" role="status">{t("team.export.doneRows", { rows: status.rows, days: teamExportDayCount(range) })}</span>
            ) : status?.tone === "error" ? (
              <span className="team-export__status is-error" role="alert">{t("team.export.failed")}</span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

