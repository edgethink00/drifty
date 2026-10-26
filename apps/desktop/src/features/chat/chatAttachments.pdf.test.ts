import { afterEach, describe, expect, it, vi } from "vitest";

const pdf = vi.hoisted(() => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: "" } }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => pdf);
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({ default: "legacy-pdf-worker.mjs" }));
// Selection guards; the standalone WKWebView probe tests the actual vendor code.
vi.mock("pdfjs-dist", () => { throw new Error("Modern PDF.js needs APIs missing in the target WKWebView"); });
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "modern-pdf-worker.mjs" }));

import { MAX_ATTACHMENT_CHARS, readChatAttachment } from "./chatAttachments";

type TextChunk = { items: ({ str: string; hasEOL: boolean } | { type: string })[] };

function pageWithStream(chunks: TextChunk[], fail = false) {
  const cancel = vi.fn();
  const stream = new ReadableStream<TextChunk>({
    start(controller) {
      if (fail) { controller.error(new Error("PDF decoding failed")); return; }
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel,
  });
  // WKWebView has getReader() but no ReadableStream async iterator. PDF.js
  // 6.4 getTextContent() uses for-await even in its legacy distribution.
  Object.defineProperty(stream, Symbol.asyncIterator, { value: undefined });
  const getTextContent = vi.fn(async () => {
    const items = [];
    // This is PDF.js's runtime assumption, deliberately false in this fixture.
    for await (const chunk of stream as unknown as AsyncIterable<TextChunk>) items.push(...chunk.items);
    return { items };
  });
  return { stream, cancel, page: { streamTextContent: () => stream, getTextContent } };
}

function documentWithPages(pages: ReturnType<typeof pageWithStream>[]) {
  const destroy = vi.fn().mockResolvedValue(undefined);
  const getPage = vi.fn(async (number: number) => pages[number - 1].page);
  pdf.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: pages.length, getPage }), destroy });
  return { destroy, getPage };
}

afterEach(() => {
  vi.clearAllMocks();
  pdf.GlobalWorkerOptions.workerSrc = "";
});

describe("PDF attachment text on WKWebView streams", () => {
  it("selects the legacy PDF module with its matching legacy worker", async () => {
    documentWithPages([pageWithStream([{ items: [{ str: "Compatible PDF text", hasEOL: false }] }])]);
    await expect(readChatAttachment(new File(["synthetic PDF bytes"], "legacy.pdf"))).resolves.toMatchObject({ text: "Compatible PDF text" });
    expect(pdf.getDocument).toHaveBeenCalledOnce();
    expect(pdf.GlobalWorkerOptions.workerSrc).toBe("legacy-pdf-worker.mjs");
  });

  it.each([" ", "\n"])("normalizes a whole finite page with a long %j prefix before clipping", async (prefix) => {
    const page = pageWithStream([
      { items: [{ str: prefix.repeat(MAX_ATTACHMENT_CHARS + 1), hasEOL: false }] },
      { items: [{ str: "Visible text", hasEOL: false }] },
    ]);
    documentWithPages([page]);
    await expect(readChatAttachment(new File(["synthetic PDF bytes"], "prefix.pdf"))).resolves.toMatchObject({ text: "Visible text", truncated: false });
  });

  it("reads every text chunk and page without ReadableStream async iteration", async () => {
    const first = pageWithStream([{ items: [{ str: "First", hasEOL: true }] }, { items: [{ type: "beginMarkedContent" }, { str: "Second", hasEOL: false }] }]);
    const second = pageWithStream([{ items: [{ str: "Next page", hasEOL: false }] }]);
    const task = documentWithPages([first, second]);
    await expect(readChatAttachment(new File(["synthetic PDF bytes"], "notes.pdf"))).resolves.toEqual({ name: "notes.pdf", kind: "pdf", text: "First\nSecond\n\nNext page", truncated: false });
    expect(task.destroy).toHaveBeenCalledOnce();
    expect(first.stream.locked).toBe(false);
    expect(second.stream.locked).toBe(false);
  });

  it("reads a whole long page before clipping and does not request later pages", async () => {
    const first = pageWithStream([
      { items: [{ str: "x".repeat(MAX_ATTACHMENT_CHARS + 1), hasEOL: false }] },
      { items: [{ str: "End of the same page", hasEOL: false }] },
    ]);
    const task = documentWithPages([first, pageWithStream([])]);
    await expect(readChatAttachment(new File(["synthetic PDF bytes"], "long.pdf"))).resolves.toMatchObject({ text: "x".repeat(MAX_ATTACHMENT_CHARS), truncated: true });
    expect(first.cancel).not.toHaveBeenCalled();
    expect(first.stream.locked).toBe(false);
    expect(task.getPage).toHaveBeenCalledTimes(1);
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it("keeps image-only PDFs classified as scanned", async () => {
    const empty = pageWithStream([]);
    const task = documentWithPages([empty]);
    await expect(readChatAttachment(new File(["synthetic PDF bytes"], "scan.pdf"))).rejects.toMatchObject({ reason: "scanned" });
    expect(empty.stream.locked).toBe(false);
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it("still refuses decoding errors and releases the reader and document", async () => {
    const broken = pageWithStream([], true);
    const task = documentWithPages([broken]);
    await expect(readChatAttachment(new File(["synthetic PDF bytes"], "broken.pdf"))).rejects.toMatchObject({ reason: "unreadable" });
    expect(broken.stream.locked).toBe(false);
    expect(task.destroy).toHaveBeenCalledOnce();
  });
});
