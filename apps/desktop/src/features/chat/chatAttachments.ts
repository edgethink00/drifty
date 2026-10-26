/**
 * Documents attached to a Chat question. Their text is read on this computer
 * (plain text as is, PDF through pdf.js, Word .docx from its document.xml) and
 * sent inside the question, so every connection (Codex, Claude Code, Drifty
 * Cloud) sees the same thing and no file leaves the computer whole.
 */

export type ChatAttachmentKind = "text" | "pdf" | "docx";

export type ChatAttachment = {
  readonly name: string;
  readonly kind: ChatAttachmentKind;
  readonly text: string;
  /** True when only the beginning of the document fits. */
  readonly truncated: boolean;
};

/** What a turn keeps to show its attachments. */
export type ChatAttachmentMeta = {
  readonly name: string;
  readonly kind: ChatAttachmentKind;
  readonly truncated?: boolean;
};

export type ChatAttachmentError = "unsupported" | "tooLarge" | "empty" | "scanned" | "unreadable";

export class ChatAttachmentReadError extends Error {
  constructor(readonly reason: ChatAttachmentError) {
    super(reason);
  }
}

export const MAX_CHAT_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** One document's text; the whole question keeps at most CHAT_ATTACHMENTS_CHARS of documents. */
export const MAX_ATTACHMENT_CHARS = 30_000;
export const CHAT_ATTACHMENTS_CHARS = 40_000;

const TEXT_EXTENSIONS = [
  "txt", "md", "markdown", "csv", "tsv", "json", "log", "xml", "html", "htm", "yaml", "yml", "toml", "ini",
  "srt", "vtt", "rtf", "sql", "sh", "py", "js", "jsx", "ts", "tsx", "css", "swift", "kt", "java", "go", "rs", "rb", "c", "h", "cpp",
] as const;

/** For the file picker. */
export const CHAT_ATTACHMENT_ACCEPT = [".pdf", ".docx", ...TEXT_EXTENSIONS.map((extension) => "." + extension)].join(",");

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function chatAttachmentKind(file: Pick<File, "name" | "type">): ChatAttachmentKind | null {
  const extension = extensionOf(file.name);
  if (extension === "pdf" || file.type === "application/pdf") return "pdf";
  if (extension === "docx") return "docx";
  if ((TEXT_EXTENSIONS as readonly string[]).includes(extension) || file.type.startsWith("text/")) return "text";
  return null;
}

function clip(text: string, limit: number): { readonly text: string; readonly truncated: boolean } {
  const trimmed = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return trimmed.length <= limit ? { text: trimmed, truncated: false } : { text: trimmed.slice(0, limit), truncated: true };
}

/** File contents, through FileReader where a File lacks text()/arrayBuffer() (older webviews, jsdom). */
function readFile(file: File, as: "text"): Promise<string>;
function readFile(file: File, as: "bytes"): Promise<Uint8Array>;
function readFile(file: File, as: "text" | "bytes"): Promise<string | Uint8Array> {
  if (as === "text" && typeof file.text === "function") return file.text();
  if (as === "bytes" && typeof file.arrayBuffer === "function") return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(as === "text" ? String(reader.result ?? "") : new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
    if (as === "text") reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: await readFile(file, "bytes") });
  const document = await task.promise;
  try {
    let text = "";
    for (let pageNumber = 1; pageNumber <= document.numPages && text.length <= MAX_ATTACHMENT_CHARS; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
      }
      text += "\n\n";
    }
    return text;
  } finally {
    await task.destroy();
  }
}

const XML_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** The visible text of a Word document.xml: paragraphs, tabs and line breaks. */
export function wordDocumentText(xml: string): string {
  return decodeXml(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads one entry of a ZIP archive (as .docx files are) from its central directory. */
export async function zipEntry(archive: Uint8Array, wanted: string): Promise<Uint8Array | null> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let end = -1;
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) return null;
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entries && offset + 46 <= archive.length; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) return null;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(archive.subarray(offset + 46, offset + 46 + nameLength));
    if (name === wanted) {
      if (view.getUint32(localOffset, true) !== 0x04034b50) return null;
      const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      const data = archive.subarray(start, start + compressedSize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      return null;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

async function docxText(file: File): Promise<string> {
  const xml = await zipEntry(await readFile(file, "bytes"), "word/document.xml");
  if (!xml) throw new ChatAttachmentReadError("unreadable");
  return wordDocumentText(new TextDecoder().decode(xml));
}

/** Reads one file into an attachment, or throws ChatAttachmentReadError with the reason. */
export async function readChatAttachment(file: File): Promise<ChatAttachment> {
  const kind = chatAttachmentKind(file);
  if (!kind) throw new ChatAttachmentReadError("unsupported");
  if (file.size > MAX_ATTACHMENT_BYTES) throw new ChatAttachmentReadError("tooLarge");
  let raw: string;
  try {
    raw = kind === "pdf" ? await pdfText(file) : kind === "docx" ? await docxText(file) : await readFile(file, "text");
  } catch (error) {
    if (error instanceof ChatAttachmentReadError) throw error;
    throw new ChatAttachmentReadError("unreadable");
  }
  if (kind === "text" && raw.includes("\u0000")) throw new ChatAttachmentReadError("unsupported");
  const { text, truncated } = clip(raw, MAX_ATTACHMENT_CHARS);
  if (!text) throw new ChatAttachmentReadError(kind === "pdf" ? "scanned" : "empty");
  return { name: file.name, kind, text, truncated };
}

function escapeName(name: string): string {
  return name.replace(/[<>"&\n\r]/g, " ").slice(0, 200);
}

/**
 * The question as sent: the typed request, then each document in a <document>
 * tag. Documents share CHAT_ATTACHMENTS_CHARS; a later one is cut when the
 * earlier ones fill it.
 */
export function composeChatRequest(request: string, attachments: readonly ChatAttachment[]): { readonly prompt: string; readonly attachments: ChatAttachmentMeta[] } {
  if (attachments.length === 0) return { prompt: request, attachments: [] };
  let budget = CHAT_ATTACHMENTS_CHARS;
  const blocks: string[] = [];
  const metas: ChatAttachmentMeta[] = [];
  for (const attachment of attachments) {
    if (budget <= 0) break;
    const text = attachment.text.slice(0, budget);
    const truncated = attachment.truncated || text.length < attachment.text.length;
    budget -= text.length;
    blocks.push("<document name=\"" + escapeName(attachment.name) + "\"" + (truncated ? " truncated=\"true\"" : "") + ">\n" + text + "\n</document>");
    metas.push({ name: attachment.name, kind: attachment.kind, ...(truncated ? { truncated: true } : {}) });
  }
  return { prompt: request + "\n\nAttached documents:\n" + blocks.join("\n"), attachments: metas };
}

/** Build the saved request from structured fields, never by parsing document text. */
export function chatRequestWithoutDocumentText(turn: {
  readonly question: string;
  readonly prompt?: string;
  readonly requestWithoutDocuments?: string;
  readonly attachments?: readonly ChatAttachmentMeta[];
}): string | undefined {
  if (!turn.prompt) return undefined;
  if (!turn.attachments?.length) return turn.prompt;
  // Earlier saved chats have no separate request. Their visible question is a
  // safe fallback; a document's own XML/HTML cannot supply a delimiter or name.
  const request = typeof turn.requestWithoutDocuments === "string" ? turn.requestWithoutDocuments : turn.question;
  return request + "\n\nAttached documents:\n" + turn.attachments.map((attachment) =>
    "<document name=\"" + escapeName(attachment.name) + "\" removed=\"true\"></document>",
  ).join("\n");
}
