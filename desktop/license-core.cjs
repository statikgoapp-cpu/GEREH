"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { execSync } = require("child_process");

function getLegacyDerivedEncryptionKey(userDataPath) {
  const salt = path.basename(path.dirname(userDataPath)); // Use parent dir name as salt
  const hash = crypto.createHash("sha256");
  hash.update(salt);
  hash.update(process.platform);
  hash.update(process.arch);
  return hash.digest();
}

function resolveMachineBinding() {
  if (process.platform === "win32") {
    try {
      const out = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }
      );
      const line = out
        .split(/\r?\n/)
        .find((v) => v.toLowerCase().includes("machineguid"));
      if (line) {
        const parts = line.trim().split(/\s+/);
        const value = parts[parts.length - 1] || "";
        if (value) return value;
      }
    } catch {}
  }
  try {
    const cpuModel = os.cpus()[0]?.model || "";
    return `${os.hostname()}|${cpuModel}`;
  } catch {
    return os.hostname();
  }
}

// Encryption key derivation - now includes machine-specific binding.
function getDerivedEncryptionKey(userDataPath) {
  const salt = path.basename(path.dirname(userDataPath));
  const machineBinding = resolveMachineBinding();
  const hash = crypto.createHash("sha256");
  hash.update(salt);
  hash.update(process.platform);
  hash.update(process.arch);
  hash.update(machineBinding);
  return hash.digest();
}

// Encrypt JSON data
function encryptJsonData(data, encryptionKey) {
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", encryptionKey, iv);
    const jsonStr = JSON.stringify(data);
    let encrypted = cipher.update(jsonStr, "utf8", "hex");
    encrypted += cipher.final("hex");
    const result = {
      v: 1, // version
      iv: iv.toString("hex"),
      data: encrypted
    };
    return JSON.stringify(result);
  } catch (err) {
    return null;
  }
}

// Decrypt JSON data
function decryptJsonData(encryptedStr, encryptionKey) {
  try {
    const envelope = JSON.parse(encryptedStr);
    if (envelope.v !== 1) return null;
    const iv = Buffer.from(envelope.iv, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", encryptionKey, iv);
    let decrypted = decipher.update(envelope.data, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted);
  } catch (err) {
    return null;
  }
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`);
  return `{${pairs.join(",")}}`;
}

function getLicensePath(userDataPath) {
  return path.join(userDataPath, "license.json");
}

function getLicenseRegistryPath(userDataPath) {
  return path.join(userDataPath, "license-registry.json");
}

function getPublicKeyPath(appPath) {
  return path.join(appPath, "desktop", "assets", "license-public.pem");
}

function readJsonSafe(filePath, fallback, encryptionKey = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (encryptionKey) {
      const decrypted = decryptJsonData(raw, encryptionKey);
      return decrypted || fallback;
    }
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function writeJson(filePath, value, encryptionKey = null) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    let content;
    if (encryptionKey) {
      content = encryptJsonData(value, encryptionKey);
      if (!content) throw new Error("Encryption failed");
    } else {
      content = JSON.stringify(value, null, 2);
    }
    fs.writeFileSync(filePath, content, "utf8");
    // Restrict file permissions to owner only
    fs.chmodSync(filePath, 0o600);
  } catch (err) {
    // Fallback to unencrypted if encryption fails
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
    fs.chmodSync(filePath, 0o600);
  }
}

function readLicenseState(userDataPath) {
  const now = Date.now();
  const filePath = getLicensePath(userDataPath);
  const encryptionKey = getDerivedEncryptionKey(userDataPath);
  let parsed = readJsonSafe(filePath, null, encryptionKey);
  if (!parsed) {
    const legacyKey = getLegacyDerivedEncryptionKey(userDataPath);
    parsed = readJsonSafe(filePath, null, legacyKey);
    if (parsed) {
      // Migration: immediately rewrite with machine-bound key.
      writeJson(filePath, parsed, encryptionKey);
    }
  }
  if (!parsed) {
    const initial = {
      firstRunAt: now,
      activatedAt: null,
      keyHash: null,
      lastOnlineCheckAt: null,
      lastSeenAt: now,
      deviceHash: null,
      licenseId: null,
      blockedReason: null,
      signedLicense: null,
      activationKey: null,
      revokedKeyHashes: [],
      revokedLicenseIds: [],
      revokedSignedSignatures: [],
      failedAttempts: 0,
      blockedUntil: null,
    };
    writeJson(filePath, initial, encryptionKey);
    return initial;
  }
  return {
    firstRunAt: parsed.firstRunAt || now,
    activatedAt: parsed.activatedAt || null,
    keyHash: parsed.keyHash || null,
    lastOnlineCheckAt: parsed.lastOnlineCheckAt || null,
    lastSeenAt: parsed.lastSeenAt || null,
    deviceHash: parsed.deviceHash || null,
    licenseId: parsed.licenseId || null,
    blockedReason: parsed.blockedReason || null,
    signedLicense: parsed.signedLicense || null,
    activationKey: parsed.activationKey || null,
    revokedKeyHashes: Array.isArray(parsed.revokedKeyHashes) ? parsed.revokedKeyHashes : [],
    revokedLicenseIds: Array.isArray(parsed.revokedLicenseIds) ? parsed.revokedLicenseIds : [],
    revokedSignedSignatures: Array.isArray(parsed.revokedSignedSignatures) ? parsed.revokedSignedSignatures : [],
    failedAttempts: parsed.failedAttempts || 0,
    blockedUntil: parsed.blockedUntil || null,
  };
}

function writeLicenseState(userDataPath, state) {
  const encryptionKey = getDerivedEncryptionKey(userDataPath);
  writeJson(getLicensePath(userDataPath), state, encryptionKey);
}

function readLicenseRegistry(userDataPath) {
  return readJsonSafe(getLicenseRegistryPath(userDataPath), {});
}

function writeLicenseRegistry(userDataPath, registry) {
  writeJson(getLicenseRegistryPath(userDataPath), registry);
}

function getTrialInfo(state, trialDays) {
  const ms = trialDays * 24 * 60 * 60 * 1000;  // Convert days to milliseconds
  const end = Number(state.firstRunAt || Date.now()) + ms;
  const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)));
  return { expired: Date.now() > end, daysLeft };
}

function parseLicenseEnvelope(raw) {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw.payload;
  const signature = raw.signature;
  if (!payload || typeof payload !== "object") return null;
  if (typeof signature !== "string" || !signature.trim()) return null;
  return { payload, signature: signature.trim() };
}

function verifySignedLicense(envelope, appPath) {
  const parsed = parseLicenseEnvelope(envelope);
  if (!parsed) return { ok: false, reason: "invalid_file" };
  const publicKeyPath = getPublicKeyPath(appPath);
  if (!fs.existsSync(publicKeyPath)) return { ok: false, reason: "missing_public_key" };
  const publicKey = fs.readFileSync(publicKeyPath, "utf8");
  const payloadText = canonicalize(parsed.payload);
  const signatureBuffer = Buffer.from(parsed.signature, "base64");
  let isValid = false;
  try {
    isValid = crypto.verify(
      null,
      Buffer.from(payloadText, "utf8"),
      publicKey,
      signatureBuffer
    );
  } catch {
    isValid = false;
  }
  if (!isValid) return { ok: false, reason: "bad_signature" };
  return { ok: true, payload: parsed.payload, signature: parsed.signature };
}

function buildLicenseRequest(device, appVersion) {
  return {
    requestVersion: 1,
    product: "GEREH",
    appVersion,
    requestedAt: new Date().toISOString(),
    deviceId: device.publicId,
    deviceHash: device.hash,
  };
}

module.exports = {
  canonicalize,
  getTrialInfo,
  readLicenseState,
  writeLicenseState,
  readLicenseRegistry,
  writeLicenseRegistry,
  verifySignedLicense,
  buildLicenseRequest,
};
