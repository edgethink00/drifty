import { describe, expect, it } from "vitest";

import {
  CHAT_ATTACHMENTS_CHARS,
  chatAttachmentKind,
  ChatAttachmentReadError,
  composeChatRequest,
  readChatAttachment,
  chatRequestWithoutDocumentText,
  wordDocumentText,
  zipEntry,
} from "./chatAttachments";

/** A ZIP with stored (uncompressed) entries, as a .docx is laid out. */
function storedZip(entries: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: number[] = [];
  const central: number[] = [];
  const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
  const u32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = [...encoder.encode(name)];
    const data = [...encoder.encode(content)];
    const offset = locals.length;
    locals.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes, ...data);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes);
  }
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(Object.keys(entries).length), ...u16(Object.keys(entries).length), ...u32(central.length), ...u32(locals.length), ...u16(0)];
  return new Uint8Array([...locals, ...central, ...end]);
}

describe("Chat attachments", () => {
  it("knows text, PDF and Word files and refuses the rest", () => {
    expect(chatAttachmentKind({ name: "notes.md", type: "" })).toBe("text");
    expect(chatAttachmentKind({ name: "회의록.PDF", type: "" })).toBe("pdf");
    expect(chatAttachmentKind({ name: "plan.docx", type: "" })).toBe("docx");
    expect(chatAttachmentKind({ name: "export", type: "text/csv" })).toBe("text");
    expect(chatAttachmentKind({ name: "photo.png", type: "image/png" })).toBeNull();
  });

  it("reads a text file and refuses binary or empty ones", async () => {
    const note = await readChatAttachment(new File(["오늘 회의\r\n\r\n\r\n\r\n- Polaris 리뷰"], "note.txt", { type: "text/plain" }));
    expect(note).toEqual({ name: "note.txt", kind: "text", text: "오늘 회의\n\n- Polaris 리뷰", truncated: false });
    await expect(readChatAttachment(new File(["a\u0000b"], "data.log"))).rejects.toMatchObject({ reason: "unsupported" });
    await expect(readChatAttachment(new File(["   "], "blank.txt"))).rejects.toMatchObject({ reason: "empty" });
    await expect(readChatAttachment(new File(["x"], "photo.png", { type: "image/png" }))).rejects.toBeInstanceOf(ChatAttachmentReadError);
  });

  it("reads the paragraphs of a Word document", async () => {
    const xml = "<w:document><w:body><w:p><w:r><w:t>주간 회고</w:t></w:r></w:p><w:p><w:r><w:t>A&amp;B</w:t><w:tab/><w:t>2시간</w:t></w:r></w:p></w:body></w:document>";
    expect(wordDocumentText(xml)).toBe("주간 회고\nA&B\t2시간\n");
    const archive = storedZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": xml });
    expect(new TextDecoder().decode((await zipEntry(archive, "word/document.xml"))!)).toBe(xml);
    expect(await zipEntry(archive, "word/missing.xml")).toBeNull();
    const file = new File([new Uint8Array(archive)], "회고.docx");
    expect(await readChatAttachment(file)).toMatchObject({ kind: "docx", text: "주간 회고\nA&B\t2시간" });
  });

  it("puts documents after the question within one shared budget", () => {
    const long = "가".repeat(CHAT_ATTACHMENTS_CHARS - 10);
    const { prompt, attachments } = composeChatRequest("이 문서 요약해 줘", [
      { name: "a.txt", kind: "text", text: long, truncated: false },
      { name: "b \"c\".md", kind: "text", text: "0123456789ABCDEF", truncated: false },
      { name: "d.txt", kind: "text", text: "never sent", truncated: false },
    ]);
    expect(prompt.startsWith("이 문서 요약해 줘\n\nAttached documents:\n<document name=\"a.txt\">")).toBe(true);
    expect(prompt).toContain("<document name=\"b  c .md\" truncated=\"true\">\n0123456789\n</document>");
    expect(prompt).not.toContain("never sent");
    expect(attachments).toEqual([{ name: "a.txt", kind: "text" }, { name: "b \"c\".md", kind: "text", truncated: true }]);
    expect(chatRequestWithoutDocumentText({ question: "이 문서 요약해 줘", prompt, attachments })).toBe("이 문서 요약해 줘\n\nAttached documents:\n<document name=\"a.txt\" removed=\"true\"></document>\n<document name=\"b  c .md\" removed=\"true\"></document>");
    expect(composeChatRequest("hi", [])).toEqual({ prompt: "hi", attachments: [] });
  });
});
