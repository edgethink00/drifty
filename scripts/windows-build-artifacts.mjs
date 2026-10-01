import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import path from "node:path";

export function containedPath(root, name) {
  if (typeof name !== "string" || !name || name.includes("\\") || name.includes("\0")
    || name.split("/").some((part) => !part || part === "." || part === "..")
    || path.posix.isAbsolute(name) || /^[A-Za-z]:/u.test(name)) {
    throw new Error("Artifact name must be a relative path without traversal.");
  }
  const canonicalRoot = realpathSync(root);
  const file = realpathSync(path.resolve(canonicalRoot, name));
  const relative = path.relative(canonicalRoot, file);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Artifact resolves outside its candidate directory.");
  }
  return file;
}

export function hashFile(file, { allowEmpty = false } = {}) {
  const fd = openSync(file, "r");
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || (!allowEmpty && before.size === 0)) throw new Error("Artifact must be a nonempty regular file.");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0;
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
      bytes += count;
    }
    const after = fstatSync(fd);
    if (bytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error("Artifact changed while hashing.");
    }
    return { bytes, sha256: hash.digest("hex") };
  } finally { closeSync(fd); }
}

// Compare a signature-stripped fresh tracker copy with its exact signed input.
// Only the PE checksum and certificate directory/table may differ. Reject
// certificates outside EOF and unsigned files that still declare a certificate.
export function authenticodePayload(file, signed) {
  const bytes = readFileSync(file);
  range(bytes, 0, 64);
  const pe = bytes.readUInt32LE(60), optional = pe + 24;
  range(bytes, pe, 24); range(bytes, optional, 152);
  if (bytes.toString("ascii", 0, 2) !== "MZ" || bytes.readUInt32LE(pe) !== 0x4550
    || bytes.readUInt16LE(pe + 4) !== 0x8664 || bytes.readUInt16LE(optional) !== 0x20b) throw new Error("Tracker must be a Windows x64 PE.");
  const directory = optional + 144, start = bytes.readUInt32LE(directory), length = bytes.readUInt32LE(directory + 4);
  if (signed ? start <= directory + 8 || length === 0 || start + length !== bytes.length : start !== 0 || length !== 0) {
    throw new Error("Tracker certificate boundary differs.");
  }
  const payload = Buffer.from(signed ? bytes.subarray(0, start) : bytes);
  payload.fill(0, optional + 64, optional + 68); payload.fill(0, directory, directory + 8);
  return payload;
}

// Tauri CLI 2.10.1 patches this marker before NSIS packaging and restores the
// original build output afterwards. Derive the exact unsigned installed hash;
// never accept an arbitrary difference between compiled and installed bytes.
export function nsisAppPayload(file) {
  const bytes = readFileSync(file);
  peIdentity(bytes);
  const marker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK");
  const offset = bytes.indexOf(marker);
  if (offset < 0 || bytes.indexOf(marker, offset + 1) >= 0) throw new Error("Expected exactly one unpatched Tauri bundle marker.");
  const compiledSha256 = createHash("sha256").update(bytes).digest("hex");
  Buffer.from("__TAURI_BUNDLE_TYPE_VAR_NSS").copy(bytes, offset);
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), compiledSha256,
    bundleMarkerOffset: offset, bundleType: "nsis" };
}

function guid(bytes, offset) {
  return [bytes.readUInt32LE(offset).toString(16).padStart(8, "0"),
    bytes.readUInt16LE(offset + 4).toString(16).padStart(4, "0"),
    bytes.readUInt16LE(offset + 6).toString(16).padStart(4, "0"),
    bytes.subarray(offset + 8, offset + 10).toString("hex"),
    bytes.subarray(offset + 10, offset + 16).toString("hex")].join("-");
}

function range(bytes, offset, length) {
  if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error("Truncated binary metadata.");
  }
}

export function peIdentity(bytes) {
  range(bytes, 0, 64);
  if (bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Missing PE DOS header.");
  const pe = bytes.readUInt32LE(60);
  range(bytes, pe, 24);
  if (bytes.readUInt32LE(pe) !== 0x4550 || bytes.readUInt16LE(pe + 4) !== 0x8664) {
    throw new Error("Expected a Windows x64 PE.");
  }
  const sections = bytes.readUInt16LE(pe + 6);
  const optionalSize = bytes.readUInt16LE(pe + 20);
  const optional = pe + 24;
  range(bytes, optional, optionalSize);
  if (optionalSize < 168 || bytes.readUInt16LE(optional) !== 0x20b || bytes.readUInt32LE(optional + 108) < 7) {
    throw new Error("Missing PE debug directory.");
  }
  const table = optional + optionalSize;
  range(bytes, table, sections * 40);
  function rvaOffset(rva, length) {
    if (rva < bytes.readUInt32LE(optional + 60)) { range(bytes, rva, length); return rva; }
    for (let i = 0; i < sections; i += 1) {
      const entry = table + i * 40;
      const start = bytes.readUInt32LE(entry + 12);
      const size = bytes.readUInt32LE(entry + 16);
      if (rva >= start && rva - start + length <= size) {
        const offset = bytes.readUInt32LE(entry + 20) + rva - start;
        range(bytes, offset, length);
        return offset;
      }
    }
    throw new Error("Unmapped PE debug directory.");
  }
  const directoryRva = bytes.readUInt32LE(optional + 160);
  const directorySize = bytes.readUInt32LE(optional + 164);
  if (!directorySize || directorySize % 28 !== 0) throw new Error("Invalid PE debug directory.");
  const directory = rvaOffset(directoryRva, directorySize);
  const identities = [];
  for (let i = 0; i < directorySize; i += 28) {
    const entry = directory + i;
    if (bytes.readUInt32LE(entry + 12) !== 2) continue;
    const count = bytes.readUInt32LE(entry + 16);
    const data = bytes.readUInt32LE(entry + 24);
    range(bytes, data, count);
    if (count < 24 || bytes.toString("ascii", data, data + 4) !== "RSDS") continue;
    identities.push({ guid: guid(bytes, data + 4), age: bytes.readUInt32LE(data + 20), machine: "x64" });
  }
  if (identities.length !== 1) throw new Error("Expected exactly one RSDS identity.");
  return identities[0];
}

export function pdbIdentity(file) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const readAt = (offset, count) => {
      if (!Number.isSafeInteger(offset) || offset < 0 || count < 0 || offset + count > size) throw new Error("Truncated PDB.");
      const bytes = Buffer.alloc(count);
      let read = 0;
      while (read < count) {
        const n = readSync(fd, bytes, read, count - read, offset + read);
        if (!n) throw new Error("Truncated PDB.");
        read += n;
      }
      return bytes;
    };
    const header = readAt(0, 56);
    if (!header.subarray(0, 32).equals(Buffer.from("Microsoft C/C++ MSF 7.00\r\n\x1aDS\0\0\0", "binary"))) {
      throw new Error("Unsupported PDB format.");
    }
    const blockSize = header.readUInt32LE(32);
    const directorySize = header.readUInt32LE(44);
    const mapBlock = header.readUInt32LE(52);
    if (![512, 1024, 2048, 4096].includes(blockSize) || directorySize < 12 || directorySize > 4 * 1024 * 1024) {
      throw new Error("Invalid PDB directory.");
    }
    const blocks = Math.ceil(directorySize / blockSize);
    if (blocks * 4 > blockSize) throw new Error("Unsupported PDB directory map.");
    const map = readAt(mapBlock * blockSize, blocks * 4);
    const directory = Buffer.alloc(directorySize);
    for (let i = 0; i < blocks; i += 1) {
      readAt(map.readUInt32LE(i * 4) * blockSize, Math.min(blockSize, directorySize - i * blockSize)).copy(directory, i * blockSize);
    }
    const streams = directory.readUInt32LE(0);
    range(directory, 4, streams * 4);
    if (streams < 2) throw new Error("Missing PDB info stream.");
    const size0 = directory.readUInt32LE(4);
    const size1 = directory.readUInt32LE(8);
    if (size1 < 28 || size1 === 0xffffffff) throw new Error("Missing PDB info stream.");
    const stream1 = 4 + streams * 4 + (size0 === 0xffffffff ? 0 : Math.ceil(size0 / blockSize) * 4);
    range(directory, stream1, Math.ceil(size1 / blockSize) * 4);
    const info = readAt(directory.readUInt32LE(stream1) * blockSize, 28);
    return { guid: guid(info, 12), age: info.readUInt32LE(8) };
  } finally { closeSync(fd); }
}

export function verifyPePdb(exe, pdb) {
  const identity = peIdentity(readFileSync(exe));
  const debug = pdbIdentity(pdb);
  if (identity.guid !== debug.guid || identity.age !== debug.age) throw new Error("PE/PDB identity mismatch.");
  return identity;
}
