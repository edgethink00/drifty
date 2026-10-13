/**
 * Copy plain text. Uses the async Clipboard API where the page allows it and
 * falls back to a selected textarea for contexts that block it, such as a
 * plain-HTTP review preview.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) throw new Error("Unable to copy text");
  } finally {
    document.body.removeChild(textarea);
  }
}
