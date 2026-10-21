import type { ReactNode } from "react";
import "./SettingsRowDescription.css";

type SettingsRowDescriptionProps = {
  readonly description: ReactNode;
  /** The outcome of this row's last action, shown in the description's place. */
  readonly notice?: ReactNode;
  readonly noticeRole?: "alert" | "status";
  readonly noticeTitle?: string;
  readonly id?: string;
};

/**
 * A settings row description with room for the outcome of the row's action.
 * The notice takes the description's place in the same grid cell while the
 * description stays laid out invisibly, so the row keeps the taller of the two
 * heights: the controls beside it and the rows below do not move (2026-10-21).
 */
export function SettingsRowDescription({ description, notice = null, noticeRole = "alert", noticeTitle, id }: SettingsRowDescriptionProps) {
  const showsNotice = notice !== null && notice !== false && notice !== "";
  return (
    <div className="desc settings-row-description" id={id}>
      <span data-hidden={showsNotice ? "" : undefined} aria-hidden={showsNotice ? true : undefined}>{description}</span>
      {showsNotice ? (
        <span className="settings-row-description__notice" role={noticeRole} title={noticeTitle}>{notice}</span>
      ) : null}
    </div>
  );
}

