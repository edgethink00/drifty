import { TeamView } from "./TeamView";
import type { TeamViewProps } from "./TeamView";

export type TeamPageProps = TeamViewProps;

export function TeamPage(props: TeamPageProps) {
  return (
    <div className="page content--team">
      <div className="pg-head team-page-head">
        <div>
          <h1>Teams beta</h1>
        </div>
        <button
          type="button"
          className="settings-btn team-page-refresh"
          onClick={() => props.onRefresh?.()}
          disabled={!props.onRefresh || props.isActionLoading}
        >
          Refresh
        </button>
      </div>
      <div className="team-page-layout">
        <TeamView {...props} />
      </div>
    </div>
  );
}
