import { Fragment, type ReactNode } from "react";

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;
// Clock times and their ranges ("17:17~18:12"), dotted names ("kgirls.net")
// and an opening quote or bracket with the letter after it never split across
// lines. In Korean text WebKit otherwise breaks after "17:" or "kgirls." and
// can leave a lone "“" or "(" at the end of a line.
const KEEP_TOGETHER = /(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[~–-]\s?\d{1,2}:\d{2}(?::\d{2})?)?|[\p{L}\p{N}]+(?:[.:][\p{L}\p{N}]+)+|[“‘「『([]\S)/gu;
const HEADING = /^ {0,3}(#{1,6})\s+(\S.*)$/;
const LIST_ITEM = /^ {0,3}(?:([-*+•])|(\d{1,9})[.)])\s+(\S.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const TABLE_DIVIDER = /^:?-{3,}:?$/;

function unbroken(text: string): ReactNode {
  const parts = text.split(KEEP_TOGETHER);
  if (parts.length === 1) return text;
  // split() puts each kept-together match at an odd index.
  return parts.map((part, index) => (
    index % 2 === 1 ? <span key={index} className="chat-nowrap">{part}</span> : part ? <Fragment key={index}>{part}</Fragment> : null
  ));
}

function inline(text: string) {
  return text.split(INLINE).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{unbroken(part.slice(2, -2))}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) return <code key={index}>{part.slice(1, -1)}</code>;
    return <Fragment key={index}>{unbroken(part)}</Fragment>;
  });
}

function cells(line: string): string[] {
  const parts = line.trim().split(/(?<!\\)\|/);
  if (parts.length > 1 && !parts[0]) parts.shift();
  if (parts.length > 1 && !parts[parts.length - 1]) parts.pop();
  return parts.map((part) => part.trim().replace(/\\\|/g, "|"));
}

/** Chat answers are untrusted text. Render the supported blocks as React
 * elements so raw HTML, images and link destinations never become active. */
export function ChatAnswerText({ text }: { readonly text: string }) {
  const lines = text.trim().split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let firstHeadingDepth: number | undefined;

  const flushParagraph = (beforeList = false) => {
    if (paragraph.length === 0) return;
    // Standup answers also use short, unmarked labels before their lists.
    const label = beforeList && paragraph.length === 1 && paragraph[0].trim().length <= 36
      && !/[.!?。！？]$/.test(paragraph[0].trim());
    blocks.push(<p key={blocks.length} className={label ? "chat-answer__heading" : undefined}>
      {paragraph.map((line, index) => <Fragment key={index}>{index > 0 ? <br /> : null}{inline(line)}</Fragment>)}
    </p>);
    paragraph = [];
  };

  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { flushParagraph(); i++; continue; }
    const fence = FENCE.exec(line);
    const heading = HEADING.exec(line);
    const item = LIST_ITEM.exec(line);
    const headers = line.includes("|") && i + 1 < lines.length ? cells(line) : [];
    const divider = headers.length > 0 ? cells(lines[i + 1]) : [];
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = FENCE.exec(lines[i++]);
        if (close && close[1][0] === fence[1][0] && close[1].length >= fence[1].length && !close[2].trim()) break;
        body.push(lines[i - 1]);
      }
      blocks.push(<pre key={blocks.length}><code>{body.join("\n")}</code></pre>);
    } else if (heading) {
      flushParagraph();
      firstHeadingDepth ??= heading[1].length;
      const level = Math.min(6, Math.max(2, heading[1].length - firstHeadingDepth + 2));
      const Tag = (["h2", "h3", "h4", "h5", "h6"] as const)[level - 2];
      blocks.push(<Tag key={blocks.length}>{inline(heading[2].replace(/\s+#+\s*$/, ""))}</Tag>);
      i++;
    } else if (headers.length > 0 && divider.length === headers.length && divider.every((cell) => TABLE_DIVIDER.test(cell))) {
      flushParagraph();
      const tableStart = i;
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && !HEADING.test(lines[i]) && !LIST_ITEM.test(lines[i]) && !FENCE.test(lines[i])) {
        rows.push(cells(lines[i++]));
      }
      // An unescaped pipe in a name can shift the rest of a row into the
      // wrong columns. Keep every value visible if we cannot map it safely.
      if (rows.some((row) => row.length !== headers.length)) {
        paragraph = lines.slice(tableStart, i);
        flushParagraph();
        continue;
      }
      const align = divider.map((cell) => cell.endsWith(":") ? (cell.startsWith(":") ? "center" : "right") : "left");
      blocks.push(<div className="chat-answer__table" key={blocks.length}>
        <table>
          <thead><tr>{headers.map((cell, index) => <th key={index} scope="col" style={{ textAlign: align[index] }}>{inline(cell)}</th>)}</tr></thead>
          <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, index) =>
            <td key={index} style={{ textAlign: align[index] }}>{inline(row[index] ?? "")}</td>,
          )}</tr>)}</tbody>
        </table>
      </div>);
    } else if (item) {
      flushParagraph(true);
      const ordered = item[2] !== undefined;
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const next = LIST_ITEM.exec(lines[i]);
        if (!next || (next[2] !== undefined) !== ordered) break;
        items.push(<li key={i}>{inline(next[3])}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={blocks.length} start={Number(item[2])}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    } else {
      paragraph.push(line);
      i++;
    }
  }
  flushParagraph();
  return <div className="chat-answer__text">{blocks}</div>;
}
