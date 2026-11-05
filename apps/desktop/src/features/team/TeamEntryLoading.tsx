import { useLocalization } from "../localization/LocalizationContext";
import "./team-entry-loading.css";

/** Shared by the lazy Team page and the first team list read. */
export function TeamEntryLoading() {
  const { t } = useLocalization();
  return (
    <>
      <header className="pg-head team-entry-loading__heading">
        <h1>{t("team.page.teams")}</h1>
      </header>
      <div className="page-toolbar team-entry-loading__toolbar">
        <p role="status">{t("team.state.loadingTeams")}</p>
      </div>
      <div className="team-entry-loading__body" aria-hidden="true">
        <div className="team-entry-loading__summary">
          <span className="team-entry-loading__bar team-entry-loading__bar--summary" />
          <span className="team-entry-loading__bar team-entry-loading__bar--label" />
        </div>
        <div className="team-entry-loading__cards">
          {[0, 1].map((index) => (
            <div className="editorial-panel editorial-panel--soft team-entry-loading__card" key={index}>
              <span className="team-entry-loading__bar team-entry-loading__bar--label" />
              <div className="team-entry-loading__plot" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
