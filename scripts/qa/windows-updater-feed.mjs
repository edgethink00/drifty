import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, appendFile, lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const QA_BASE = "http://127.0.0.1:19457/windows-updater-qa";
export const QA_VERSIONS = ["1.11.2401", "1.11.2402"];

export function qaBuildConfig(version) {
  assert.ok(QA_VERSIONS.includes(version), "Only the two private QA versions are allowed");
  return {
    version,
    identifier: "so.drifty.windows.updaterqa",
    plugins: {
      "deep-link": { desktop: { schemes: ["drifty-updater-qa"] } },
      updater: {
        // Loopback is an untrusted byte transport. The ordinary updater public
        // key and mandatory signature validation remain enabled. No TLS trust
        // store or production endpoint is modified.
        dangerousInsecureTransportProtocol: true,
        dangerousAcceptInvalidCerts: false,
        dangerousAcceptInvalidHostnames: false,
        endpoints: [`${QA_BASE}/latest-windows.json`],
      },
    },
  };
}

export function qaVersionFromEnvironment(env) {
  if (env.DRIFTY_WINDOWS_UPDATER_QA !== "1") {
    assert.ok(!env.DRIFTY_WINDOWS_UPDATER_QA_VERSION, "QA version requires an explicit QA build");
    return null;
  }
  const version = env.DRIFTY_WINDOWS_UPDATER_QA_VERSION;
  assert.ok(QA_VERSIONS.includes(version), "Invalid private QA build version");
  return version;
}

export function qaManifest(version, signature) {
  assert.ok(QA_VERSIONS.includes(version));
  assert.equal(Buffer.byteLength(signature), 420);
  return {
    version,
    notes: "Private Windows updater-cycle QA",
    pub_date: "2026-09-30T00:00:00Z",
    platforms: { "windows-x86_64": {
      url: `${QA_BASE}/${version}-win/drifty_${version}_x64-setup.exe`, signature,
    } },
  };
}

export async function startQaFeed({ root, records, controlFile, logFile }) {
  assert.equal(records.length, 2);
  const assets = new Map();
  const manifests = new Map();
  for (const [index, record] of records.entries()) {
    assert.equal(record.version, QA_VERSIONS[index]);
    assert.match(record.sha256, /^[a-f0-9]{64}$/u);
    const file = path.resolve(root, `drifty_${record.version}_x64-setup.exe`);
    assert.equal((await lstat(file)).isSymbolicLink(), false);
    const bytes = await readFile(file);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), record.sha256);
    assert.equal(bytes.subarray(0, 2).toString(), "MZ");
    const signature = (await readFile(`${file}.sig`, "utf8")).trim();
    manifests.set(record.version, qaManifest(record.version, signature));
    assets.set(`/windows-updater-qa/${record.version}-win/drifty_${record.version}_x64-setup.exe`, bytes);
  }
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" || request.headers.host !== "127.0.0.1:19457") {
        response.writeHead(403).end(); return;
      }
      const state = JSON.parse(await readFile(controlFile, "utf8"));
      assert.ok(["off", "healthy", "invalid-signature", "interrupted"].includes(state.mode));
      assert.ok(QA_VERSIONS.includes(state.version));
      const uri = request.url;
      let body, type = "application/json";
      if (uri === "/windows-updater-qa/latest-windows.json") {
        if (state.mode === "off") {
          const item = { at: new Date().toISOString(), path: uri, mode: state.mode, bytes: 0, status: 204 };
          requests.push(item);
          await appendFile(logFile, `${JSON.stringify(item)}\n`);
          response.writeHead(204).end(); return;
        }
        const manifest = structuredClone(manifests.get(state.version));
        if (state.mode === "invalid-signature") {
          const value = manifest.platforms["windows-x86_64"].signature;
          const decoded = Buffer.from(value, "base64");
          const text = decoded.toString("utf8").split("\n");
          const signatureBytes = Buffer.from(text[1], "base64");
          signatureBytes[20] ^= 1;
          text[1] = signatureBytes.toString("base64");
          manifest.platforms["windows-x86_64"].signature = Buffer.from(text.join("\n")).toString("base64");
        }
        body = Buffer.from(JSON.stringify(manifest));
      } else if (uri === `/windows-updater-qa/${state.version}-win/update-policy.json`) {
        body = Buffer.from(JSON.stringify({ policyVersion: 2, version: state.version,
          urgency: "general", backgroundDownload: true, installBehavior: "idle",
          promptAfterHours: 72, autoInstall: false, message: "Private automatic update QA" }));
      } else if (assets.has(uri)) {
        body = assets.get(uri); type = "application/octet-stream";
      } else { response.writeHead(404).end(); return; }
      const item = { at: new Date().toISOString(), path: uri, mode: state.mode, bytes: body.length };
      requests.push(item);
      await appendFile(logFile, `${JSON.stringify(item)}\n`);
      response.writeHead(200, { "Content-Type": type, "Content-Length": body.length, "Cache-Control": "no-store" });
      if (state.mode === "interrupted" && type === "application/octet-stream") {
        response.write(body.subarray(0, 65536)); setTimeout(() => response.destroy(), 50);
      } else response.end(body);
    } catch { response.destroy(); }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(19457, "127.0.0.1", resolve);
  });
  return { server, requests };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [configFile] = process.argv.slice(2);
  const config = JSON.parse(await readFile(configFile, "utf8"));
  const { server } = await startQaFeed(config);
  console.log(JSON.stringify({ ready: true, address: QA_BASE, publicFeedChanged: false }));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
}
