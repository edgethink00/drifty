// Tauri wraps Minisign in Base64. Verify both the artifact and trusted comment
// with Node's Ed25519 implementation; a well-shaped .sig is not proof of a key.
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { hashFile } from "./windows-build-artifacts.mjs";

function decode(value, length = null) {
  if (typeof value !== "string" || !value || value.length > 4096 || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) throw new Error("Updater signature contains invalid Base64.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || (length !== null && bytes.length !== length)) throw new Error("Updater signature packet size or encoding differs.");
  return bytes;
}

function lines(value, count) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(decode(value));
  const result = text.replace(/\n$/u, "").split("\n");
  if (result.length !== count || result.some((line) => /[\r\x00]/u.test(line)) || !result[0].startsWith("untrusted comment: ")) throw new Error("Updater signature has an invalid Minisign envelope.");
  return result;
}

export function verifyUpdaterSignatureEnvelope(bytes) {
  const invalid = () => { throw new Error("Invalid Windows updater signature: expected a single-line base64 Minisign envelope."); };
  const decode = (encoded) => {
    if (encoded.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) invalid();
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.toString("base64") !== encoded) invalid();
    return decoded;
  };
  const armored = decode(Buffer.from(bytes).toString("utf8"));
  const text = armored.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(armored)) invalid();
  const lines = text.replace(/\r?\n$/u, "").split(/\r?\n/u);
  if (lines.length !== 4 || !lines[0].startsWith("untrusted comment: ")
    || !lines[2].startsWith("trusted comment: ")
    || !/^[\x20-\x7e\t]*$/u.test(lines[0]) || !/^[\x20-\x7e\t]*$/u.test(lines[2])) invalid();
  const packet = decode(lines[1]);
  if (packet.length !== 74 || (packet[0] !== 0x45 || ![0x44, 0x64].includes(packet[1]))
    || decode(lines[3]).length !== 64) invalid();
  // This checks the envelope, not authenticity. The installed updater verifies
  // both signatures against its pinned public key before installation.
}

export function verifyTauriUpdaterSignature(artifactBytes, signature, publicKey) {
  const keyLines = lines(publicKey, 2), sigLines = lines(signature, 4);
  const key = decode(keyLines[1], 42), packet = decode(sigLines[1], 74), global = decode(sigLines[3], 64);
  if (key.subarray(0, 2).toString() !== "Ed" || packet.subarray(0, 2).toString() !== "ED") throw new Error("Updater signature must use the hashed Minisign format.");
  if (!packet.subarray(2, 10).equals(key.subarray(2, 10))) throw new Error("Updater signature key ID differs from the configured app public key.");
  if (!sigLines[2].startsWith("trusted comment: ")) throw new Error("Updater signature trusted comment is missing.");
  const comment = Buffer.from(sigLines[2].slice("trusted comment: ".length), "utf8");
  const nativeKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]), format: "der", type: "spki" });
  const signatureBytes = packet.subarray(10);
  if (!verify(null, createHash("blake2b512").update(artifactBytes).digest(), nativeKey, signatureBytes)) throw new Error("Updater artifact cryptographic signature is invalid.");
  if (!verify(null, Buffer.concat([signatureBytes, comment]), nativeKey, global)) throw new Error("Updater trusted-comment cryptographic signature is invalid.");
  return { verified: true, algorithm: "Ed25519/Blake2b-512", keyId: key.readBigUInt64LE(2).toString(16).padStart(16, "0").toUpperCase() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const allowed = new Set(["--installer", "--signature", "--expected-sha256", "--config", "--config-sha256"]), a = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const flag = process.argv[i]; if (!allowed.has(flag) || a[flag] || !process.argv[i + 1]) throw new Error("Provide unique pinned updater verification arguments.");
      a[flag] = process.argv[i + 1];
    }
    if (Object.keys(a).length !== allowed.size || !/^[a-f0-9]{64}$/u.test(a["--expected-sha256"] ?? "") || !/^[a-f0-9]{64}$/u.test(a["--config-sha256"] ?? "")) throw new Error("Installer and source configuration pins are required.");
    const artifact = hashFile(a["--installer"]);
    if (artifact.sha256 !== a["--expected-sha256"] || hashFile(a["--config"]).sha256 !== a["--config-sha256"] || statSync(a["--installer"]).size > 512 * 1024 ** 2) throw new Error("Updater installer or source configuration bytes differ.");
    const config = JSON.parse(readFileSync(a["--config"], "utf8"));
    const proof = verifyTauriUpdaterSignature(readFileSync(a["--installer"]), readFileSync(a["--signature"], "utf8"), config.plugins?.updater?.pubkey);
    console.log(JSON.stringify({ ...proof, installer: artifact, signature: hashFile(a["--signature"]) }));
  } catch (error) { console.error(`windows-updater-verification: ${error.message}`); process.exitCode = 1; }
}
