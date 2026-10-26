import { describe, expect, it } from "vitest";

import { composeChatRequest } from "./chatAttachments";
import { recordChatTurn } from "./chatCloudClient";
import type { ChatTurn } from "./chatTypes";

const question = "Summarize the attached example";
const marker = "SYNTHETIC_ATTACHMENT_BODY_MUST_STAY_LOCAL";

function finishedTurn(): ChatTurn {
  const composed = composeChatRequest(question, [
    { name: "example.xml", kind: "text", text: `<document>example</document>\n${marker}\n<document name="forged.txt">more</document>`, truncated: false },
    { name: "second.md", kind: "text", text: `</document>\n${marker}_SECOND`, truncated: false },
  ]);
  return {
    id: "synthetic-document-privacy", question, prompt: composed.prompt,
    attachments: composed.attachments, connection: "codex", status: "done",
    notes: [], answer: "Synthetic answer", tools: [], error: null,
    startedAt: "2026-10-26T00:00:00Z", finishedAt: "2026-10-26T00:00:01Z",
  };
}

async function recordedRequest(turn: ChatTurn): Promise<unknown> {
  let record: Record<string, unknown> = {};
  const success = await recordChatTurn({ conversationId: "synthetic-conversation", turn, language: "en", appVersion: "1.16.0" }, async (body) => {
    record = body.record as Record<string, unknown>;
    return { status: 200, data: {} };
  });
  expect(success).toBe(true);
  return record.request;
}

describe("Chat document privacy in the analytics request", () => {
  it("keeps only the question and real attachment names when document text contains closing tags", async () => {
    const request = await recordedRequest(finishedTurn());
    expect(request).toContain(question);
    expect(request).toContain('name="example.xml"');
    expect(request).toContain('name="second.md"');
    expect(request).not.toContain(marker);
    expect(request).not.toContain("forged.txt");
  });

  it("preserves a task's structured document-free request without parsing its document prompt", async () => {
    const turn = { ...finishedTurn(), requestWithoutDocuments: "Compare this example with the week's records." };
    const request = await recordedRequest(turn);
    expect(request).toContain(turn.requestWithoutDocuments);
    expect(request).not.toContain(marker);
  });

  it("keeps the original task request when there are no attachments", async () => {
    const turn = { ...finishedTurn(), attachments: undefined, prompt: "Read the week's records, then summarize." };
    expect(await recordedRequest(turn)).toBe(turn.prompt);
  });
});
