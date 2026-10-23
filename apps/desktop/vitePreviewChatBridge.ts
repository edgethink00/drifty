import { execFile, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";

import { buildChatCliArgs } from "./src/features/chat/chatCliArgs";
import { PREVIEW_CHAT_BRIDGE_PATH } from "./src/features/chat/previewChatContract";
import { buildPreviewChatLedger } from "./src/features/chat/previewChatLedger";
import type { ChatProvider, ChatToolDetail } from "./src/features/chat/chatTypes";

/**
 * Browser-preview stand-in for the native chat_cli commands. It runs the same
 * agent CLI with the same arguments (chatCliArgsContract.json), but the tool
 * server reads a synthetic database seeded from previewChatLedger, never this
 * computer's real records. Dev server only (VITE_DRIFTY_PREVIEW=1).
 */

const MAX_REQUEST_BYTES = 400_000;
const MAX_PROMPT_CHARS = 200_000;
const MAX_INSTRUCTIONS_CHARS = 20_000;
const LOOKUP_TIMEOUT_MS = 8_000;
const STDERR_TAIL_CHARS = 4_000;

type Executable = { readonly path: string; readonly pathEnv: string | null };

type SendRequest = {
  readonly requestId: string;
  readonly provider: ChatProvider;
  readonly detail: ChatToolDetail;
  readonly instructions: string;
  readonly prompt: string;
};

function run(file: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((done) => {
    execFile(file, [...args], { timeout: LOOKUP_TIMEOUT_MS, env, maxBuffer: 1_000_000 }, (error, stdout) => {
      done(error && !stdout ? null : String(stdout));
    });
  });
}

const executableCache = new Map<string, { readonly at: number; readonly value: Executable | null }>();

async function resolveExecutable(name: string): Promise<Executable | null> {
  const cached = executableCache.get(name);
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const shell = process.env.SHELL && process.env.SHELL.startsWith("/") ? process.env.SHELL : "/bin/zsh";
  const script = "printf '\\n__DRIFTY_CMD__%s\\n' \"$(command -v " + name + " 2>/dev/null)\"; printf '__DRIFTY_PATH__%s\\n' \"$PATH\"";
  let value: Executable | null = null;
  for (const flags of [["-l", "-i"], ["-l"]]) {
    const output = await run(shell, [...flags, "-c", script], process.env);
    if (!output) continue;
    const lines = output.split("\n");
    const path = lines.find((line) => line.startsWith("__DRIFTY_CMD__"))?.slice("__DRIFTY_CMD__".length).trim() ?? "";
    const pathEnv = lines.find((line) => line.startsWith("__DRIFTY_PATH__"))?.slice("__DRIFTY_PATH__".length).trim() || null;
    if (path.startsWith("/")) {
      value = { path, pathEnv };
      break;
    }
  }
  executableCache.set(name, { at: Date.now(), value });
  return value;
}

function envFor(executable: Executable): NodeJS.ProcessEnv {
  return executable.pathEnv ? { ...process.env, PATH: executable.pathEnv } : process.env;
}

async function versionOf(executable: Executable): Promise<string | null> {
  const output = await run(executable.path, ["--version"], envFor(executable));
  return output?.split("\n").map((line) => line.trim()).find(Boolean) ?? null;
}

let preparedDatabase: Promise<string> | null = null;

function prepareDatabase(repoRoot: string, python: Executable): Promise<string> {
  preparedDatabase ??= new Promise<string>((done, fail) => {
    const directory = join(tmpdir(), "drifty-chat-preview-" + process.pid);
    mkdirSync(directory, { recursive: true });
    const ledgerPath = join(directory, "ledger.json");
    const database = join(directory, "tracker.sqlite3");
    writeFileSync(ledgerPath, JSON.stringify(buildPreviewChatLedger(new Date())));
    const seed = join(repoRoot, "tests", "agent-integrations", "drifty", "seed_database.py");
    execFile(python.path, [seed, "--ledger", ledgerPath, "--output", database], { env: envFor(python), timeout: 60_000 }, (error) => {
      if (error) {
        preparedDatabase = null;
        fail(new Error("The preview records could not be prepared: " + error.message));
      } else {
        done(database);
      }
    });
  });
  return preparedDatabase;
}

function isSameOriginRequest(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        fail(new Error("The Chat request is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    request.on("error", fail);
  });
}

export function parsePreviewChatSendRequest(raw: string): SendRequest {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Invalid Chat request.");
  const body = value as Record<string, unknown>;
  const { requestId, provider, detail, instructions, prompt } = body;
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(requestId)) throw new Error("Chat request id is invalid.");
  if (provider !== "codex" && provider !== "claude") throw new Error("Unknown Chat connection.");
  if (detail !== "safe" && detail !== "titles") throw new Error("Unknown record detail.");
  if (typeof instructions !== "string" || instructions.length > MAX_INSTRUCTIONS_CHARS) throw new Error("Chat instructions are invalid.");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) throw new Error("Chat message is invalid.");
  return { requestId, provider, detail, instructions, prompt };
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function handleStatus(response: ServerResponse): Promise<void> {
  const providers = await Promise.all((["codex", "claude"] as const).map(async (provider) => {
    const executable = await resolveExecutable(provider);
    return { provider, installed: executable !== null, version: executable ? await versionOf(executable) : null };
  }));
  const python = await resolveExecutable("python3");
  writeJson(response, 200, { providers, toolsAvailable: python !== null, toolsMessage: python ? null : "python3 was not found." });
}

async function handleSend(repoRoot: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!isSameOriginRequest(request)) {
    writeJson(response, 403, { error: "Cross-origin Chat requests are not allowed." });
    return;
  }
  const send = parsePreviewChatSendRequest(await readBody(request));
  const [agent, python] = await Promise.all([resolveExecutable(send.provider), resolveExecutable("python3")]);
  if (!agent) {
    writeJson(response, 409, { error: send.provider + " is not installed on the preview host." });
    return;
  }
  if (!python) {
    writeJson(response, 409, { error: "python3 is required for the preview records." });
    return;
  }
  const database = await prepareDatabase(repoRoot, python);
  const workingDirectory = join(tmpdir(), "drifty-chat-preview");
  mkdirSync(workingDirectory, { recursive: true });
  const args = buildChatCliArgs(
    send.provider,
    {
      program: python.path,
      leadingArgs: [join(repoRoot, "services", "tracker-python", "app", "main.py")],
      database,
      detail: send.detail,
    },
    workingDirectory,
    send.instructions,
    send.prompt,
  );
  const child = spawn(agent.path, args, { cwd: workingDirectory, env: envFor(agent), stdio: ["ignore", "pipe", "pipe"] });
  let cancelled = false;
  let stderrTail = "";
  let buffered = "";
  response.statusCode = 200;
  response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  const emit = (payload: unknown) => {
    if (!response.writableEnded) response.write(JSON.stringify(payload) + "\n");
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf("\n");
      if (line) emit({ kind: "line", line });
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
  });
  response.on("close", () => {
    if (child.exitCode === null && child.signalCode === null) {
      cancelled = true;
      child.kill("SIGTERM");
    }
  });
  child.on("error", (error) => {
    stderrTail = (stderrTail + "\n" + error.message).slice(-STDERR_TAIL_CHARS);
  });
  child.on("close", (code) => {
    if (buffered.trim()) emit({ kind: "line", line: buffered.trim() });
    emit({ kind: "exit", code, cancelled, stderrTail });
    response.end();
  });
}

export function previewChatBridgePlugin(enabled: boolean): Plugin {
  return {
    name: "drifty-preview-chat-bridge",
    configureServer(server) {
      if (!enabled) return;
      const repoRoot = resolve(server.config.root, "..", "..");
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split("?", 1)[0] ?? "";
        if (!path.startsWith(PREVIEW_CHAT_BRIDGE_PATH + "/")) {
          next();
          return;
        }
        const action = path.slice(PREVIEW_CHAT_BRIDGE_PATH.length + 1);
        const handled = action === "status" && request.method === "GET"
          ? handleStatus(response)
          : action === "send" && request.method === "POST"
            ? handleSend(repoRoot, request, response)
            : Promise.resolve(writeJson(response, 404, { error: "Unknown preview Chat route." }));
        void handled.catch((error: unknown) => {
          if (!response.headersSent) writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
          else response.end();
        });
      });
    },
  };
}

