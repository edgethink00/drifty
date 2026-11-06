import { Fragment } from "react";

/**
 * Renders a block title whose trailing period or count ("Project allocation
 * · latest 7 days") reads as secondary: everything after the first " · " is
 * set at weight 400 on the same line. Titles without the separator render
 * unchanged.
 */
export function BlockTitleText({ text }: { text: string }) {
  const index = text.indexOf(" · ");
  if (index < 0) return <Fragment>{text}</Fragment>;
  return (
    <Fragment>
      {text.slice(0, index)}
      <span className="block-title__meta">{text.slice(index)}</span>
    </Fragment>
  );
}
