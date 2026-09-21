#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const WINDOWS_VC_REDIST_X64 = Object.freeze({
  url: "https://aka.ms/vc14/vc_redist.x64.exe",
  sha256: "843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c",
  fileVersion: "14.51.36247.0",
  signerSubject: "CN=Microsoft Corporation",
  signerThumbprint: "1D77A9B9E8FE2075D9AD15123257FB90DB0DA4A1",
});

export const windowsVcRedistOutput = resolve(
  repoRoot,
  "src-tauri/windows/generated/vc_redist.x64.exe",
);

export function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function assertVcRedistMetadata(metadata, expected = WINDOWS_VC_REDIST_X64) {
  if (metadata.status !== "Valid") {
    throw new Error(`VC++ Redistributable Authenticode status is ${metadata.status ?? "missing"}.`);
  }
  if (!metadata.signerSubject?.includes(expected.signerSubject)) {
    throw new Error(`VC++ Redistributable signer is not Microsoft: ${metadata.signerSubject ?? "missing"}.`);
  }
  if (metadata.signerThumbprint?.toUpperCase() !== expected.signerThumbprint) {
    throw new Error("VC++ Redistributable signer thumbprint does not match the approved artifact.");
  }
  if (metadata.fileVersion !== expected.fileVersion) {
    throw new Error(
      `VC++ Redistributable file version ${metadata.fileVersion ?? "missing"} does not match ${expected.fileVersion}.`,
    );
  }
}

function inspectAuthenticode(filePath, spawn = spawnSync) {
  const escapedPath = filePath.replaceAll("'", "''");
  const script = [
    `$item = Get-Item -LiteralPath '${escapedPath}'`,
    `$signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'`,
    "[ordered]@{",
    "  status = $signature.Status.ToString()",
    "  signerSubject = $signature.SignerCertificate.Subject",
    "  signerThumbprint = $signature.SignerCertificate.Thumbprint",
    "  fileVersion = $item.VersionInfo.FileVersion",
    "} | ConvertTo-Json -Compress",
  ].join("\n");
  const result = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Could not verify VC++ Redistributable Authenticode metadata: ${result.stderr.trim()}`);
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    throw new Error("VC++ Redistributable Authenticode inspection returned invalid JSON.");
  }
}

export function verifyWindowsVcRedist(filePath, options = {}) {
  const expected = options.expected ?? WINDOWS_VC_REDIST_X64;
  const digest = sha256File(filePath);
  if (digest !== expected.sha256) {
    throw new Error(`VC++ Redistributable SHA-256 ${digest} does not match ${expected.sha256}.`);
  }
  const metadata = (options.inspectAuthenticode ?? inspectAuthenticode)(filePath);
  assertVcRedistMetadata(metadata, expected);
  return { digest, ...metadata };
}

async function downloadToFile(url, filePath, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`VC++ Redistributable download failed with HTTP ${response.status}.`);
  }
  writeFileSync(filePath, new Uint8Array(await response.arrayBuffer()));
}

export async function prepareWindowsVcRedist(options = {}) {
  const outputPath = options.outputPath ?? windowsVcRedistOutput;
  if (existsSync(outputPath)) {
    const evidence = verifyWindowsVcRedist(outputPath, options);
    return { outputPath, reused: true, ...evidence };
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.download`;
  rmSync(temporaryPath, { force: true });
  try {
    await downloadToFile(
      (options.expected ?? WINDOWS_VC_REDIST_X64).url,
      temporaryPath,
      options.fetchImpl,
    );
    const evidence = verifyWindowsVcRedist(temporaryPath, options);
    renameSync(temporaryPath, outputPath);
    return { outputPath, reused: false, ...evidence };
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("The Windows x64 VC++ Redistributable must be prepared on Windows x64.");
  }
  const evidence = await prepareWindowsVcRedist();
  console.log(`prepared=${evidence.outputPath}`);
  console.log(`sha256=${evidence.digest}`);
  console.log(`fileVersion=${evidence.fileVersion}`);
  console.log(`reused=${evidence.reused}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
