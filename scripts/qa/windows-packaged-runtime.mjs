import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_DEBUG_PORT = 9337;
const MANAGED_AI_PORT = 39217;
const DEFAULT_MODEL_ID = "drifty-qwen3-5-2b-economy";
const QA_CREDENTIAL_PREFIX = "drifty-packaged-qa-";
const WINDOWS_OPENROUTER_TARGET = "desktop.so.drifty.openrouter-api-key";

export function resolveWindowsToolPaths(windowsDirectory) {
  if (typeof windowsDirectory !== "string"
    || windowsDirectory.trim() === ""
    || windowsDirectory.includes(String.fromCharCode(0))
    || !path.win32.isAbsolute(windowsDirectory)) {
    throw new Error("SystemRoot/WINDIR must be an absolute Windows directory.");
  }
  const system32 = path.win32.join(windowsDirectory, "System32");
  return {
    powershell: path.win32.join(system32, "WindowsPowerShell", "v1.0", "powershell.exe"),
    cmdkey: path.win32.join(system32, "cmdkey.exe"),
    taskkill: path.win32.join(system32, "taskkill.exe"),
  };
}

function getWindowsToolPaths() {
  return resolveWindowsToolPaths(process.env.SystemRoot ?? process.env.WINDIR);
}

export function parseCli(argv) {
  const options = {
    debugPort: DEFAULT_DEBUG_PORT,
    modelId: DEFAULT_MODEL_ID,
    installTimeoutMinutes: 60,
    inferenceTimeoutSeconds: 240,
    deleteManagedAiModel: false,
  };
  const valueFlags = new Map([
    ["--installer", "installerPath"],
    ["--expected-sha256", "expectedInstallerSha256"],
    ["--expected-authenticode-status", "expectedAuthenticodeStatus"],
    ["--expected-build-commit", "expectedBuildCommit"],
    ["--expected-app-version", "expectedAppVersion"],
    ["--expected-harness-sha256", "expectedHarnessSha256"],
    ["--expected-signer-thumbprint", "expectedSignerThumbprint"],
    ["--expected-publisher-subject", "expectedPublisherSubject"],
    ["--evidence", "evidencePath"],
    ["--debug-port", "debugPort"],
    ["--model-id", "modelId"],
    ["--install-timeout-minutes", "installTimeoutMinutes"],
    ["--inference-timeout-seconds", "inferenceTimeoutSeconds"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--delete-managed-ai-model") {
      options.deleteManagedAiModel = true;
      continue;
    }
    const key = valueFlags.get(flag);
    if (!key) throw new Error(`Unknown argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    options[key] = value;
    index += 1;
  }

  for (const key of ["installerPath", "expectedInstallerSha256", "expectedAuthenticodeStatus", "expectedBuildCommit", "expectedAppVersion", "expectedHarnessSha256", "evidencePath"]) {
    if (!options[key]) throw new Error(`Missing required argument: ${key}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(options.expectedInstallerSha256)) {
    throw new Error("--expected-sha256 must be a 64-character hexadecimal SHA-256.");
  }
  if (!/^[a-f0-9]{64}$/i.test(options.expectedHarnessSha256)) {
    throw new Error("--expected-harness-sha256 must be a 64-character hexadecimal SHA-256.");
  }
  if (!new Set(["NotSigned", "Valid"]).has(options.expectedAuthenticodeStatus)) {
    throw new Error("--expected-authenticode-status must be NotSigned or Valid.");
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(options.expectedBuildCommit)) {
    throw new Error("--expected-build-commit must be a full 40- or 64-character hexadecimal commit.");
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(options.expectedAppVersion)) {
    throw new Error("--expected-app-version must be a complete semantic version.");
  }
  if (options.expectedAuthenticodeStatus === "Valid") {
    if (!/^[a-f0-9]{40}$/i.test(options.expectedSignerThumbprint ?? "")) {
      throw new Error("--expected-signer-thumbprint must be a 40-character SHA-1 certificate thumbprint for Valid artifacts.");
    }
    if (!options.expectedPublisherSubject?.trim()) {
      throw new Error("--expected-publisher-subject is required for Valid artifacts.");
    }
  }
  for (const key of ["debugPort", "installTimeoutMinutes", "inferenceTimeoutSeconds"]) {
    const value = Number(options[key]);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer.`);
    options[key] = value;
  }
  if (options.debugPort > 65535) throw new Error("debugPort must be at most 65535.");
  options.expectedInstallerSha256 = options.expectedInstallerSha256.toUpperCase();
  options.expectedHarnessSha256 = options.expectedHarnessSha256.toUpperCase();
  options.expectedBuildCommit = options.expectedBuildCommit.toLowerCase();
  if (options.expectedSignerThumbprint) {
    options.expectedSignerThumbprint = options.expectedSignerThumbprint.toUpperCase();
  }
  if (options.expectedPublisherSubject) {
    options.expectedPublisherSubject = options.expectedPublisherSubject.trim();
  }
  return options;
}

export function selectMainCdpTarget(targets) {
  return targets.find((target) => {
    if (target?.type !== "page" || typeof target.webSocketDebuggerUrl !== "string") return false;
    try {
      const url = new URL(target.url);
      return url.protocol === "http:"
        && url.hostname === "tauri.localhost"
        && (url.pathname === "/" || url.pathname === "/index.html")
        && !url.searchParams.has("driftySurface");
    } catch {
      return false;
    }
  }) ?? null;
}

export function isManagedModelInstalled(status, modelId) {
  return Array.isArray(status?.installedModels)
    && status.installedModels.some((model) => model?.id === modelId);
}

export function classifyCredentialValue(value, qaPrefix) {
  if (value == null) return "empty";
  return typeof value === "string" && value.startsWith(qaPrefix) ? "qa" : "non-qa";
}

export function parseClassificationAnswer(content) {
  if (typeof content !== "string") return null;
  const visible = content
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "")
    .trim();
  return visible === "productive" || visible === "drift" ? visible : null;
}

export function requireManagedAiLoopbackEndpoint(baseUrl, expectedPort = MANAGED_AI_PORT) {
  const expected = `http://127.0.0.1:${expectedPort}/v1`;
  if (baseUrl !== expected) {
    throw new Error(`Managed local AI reported unexpected endpoint ${String(baseUrl)}; expected ${expected}.`);
  }
  return expected;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function appendError(existing, addition) {
  const redactedAddition = redactEvidenceText(addition);
  return existing ? `${existing} ${redactedAddition}` : redactedAddition;
}

function run(file, args, { env = process.env, timeoutMs = 0, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs) : null;
    child.once("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      const result = { code, signal, stdout: stdout.trim(), stderr: stderr.trim() };
      if (timedOut) {
        reject(new Error(`${file} timed out after ${timeoutMs} ms.`));
      } else if (!allowFailure && code !== 0) {
        reject(new Error(`${file} exited with code ${code}: ${result.stderr || result.stdout}`));
      } else {
        resolve(result);
      }
    });
  });
}

async function runPowerShell(script, env = {}) {
  return run(
    getWindowsToolPaths().powershell,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { env: { ...process.env, ...env } },
  );
}

async function sha256File(filePath) {
  await stat(filePath);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex").toUpperCase();
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex").toUpperCase();
}

export function redactEvidencePath(filePath, env = process.env) {
  for (const [label, root] of [["%LOCALAPPDATA%", env.LOCALAPPDATA], ["%USERPROFILE%", env.USERPROFILE]]) {
    if (!root) continue;
    const normalizedRoot = path.win32.resolve(root);
    const normalizedPath = path.win32.resolve(filePath);
    const relative = path.win32.relative(normalizedRoot, normalizedPath);
    if (relative === "") return label;
    if (relative !== ".." && !relative.startsWith(`..${path.win32.sep}`) && !path.win32.isAbsolute(relative)) {
      return path.win32.join(label, relative);
    }
  }
  return filePath;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactEvidenceText(value, env = process.env) {
  let redacted = String(value);
  const pathRoots = [
    ["%LOCALAPPDATA%", env.LOCALAPPDATA],
    ["%USERPROFILE%", env.USERPROFILE],
  ].filter(([, raw]) => typeof raw === "string" && raw.length > 0)
    .sort(([, left], [, right]) => right.length - left.length);
  for (const [label, raw] of pathRoots) {
    const variants = new Set([raw, raw.replaceAll("\\", "/")]);
    for (const variant of variants) {
      const pattern = new RegExp(`${escapeRegExp(variant)}(?=$|[\\\\/\\s'\"\\]\\[(){}:,;])`, "gi");
      redacted = redacted.replace(pattern, label);
    }
  }

  const identityTokens = [
    ["%USER_ID%", env.USERDOMAIN && env.USERNAME ? `${env.USERDOMAIN}\\${env.USERNAME}` : null],
    ["%USERNAME%", env.USERNAME],
    ["%USERDOMAIN%", env.USERDOMAIN],
    ["%COMPUTERNAME%", env.COMPUTERNAME],
  ].filter(([, raw]) => typeof raw === "string" && raw.length > 0)
    .sort(([, left], [, right]) => right.length - left.length);
  for (const [label, raw] of identityTokens) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(raw)}($|[^A-Za-z0-9_-])`, "gi");
    redacted = redacted.replace(pattern, `$1${label}$2`);
  }
  return redacted;
}

async function authenticodeDetails(filePath) {
  const result = await runPowerShell(
    [
      "$signature = Get-AuthenticodeSignature -LiteralPath $env:DRIFTY_QA_PATH",
      "$signer = $signature.SignerCertificate",
      "$timestamp = $signature.TimeStamperCertificate",
      "[pscustomobject]@{",
      "  status = [string]$signature.Status",
      "  signerSubject = if ($null -eq $signer) { $null } else { [string]$signer.Subject }",
      "  signerThumbprint = if ($null -eq $signer) { $null } else { [string]$signer.Thumbprint }",
      "  timestampSubject = if ($null -eq $timestamp) { $null } else { [string]$timestamp.Subject }",
      "  timestampThumbprint = if ($null -eq $timestamp) { $null } else { [string]$timestamp.Thumbprint }",
      "} | ConvertTo-Json -Compress",
    ].join("\n"),
    { DRIFTY_QA_PATH: filePath },
  );
  return JSON.parse(result.stdout);
}

async function windowsFileVersionDetails(filePath) {
  const result = await runPowerShell(
    [
      "$version = (Get-Item -LiteralPath $env:DRIFTY_QA_PATH).VersionInfo",
      "[pscustomobject]@{",
      "  productVersion = [string]$version.ProductVersion",
      "  fileVersion = [string]$version.FileVersion",
      "} | ConvertTo-Json -Compress",
    ].join("\n"),
    { DRIFTY_QA_PATH: filePath },
  );
  return JSON.parse(result.stdout);
}

function validateWindowsFileVersion(details, expectedVersion, artifactLabel) {
  if (details?.productVersion !== expectedVersion || details?.fileVersion !== expectedVersion) {
    throw new Error(
      `${artifactLabel} native version mismatch. Expected ${expectedVersion}, got product=${String(details?.productVersion)}, file=${String(details?.fileVersion)}.`,
    );
  }
}

export function validateAuthenticodeDetails(details, options, artifactLabel) {
  if (details?.status !== options.expectedAuthenticodeStatus) {
    throw new Error(`${artifactLabel} Authenticode status mismatch. Expected ${options.expectedAuthenticodeStatus}, got ${String(details?.status)}.`);
  }
  if (options.expectedAuthenticodeStatus !== "Valid") return;
  const signerThumbprint = String(details.signerThumbprint ?? "").toUpperCase();
  if (signerThumbprint !== options.expectedSignerThumbprint) {
    throw new Error(`${artifactLabel} signer thumbprint mismatch.`);
  }
  if (String(details.signerSubject ?? "").trim() !== options.expectedPublisherSubject) {
    throw new Error(`${artifactLabel} publisher subject mismatch.`);
  }
  if (!String(details.timestampSubject ?? "").trim() || !String(details.timestampThumbprint ?? "").trim()) {
    throw new Error(`${artifactLabel} has no Authenticode timestamp certificate.`);
  }
}

export function isCleanupComplete(cleanup) {
  return cleanup?.appStopped === true
    && cleanup?.debugPortClosed === true
    && cleanup?.managedAiPortClosed === true
    && Array.isArray(cleanup?.residualProductProcessIds)
    && cleanup.residualProductProcessIds.length === 0;
}

async function getListeners(port) {
  const script = [
    "$items = @(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:DRIFTY_QA_PORT) -ErrorAction SilentlyContinue |",
    "  Select-Object LocalAddress,LocalPort,OwningProcess)",
    "if ($items.Count -eq 0) { '[]' } else { $items | ConvertTo-Json -Compress }",
  ].join("\n");
  const result = await runPowerShell(script, { DRIFTY_QA_PORT: String(port) });
  const parsed = JSON.parse(result.stdout || "[]");
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function getProcessIdsByName(name) {
  const result = await runPowerShell(
    "$ids = @(Get-Process -Name $env:DRIFTY_QA_PROCESS -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id); if ($ids.Count -eq 0) { '[]' } else { $ids | ConvertTo-Json -Compress }",
    { DRIFTY_QA_PROCESS: name },
  );
  const parsed = JSON.parse(result.stdout || "[]");
  return Array.isArray(parsed) ? parsed.map(Number) : [Number(parsed)];
}

async function getProductProcessIds() {
  const processIds = await Promise.all([
    getProcessIdsByName("drifty"),
    getProcessIdsByName("drifty-tracker"),
    getProcessIdsByName("llama-server"),
  ]);
  return [...new Set(processIds.flat())];
}

async function getCurrentSessionId() {
  const result = await runPowerShell(
    "(Get-Process -Id ([int]$env:DRIFTY_QA_NODE_PID)).SessionId",
    { DRIFTY_QA_NODE_PID: String(process.pid) },
  );
  return Number(result.stdout);
}

async function hasInteractiveDesktopShell(sessionId) {
  const result = await runPowerShell(
    "$count = @(Get-Process -Name explorer -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq ([int]$env:DRIFTY_QA_SESSION_ID) }).Count; [bool]($count -gt 0)",
    { DRIFTY_QA_SESSION_ID: String(sessionId) },
  );
  return result.stdout.trim().toLowerCase() === "true";
}

async function getDescendantProcessIds(rootProcessId) {
  const script = [
    "$root = [int]$env:DRIFTY_QA_ROOT_PID",
    "$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)",
    "$pending = [Collections.Generic.Queue[int]]::new()",
    "$found = [Collections.Generic.List[int]]::new()",
    "$pending.Enqueue($root)",
    "while ($pending.Count -gt 0) {",
    "  $parent = $pending.Dequeue()",
    "  foreach ($child in @($all | Where-Object { $_.ParentProcessId -eq $parent })) {",
    "    $id = [int]$child.ProcessId",
    "    if (-not $found.Contains($id)) { $found.Add($id); $pending.Enqueue($id) }",
    "  }",
    "}",
    "if ($found.Count -eq 0) { '[]' } else { $found.ToArray() | ConvertTo-Json -Compress }",
  ].join("\n");
  const result = await runPowerShell(script, { DRIFTY_QA_ROOT_PID: String(rootProcessId) });
  const parsed = JSON.parse(result.stdout || "[]");
  return Array.isArray(parsed) ? parsed.map(Number) : [Number(parsed)];
}

async function findInstalledAppPath() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error("LOCALAPPDATA is unavailable in the QA session.");
  const candidates = [
    path.join(localAppData, "drifty", "drifty.exe"),
    path.join(localAppData, "Drifty", "drifty.exe"),
    path.join(localAppData, "Programs", "drifty", "drifty.exe"),
    path.join(localAppData, "Programs", "Drifty", "drifty.exe"),
  ];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // Continue through the known NSIS per-user install locations.
    }
  }
  return null;
}

async function resolveInstalledAppPath() {
  const installedPath = await findInstalledAppPath();
  if (installedPath) return installedPath;
  throw new Error(`Installed drifty.exe was not found under ${process.env.LOCALAPPDATA}.`);
}

async function removePreexistingInstallation() {
  const appPath = await findInstalledAppPath();
  if (!appPath) return { found: false, removed: true };
  const uninstallerPath = path.join(path.dirname(appPath), "uninstall.exe");
  if (!(await pathExists(uninstallerPath))) {
    throw new Error(`Pre-existing Drifty installation has no uninstaller: ${uninstallerPath}`);
  }
  const uninstall = await run(uninstallerPath, ["/S"], { timeoutMs: 5 * 60_000, allowFailure: true });
  if (uninstall.code !== 0) throw new Error(`Pre-existing Drifty uninstaller exited with code ${uninstall.code}.`);
  await delay(1_000);
  if (await findInstalledAppPath()) throw new Error("Pre-existing Drifty executable remained after silent uninstall.");
  return { found: true, removed: true };
}

async function waitForMainTarget(port, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const target = selectMainCdpTarget(await response.json());
        if (target) return target;
      }
    } catch {
      // The endpoint is expected to refuse connections while WebView2 starts.
    }
    await delay(500);
  }
  throw new Error(`A main-window WebView2 DevTools target did not appear within ${timeoutMs / 1000} seconds.`);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener("message", (event) => this.onMessage(event));
    socket.addEventListener("close", () => this.rejectAll(new Error("WebView2 DevTools socket closed.")));
    socket.addEventListener("error", () => this.rejectAll(new Error("WebView2 DevTools socket failed.")));
  }

  static async connect(url, timeoutMs = 10_000) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("WebView2 DevTools socket connection timed out."));
      }, timeoutMs);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("WebView2 DevTools socket connection failed."));
      }, { once: true });
    });
    return new CdpClient(socket);
  }

  onMessage(event) {
    let message;
    try {
      message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    } catch {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(`CDP command failed: ${message.error.message}`));
    else pending.resolve(message.result);
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(method, params, timeoutMs = 60_000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = 60_000) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs);
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.value
        ?? result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text;
      throw new Error(`JavaScript evaluation failed: ${detail}`);
    }
    if (result.result?.subtype === "error") {
      throw new Error(`JavaScript evaluation returned an error: ${result.result.description}`);
    }
    return result.result?.value;
  }

  async invoke(command, args = {}, timeoutMs = 60_000) {
    const outcome = await this.evaluate(`
      (async () => {
        try {
          return {
            ok: true,
            value: await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})
          };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      })()
    `, timeoutMs);
    if (!outcome?.ok) throw new Error(`Tauri command ${command} failed: ${outcome?.error ?? "unknown error"}`);
    return outcome.value;
  }

  close() {
    this.rejectAll(new Error("CDP client closed."));
    this.socket.close();
  }
}

async function waitForTauriBridge(cdp, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate("Boolean(window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function')", 5_000)) return;
    } catch {
      // Navigation and initialization can briefly invalidate evaluations.
    }
    await delay(500);
  }
  throw new Error(`Tauri invoke bridge did not become available within ${timeoutMs / 1000} seconds.`);
}

async function restoreCredential(cdp) {
  return cdp.evaluate(`
    (async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const current = await invoke("openrouter_load_api_key", {});
      const kind = (${classifyCredentialValue.toString()})(current, ${JSON.stringify(QA_CREDENTIAL_PREFIX)});
      if (kind === "empty") return { restored: true, attempted: false };
      if (kind === "non-qa") {
        return { restored: false, attempted: false, blockedByNonQaValue: true };
      }
      await invoke("openrouter_clear_api_key", {});
      const afterClear = await invoke("openrouter_load_api_key", {});
      return { restored: afterClear == null, attempted: true };
    })()
  `, 30_000);
}

async function writeEvidence(evidencePath, value) {
  await mkdir(path.dirname(evidencePath), { recursive: true });
  const temporaryPath = `${evidencePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, evidencePath);
}

function makeResult(options) {
  return {
    schemaVersion: 2,
    passed: false,
    startedAtUtc: new Date().toISOString(),
    completedAtUtc: null,
    harness: {
      expectedSha256: options.expectedHarnessSha256,
      sha256: null,
      nodeVersion: process.version,
      windowsToolPaths: null,
    },
    machine: {
      platform: "windows",
      interactiveSessionId: null,
      interactiveDesktopShell: false,
    },
    installer: {
      path: redactEvidencePath(options.installerPath),
      expectedSha256: options.expectedInstallerSha256,
      actualSha256: null,
      expectedAuthenticodeStatus: options.expectedAuthenticodeStatus,
      authenticodeStatus: null,
      authenticode: null,
      nativeVersion: null,
      preexistingAppFound: null,
      preexistingAppRemoved: null,
      appAbsentBeforeInstall: null,
      exitCode: null,
    },
    app: {
      path: null,
      createdAfterVerifiedInstaller: false,
      sha256: null,
      authenticodeStatus: null,
      authenticode: null,
      nativeVersion: null,
      expectedBuildCommit: options.expectedBuildCommit,
      buildCommit: null,
      expectedVersion: options.expectedAppVersion,
      version: null,
      processId: null,
    },
    tracker: {
      path: null,
      sha256: null,
      authenticodeStatus: null,
      authenticode: null,
    },
    debugTransport: {
      port: options.debugPort,
      environmentScope: "spawned-app-only",
      loopbackOnly: false,
      mainWindowSelected: false,
      tauriInvokeReady: false,
    },
    credentialManager: {
      emptyBaselineConfirmed: false,
      staleQaSentinelRecovered: false,
      firstCreateReadPassed: false,
      updateReadPassed: false,
      targetVisibleToCmdKey: false,
      deletePassed: false,
      targetAbsentAfterDelete: false,
      emptyBaselineRestored: false,
    },
    cloudDeviceIdentity: {
      platformIsWindows: false,
      installIdStable: false,
    },
    managedLocalAi: {
      modelId: options.modelId,
      alreadyInstalled: false,
      installed: false,
      running: false,
      baseUrl: null,
      runtimeModel: null,
      portFreeAtStart: false,
      listenerOwnedByApp: false,
      challengeCount: 0,
      classificationResults: [],
      responseStatus: null,
      responseLatencyMs: null,
      responseBodySha256: null,
      challengeSha256: null,
      assistantContentLength: null,
      answerMatched: false,
      deleteRequested: options.deleteManagedAiModel,
      presentAfterQa: null,
    },
    cleanup: {
      credentialBaselineRestored: false,
      productProcessBaselineEmpty: false,
      capturedProductProcessIds: [],
      terminatedResidualProductProcessIds: [],
      appStopped: null,
      taskkillExitCode: null,
      debugPortClosed: false,
      managedAiPortClosed: false,
      residualProductProcessIds: [],
    },
    error: null,
  };
}

async function runQa(options) {
  const result = makeResult(options);
  const sentinelOne = `drifty-packaged-qa-one-${randomUUID()}`;
  const sentinelTwo = `drifty-packaged-qa-two-${randomUUID()}`;
  let appProcess = null;
  let cdp = null;
  let credentialMutationStarted = false;

  try {
    result.harness.sha256 = await sha256File(fileURLToPath(import.meta.url));
    if (result.harness.sha256 !== options.expectedHarnessSha256) {
      throw new Error(`Harness SHA-256 mismatch. Expected ${options.expectedHarnessSha256}, got ${result.harness.sha256}.`);
    }
    const windowsToolPaths = getWindowsToolPaths();
    for (const toolPath of Object.values(windowsToolPaths)) await stat(toolPath);
    result.harness.windowsToolPaths = windowsToolPaths;
    result.machine.interactiveSessionId = await getCurrentSessionId();
    result.machine.interactiveDesktopShell = await hasInteractiveDesktopShell(result.machine.interactiveSessionId);
    if (!result.machine.interactiveDesktopShell) {
      throw new Error("The harness is not running in a session with an active Explorer desktop shell.");
    }
    if ((await getListeners(options.debugPort)).length > 0) {
      throw new Error(`Refusing to reuse occupied TCP port ${options.debugPort}.`);
    }
    result.managedLocalAi.portFreeAtStart = (await getListeners(MANAGED_AI_PORT)).length === 0;
    if (!result.managedLocalAi.portFreeAtStart) {
      throw new Error(`Refusing to reuse occupied managed local AI port ${MANAGED_AI_PORT}.`);
    }
    const productProcessBaseline = await getProductProcessIds();
    result.cleanup.productProcessBaselineEmpty = productProcessBaseline.length === 0;
    if (!result.cleanup.productProcessBaselineEmpty) {
      throw new Error(`Refusing to run while Drifty product processes exist: ${productProcessBaseline.join(", ")}.`);
    }

    result.installer.actualSha256 = await sha256File(options.installerPath);
    if (result.installer.actualSha256 !== options.expectedInstallerSha256) {
      throw new Error(`Installer SHA-256 mismatch. Expected ${options.expectedInstallerSha256}, got ${result.installer.actualSha256}.`);
    }
    result.installer.authenticode = await authenticodeDetails(options.installerPath);
    result.installer.authenticodeStatus = result.installer.authenticode.status;
    validateAuthenticodeDetails(result.installer.authenticode, options, "Installer");
    result.installer.nativeVersion = await windowsFileVersionDetails(options.installerPath);
    validateWindowsFileVersion(result.installer.nativeVersion, options.expectedAppVersion, "Installer");
    const preexistingInstallation = await removePreexistingInstallation();
    result.installer.preexistingAppFound = preexistingInstallation.found;
    result.installer.preexistingAppRemoved = preexistingInstallation.removed;
    result.installer.appAbsentBeforeInstall = !(await findInstalledAppPath());
    if (!result.installer.appAbsentBeforeInstall) {
      throw new Error("Drifty executable exists immediately before verified installer execution.");
    }
    const installer = await run(options.installerPath, ["/S"], { timeoutMs: 5 * 60_000, allowFailure: true });
    result.installer.exitCode = installer.code;
    if (installer.code !== 0) throw new Error(`Installer exited with code ${installer.code}.`);

    const appPath = await resolveInstalledAppPath();
    result.app.path = redactEvidencePath(appPath);
    result.app.createdAfterVerifiedInstaller = true;
    result.app.sha256 = await sha256File(appPath);
    result.app.authenticode = await authenticodeDetails(appPath);
    result.app.authenticodeStatus = result.app.authenticode.status;
    validateAuthenticodeDetails(result.app.authenticode, options, "Installed app");
    result.app.nativeVersion = await windowsFileVersionDetails(appPath);
    validateWindowsFileVersion(result.app.nativeVersion, options.expectedAppVersion, "Installed app");

    const trackerPath = path.join(path.dirname(appPath), "drifty-tracker", "drifty-tracker.exe");
    await stat(trackerPath);
    result.tracker.path = redactEvidencePath(trackerPath);
    result.tracker.sha256 = await sha256File(trackerPath);
    result.tracker.authenticode = await authenticodeDetails(trackerPath);
    result.tracker.authenticodeStatus = result.tracker.authenticode.status;
    validateAuthenticodeDetails(result.tracker.authenticode, options, "Installed tracker");

    appProcess = spawn(appPath, [], {
      env: {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${options.debugPort}`,
      },
      windowsHide: false,
      stdio: "ignore",
    });
    appProcess.on("error", () => {});
    result.app.processId = appProcess.pid;

    const target = await waitForMainTarget(options.debugPort);
    const listeners = await getListeners(options.debugPort);
    if (listeners.length === 0 || listeners.some((listener) => !["127.0.0.1", "::1"].includes(listener.LocalAddress))) {
      throw new Error(`TCP port ${options.debugPort} is not restricted to loopback.`);
    }
    result.debugTransport.loopbackOnly = true;
    result.debugTransport.mainWindowSelected = true;
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    await waitForTauriBridge(cdp);
    result.debugTransport.tauriInvokeReady = true;
    const buildIdentity = await cdp.evaluate(`({
      commit: document.documentElement.dataset.driftyBuildCommit ?? null,
      version: document.documentElement.dataset.driftyAppVersion ?? null
    })`);
    result.app.buildCommit = typeof buildIdentity?.commit === "string" ? buildIdentity.commit.toLowerCase() : null;
    if (result.app.buildCommit !== options.expectedBuildCommit) {
      throw new Error(`Installed app build commit mismatch. Expected ${options.expectedBuildCommit}, got ${String(result.app.buildCommit)}.`);
    }
    result.app.version = typeof buildIdentity?.version === "string" ? buildIdentity.version : null;
    if (result.app.version !== options.expectedAppVersion) {
      throw new Error(`Installed app version mismatch. Expected ${options.expectedAppVersion}, got ${String(result.app.version)}.`);
    }

    credentialMutationStarted = true;
    const credentialStart = await cdp.evaluate(`
      (async () => {
        try {
          const invoke = window.__TAURI_INTERNALS__.invoke;
          const existing = await invoke("openrouter_load_api_key", {});
          const existingKind = (${classifyCredentialValue.toString()})(existing, ${JSON.stringify(QA_CREDENTIAL_PREFIX)});
          let staleQaSentinelRecovered = false;
          if (existingKind === "non-qa") {
            return { saved: false, refusedExistingCredential: true };
          }
          if (existingKind === "qa") {
            await invoke("openrouter_clear_api_key", {});
            staleQaSentinelRecovered = true;
          }
          const emptyBaselineConfirmed = await invoke("openrouter_load_api_key", {}) == null;
          if (!emptyBaselineConfirmed) return { saved: false, error: "QA credential baseline is not empty" };
          await invoke("openrouter_save_api_key", { value: ${JSON.stringify(sentinelOne)} });
          return { saved: true, emptyBaselineConfirmed, staleQaSentinelRecovered };
        } catch (error) {
          return { saved: false, error: String(error) };
        }
      })()
    `);
    if (credentialStart?.refusedExistingCredential) {
      throw new Error("Refusing to mutate a QA account that already contains a non-QA OpenRouter credential.");
    }
    if (!credentialStart?.saved) throw new Error(`Credential Manager create step did not complete: ${credentialStart?.error ?? "unknown error"}`);
    result.credentialManager.emptyBaselineConfirmed = credentialStart.emptyBaselineConfirmed === true;
    result.credentialManager.staleQaSentinelRecovered = credentialStart.staleQaSentinelRecovered === true;
    result.credentialManager.firstCreateReadPassed = await cdp.invoke("openrouter_load_api_key") === sentinelOne;
    if (!result.credentialManager.firstCreateReadPassed) throw new Error("Credential Manager create/read round trip failed.");

    await cdp.invoke("openrouter_save_api_key", { value: sentinelTwo });
    result.credentialManager.updateReadPassed = await cdp.invoke("openrouter_load_api_key") === sentinelTwo;
    if (!result.credentialManager.updateReadPassed) throw new Error("Credential Manager update/read round trip failed.");
    const credentialInventory = await run(windowsToolPaths.cmdkey, ["/list"]);
    result.credentialManager.targetVisibleToCmdKey = credentialInventory.stdout.includes(WINDOWS_OPENROUTER_TARGET);
    if (!result.credentialManager.targetVisibleToCmdKey) {
      throw new Error("The OpenRouter target was not visible in the current user's Windows Credential Manager inventory.");
    }

    await cdp.invoke("openrouter_clear_api_key");
    result.credentialManager.deletePassed = await cdp.invoke("openrouter_load_api_key") == null;
    if (!result.credentialManager.deletePassed) throw new Error("Credential Manager delete/read round trip failed.");
    const inventoryAfterDelete = await run(windowsToolPaths.cmdkey, ["/list"]);
    result.credentialManager.targetAbsentAfterDelete = !inventoryAfterDelete.stdout.includes(WINDOWS_OPENROUTER_TARGET);
    if (!result.credentialManager.targetAbsentAfterDelete) {
      throw new Error("The exact OpenRouter target remained in Windows Credential Manager after delete.");
    }
    const credentialRestore = await restoreCredential(cdp);
    result.credentialManager.emptyBaselineRestored = credentialRestore?.restored === true;
    credentialMutationStarted = false;
    result.cleanup.credentialBaselineRestored = result.credentialManager.emptyBaselineRestored;
    if (!result.credentialManager.emptyBaselineRestored) throw new Error("The empty QA credential baseline was not restored.");

    const identityOne = await cdp.invoke("cloud_device_identity");
    const identityTwo = await cdp.invoke("cloud_device_identity");
    result.cloudDeviceIdentity.platformIsWindows = identityOne?.platform === "windows";
    result.cloudDeviceIdentity.installIdStable = typeof identityOne?.installId === "string"
      && identityOne.installId.length > 0
      && identityOne.installId === identityTwo?.installId;
    if (!result.cloudDeviceIdentity.platformIsWindows || !result.cloudDeviceIdentity.installIdStable) {
      throw new Error("Cloud device identity was not stable or did not report the Windows platform.");
    }

    const catalog = await cdp.invoke("managed_ai_catalog");
    if (!Array.isArray(catalog) || catalog.filter((model) => model?.id === options.modelId).length !== 1) {
      throw new Error(`Managed local AI catalog does not contain model ${options.modelId}.`);
    }
    let status = await cdp.invoke("managed_ai_status");
    result.managedLocalAi.alreadyInstalled = isManagedModelInstalled(status, options.modelId);
    if (!result.managedLocalAi.alreadyInstalled) {
      await cdp.evaluate(`
        (() => {
          window.__driftyPackagedQaModelInstall = window.__TAURI_INTERNALS__.invoke(
            "managed_ai_install",
            { modelId: ${JSON.stringify(options.modelId)} }
          ).then(
            status => ({ ok: true, status }),
            error => ({ ok: false, error: String(error) })
          );
          return true;
        })()
      `);
      const installDeadline = Date.now() + options.installTimeoutMinutes * 60_000;
      let lastProgress = -1;
      while (!isManagedModelInstalled(status, options.modelId) && Date.now() < installDeadline) {
        await delay(3_000);
        status = await cdp.invoke("managed_ai_status");
        if (status?.state === "error") throw new Error(`Managed local AI installation failed: ${status.message}`);
        const progress = status?.progress?.percent;
        if (Number.isFinite(progress) && progress !== lastProgress) {
          console.log(`Managed local AI download: ${progress}%`);
          lastProgress = progress;
        }
      }
      if (!isManagedModelInstalled(status, options.modelId)) {
        throw new Error(`Managed local AI installation timed out after ${options.installTimeoutMinutes} minutes.`);
      }
      const installResult = await cdp.evaluate("(async () => await window.__driftyPackagedQaModelInstall)()", 60_000);
      if (!installResult?.ok) throw new Error(`Managed local AI install promise failed: ${installResult?.error}`);
    }
    result.managedLocalAi.installed = true;

    status = await cdp.invoke("managed_ai_start", { modelId: options.modelId }, 180_000);
    const runtimeDeadline = Date.now() + 5 * 60_000;
    while (status?.state !== "running" && Date.now() < runtimeDeadline) {
      if (status?.state === "error") throw new Error(`Managed local AI runtime failed: ${status.message}`);
      await delay(2_000);
      status = await cdp.invoke("managed_ai_status");
    }
    if (status?.state !== "running") throw new Error("Managed local AI runtime did not reach running state within five minutes.");
    result.managedLocalAi.running = true;
    result.managedLocalAi.baseUrl = requireManagedAiLoopbackEndpoint(status.baseUrl);
    result.managedLocalAi.runtimeModel = status.model;
    const runtimeListeners = await getListeners(MANAGED_AI_PORT);
    const runningDescendants = await getDescendantProcessIds(appProcess.pid);
    result.managedLocalAi.listenerOwnedByApp = runtimeListeners.length > 0
      && runtimeListeners.every((listener) => runningDescendants.includes(Number(listener.OwningProcess)));
    if (!result.managedLocalAi.listenerOwnedByApp) {
      throw new Error(`Managed local AI port ${MANAGED_AI_PORT} is not owned by the launched Drifty process tree.`);
    }

    const classificationCases = [
      { activity: "writing and running unit tests in Visual Studio Code", expected: "productive" },
      { activity: "watching unrelated entertainment videos during planned work time", expected: "drift" },
    ];
    for (const classificationCase of classificationCases) {
      const challenge = `Choose exactly one label: productive or drift. Activity: ${classificationCase.activity}. Return only the label.`;
      const chat = await cdp.invoke("ai_classification_openai_chat", {
        request: {
          baseUrl: status.baseUrl,
          model: status.model,
          messages: [{ role: "user", content: challenge }],
          maxTokens: 64,
          timeoutMs: options.inferenceTimeoutSeconds * 1000,
          temperature: 0,
          reasoningFormat: "none",
          chatTemplateKwargs: { enable_thinking: false },
          headers: {},
        },
      }, (options.inferenceTimeoutSeconds + 30) * 1000);
      if (chat?.status !== 200) throw new Error(`Managed local AI inference returned HTTP ${chat?.status}.`);
      let assistantContent;
      try {
        assistantContent = JSON.parse(chat.body)?.choices?.[0]?.message?.content;
      } catch (error) {
        throw new Error(`Managed local AI response was not valid OpenAI-compatible JSON: ${error.message}`);
      }
      const parsedAnswer = parseClassificationAnswer(assistantContent);
      const classificationResult = {
        expected: classificationCase.expected,
        challengeSha256: sha256Text(challenge),
        responseStatus: chat.status,
        responseLatencyMs: chat.latencyMs,
        responseBodySha256: sha256Text(chat.body ?? ""),
        assistantContentLength: typeof assistantContent === "string" ? assistantContent.length : 0,
        answerMatched: parsedAnswer === classificationCase.expected,
      };
      result.managedLocalAi.classificationResults.push(classificationResult);
      if (!classificationResult.answerMatched) {
        throw new Error(`Managed local AI response did not match the independently computed ${classificationCase.expected} answer.`);
      }
    }
    result.managedLocalAi.challengeCount = result.managedLocalAi.classificationResults.length;
    result.managedLocalAi.responseStatus = 200;
    result.managedLocalAi.responseLatencyMs = Math.max(
      ...result.managedLocalAi.classificationResults.map((entry) => entry.responseLatencyMs),
    );
    result.managedLocalAi.challengeSha256 = sha256Text(
      result.managedLocalAi.classificationResults.map((entry) => entry.challengeSha256).join(":"),
    );
    result.managedLocalAi.responseBodySha256 = sha256Text(
      result.managedLocalAi.classificationResults.map((entry) => entry.responseBodySha256).join(":"),
    );
    result.managedLocalAi.assistantContentLength = result.managedLocalAi.classificationResults
      .reduce((total, entry) => total + entry.assistantContentLength, 0);
    result.managedLocalAi.answerMatched = result.managedLocalAi.challengeCount === classificationCases.length
      && result.managedLocalAi.classificationResults.every((entry) => entry.answerMatched);

    result.passed = true;
  } catch (error) {
    result.error = redactEvidenceText(error instanceof Error ? error.message : String(error));
  } finally {
    if (credentialMutationStarted && cdp) {
      try {
        const restoreOutcome = await restoreCredential(cdp);
        result.credentialManager.emptyBaselineRestored = restoreOutcome?.restored === true;
        result.cleanup.credentialBaselineRestored = restoreOutcome?.restored === true;
      } catch (error) {
        result.passed = false;
        result.error = appendError(result.error, `Credential restoration also failed: ${error.message}`);
      }
    }
    if (cdp) {
      if (options.deleteManagedAiModel) {
        try {
          await cdp.invoke("managed_ai_delete", { modelId: options.modelId }, 180_000);
        } catch (error) {
          result.passed = false;
          result.error = appendError(result.error, `Managed model deletion also failed: ${error.message}`);
        }
      }
      try {
        const finalModelStatus = await cdp.invoke("managed_ai_status");
        result.managedLocalAi.presentAfterQa = isManagedModelInstalled(finalModelStatus, options.modelId);
        if (options.deleteManagedAiModel && result.managedLocalAi.presentAfterQa) {
          result.passed = false;
          result.error = appendError(result.error, "Managed local AI model remained installed after deletion was requested.");
        }
      } catch (error) {
        result.passed = false;
        result.error = appendError(result.error, `Final managed model state could not be observed: ${error.message}`);
      }
    }
    if (appProcess?.pid) {
      result.cleanup.capturedProductProcessIds = await getProductProcessIds();
    }
    if (cdp) cdp.close();

    if (appProcess?.pid) {
      const taskkill = await run(getWindowsToolPaths().taskkill, ["/PID", String(appProcess.pid), "/T", "/F"], { allowFailure: true, timeoutMs: 30_000 });
      result.cleanup.taskkillExitCode = taskkill.code;
      await delay(3_000);
      result.cleanup.appStopped = (await getProcessIdsByName("drifty")).length === 0;
    } else {
      result.cleanup.appStopped = (await getProcessIdsByName("drifty")).length === 0;
    }
    const residualAfterTreeKill = await getProductProcessIds();
    const capturedProcessIds = new Set(result.cleanup.capturedProductProcessIds);
    result.cleanup.terminatedResidualProductProcessIds = residualAfterTreeKill
      .filter((processId) => capturedProcessIds.has(processId));
    for (const processId of result.cleanup.terminatedResidualProductProcessIds) {
      await run(getWindowsToolPaths().taskkill, ["/PID", String(processId), "/F"], { allowFailure: true, timeoutMs: 30_000 });
    }
    if (result.cleanup.terminatedResidualProductProcessIds.length > 0) await delay(2_000);
    result.cleanup.residualProductProcessIds = await getProductProcessIds();
    result.cleanup.debugPortClosed = (await getListeners(options.debugPort)).length === 0;
    result.cleanup.managedAiPortClosed = (await getListeners(MANAGED_AI_PORT)).length === 0;
    // taskkill returns 128 when the app has already exited. Treat that code as
    // diagnostic only and gate on the independently observed final state.
    if (!isCleanupComplete(result.cleanup)) {
      result.passed = false;
      result.error = appendError(result.error, "Packaged runtime cleanup did not close the captured app process tree and reserved listeners.");
    }
    result.error = result.error == null ? null : redactEvidenceText(result.error);
    result.completedAtUtc = new Date().toISOString();
    await writeEvidence(options.evidencePath, result);
  }
  return result;
}

async function main() {
  let options;
  try {
    options = parseCli(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error("Usage: node windows-packaged-runtime.mjs --installer <path> --expected-sha256 <sha256> --expected-authenticode-status <NotSigned|Valid> --expected-build-commit <full-sha> --expected-app-version <semver> --expected-harness-sha256 <sha256> [--expected-signer-thumbprint <sha1> --expected-publisher-subject <subject>] --evidence <path>");
    return 2;
  }
  if (process.platform !== "win32") {
    console.error("This QA harness must run in an interactive Windows session.");
    return 2;
  }
  if (typeof WebSocket !== "function") {
    console.error("Node.js 22 or newer is required for the built-in WebSocket client.");
    return 2;
  }
  if (await pathExists(options.evidencePath)) {
    console.error(`Refusing to overwrite existing evidence: ${options.evidencePath}`);
    return 2;
  }
  const result = await runQa(options);
  if (!result.passed) console.error(result.error);
  else console.log(`Packaged runtime QA passed. Evidence: ${options.evidencePath}`);
  return result.passed ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = await main();
