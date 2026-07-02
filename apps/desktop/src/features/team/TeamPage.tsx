import { TeamView } from "./TeamView";
import type { TeamViewProps } from "./TeamView";

export type TeamPageProps = TeamViewProps;

export function TeamPage(props: TeamPageProps) {
  return (
    <div className="page content--team">
      <div className="pg-head">
        <div>
          <h1>Teams beta</h1>
        </div>
      </div>
      <div className="team-page-layout">
        <TeamView {...props} />
      </div>
    </div>
  );
}
