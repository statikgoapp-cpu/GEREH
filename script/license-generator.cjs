"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`);
  return `{${pairs.join(",")}}`;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const [k, v] = token.split("=", 2);
    const key = k.slice(2);
    if (typeof v !== "undefined") {
      args[key] = v;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateIsoDate(value, fieldName) {
  if (!value) return;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    throw new Error(`Invalid ${fieldName}. Use ISO datetime, example: 2027-12-31T23:59:59.000Z`);
  }
}

function runKeygen(args) {
  const outDir = path.resolve(process.cwd(), String(args["out-dir"] || "license-keys"));
  const privatePath = path.join(outDir, "license-private.pem");
  const publicPath = path.join(outDir, "license-public.pem");
  const pair = crypto.generateKeyPairSync("ed25519");
  const privatePem = pair.privateKey.export({ format: "pem", type: "pkcs8" });
  const publicPem = pair.publicKey.export({ format: "pem", type: "spki" });
  ensureDir(outDir);
  fs.writeFileSync(privatePath, privatePem, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(publicPath, publicPem, { encoding: "utf8" });
  console.log(`Key pair generated.
Private key: ${privatePath}
Public key : ${publicPath}

Copy public key to: desktop/assets/license-public.pem
Keep private key secret and offline.`);
}

function parseFeatures(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function buildPayload(args) {
  const customer = String(args.customer || "").trim();
  const deviceHash = String(args["device-hash"] || "").trim().toUpperCase();
  const product = String(args.product || "GEREH").trim();
  const expiresAt = args["expires-at"] ? String(args["expires-at"]).trim() : null;
  const features = parseFeatures(args.features);
  if (!customer) throw new Error("Missing --customer");
  if (!deviceHash || !/^[A-F0-9]{64}$/.test(deviceHash)) {
    throw new Error("Invalid --device-hash. Expected 64-char SHA-256 uppercase hex.");
  }
  if (expiresAt) validateIsoDate(expiresAt, "expires-at");
  return {
    version: 1,
    licenseId: `NPL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
    product,
    customer,
    deviceHash,
    issuedAt: new Date().toISOString(),
    ...(expiresAt ? { expiresAt } : {}),
    ...(features.length > 0 ? { features } : {}),
  };
}

function runSign(args) {
  const privateKeyPath = path.resolve(process.cwd(), String(args["private-key"] || ""));
  if (!privateKeyPath) throw new Error("Missing --private-key");
  if (!fs.existsSync(privateKeyPath)) throw new Error(`Private key not found: ${privateKeyPath}`);
  const outputPath = path.resolve(process.cwd(), String(args.out || "license.npl"));
  const payload = buildPayload(args);
  const privateKey = fs.readFileSync(privateKeyPath, "utf8");
  const payloadText = canonicalize(payload);
  const signature = crypto
    .sign(null, Buffer.from(payloadText, "utf8"), privateKey)
    .toString("base64");
  const envelope = { payload, signature };
  writeJson(outputPath, envelope);
  console.log(`License signed and saved: ${outputPath}`);
}

function runSignFromRequest(args) {
  const requestPath = path.resolve(process.cwd(), String(args.request || ""));
  if (!requestPath) throw new Error("Missing --request");
  if (!fs.existsSync(requestPath)) throw new Error(`Request file not found: ${requestPath}`);
  const request = readJson(requestPath);
  if (!request.deviceHash || !/^[A-F0-9]{64}$/.test(String(request.deviceHash))) {
    throw new Error("Request file missing valid deviceHash.");
  }
  const mapped = {
    ...args,
    "device-hash": String(request.deviceHash).toUpperCase(),
  };
  runSign(mapped);
}

function printHelp() {
  console.log(`Offline License Generator (Ed25519)

Commands:
  keygen
    --out-dir <dir>                        Default: license-keys

  sign
    --private-key <pem path>               Required
    --customer "<name>"                    Required
    --device-hash <64-char sha256 hex>     Required
    --expires-at <iso datetime>            Optional
    --features <f1,f2,f3>                  Optional
    --product "<name>"                     Optional, default GEREH
    --out <file>                           Default: license.npl

  sign-request
    --request <request.json>               Required
    --private-key <pem path>               Required
    --customer "<name>"                    Required
    --expires-at <iso datetime>            Optional
    --features <f1,f2,f3>                  Optional
    --product "<name>"                     Optional
    --out <file>                           Default: license.npl
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = String(args._[0] || "").trim().toLowerCase();
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "keygen") {
    runKeygen(args);
    return;
  }
  if (command === "sign") {
    runSign(args);
    return;
  }
  if (command === "sign-request") {
    runSignFromRequest(args);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
}
