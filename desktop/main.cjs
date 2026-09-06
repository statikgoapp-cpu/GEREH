const { app, BrowserWindow, ipcMain, dialog } = require("electron");
// Some Windows machines/drivers crash the GPU process and cause renderer instability.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");

let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  autoUpdater = null;
}

const path = require("path");
const fs = require("fs");
const http = require("http");
const net = require("net");
const crypto = require("crypto");
const os = require("os");
const { execSync } = require("child_process");
const Module = require("module");
const {
  getTrialInfo,
  readLicenseState,
  readLicenseRegistry,
  writeLicenseRegistry,
  writeLicenseState,
  verifySignedLicense,
  buildLicenseRequest,
} = require("./license-core.cjs");

const PORT = Number(process.env.DESKTOP_PORT || process.env.PORT || 18100);
const TRIAL_DAYS = 0; // Deneme süresi 0 gün olarak belirlendi
const CLOCK_SKEW_TOLERANCE_MS = 2 * 60 * 1000;
const ACTIVATION_KEY_PREFIX = "NPK1-";
const ENFORCE_RUNTIME_LICENSE = true;
const isDev = process.env.NODE_ENV !== "production" && !app.isPackaged;
let mainWindow = null;
let licenseWindow = null;
let splashWindow = null;
let splashShownAt = 0;
let splashCloseTimer = null;
let pendingMainShow = false;
let pendingLicenseShow = false;
let backendStarted = false;

const logPath = () => path.join(app.getPath("userData"), "logs", "desktop.log");
const writeLog = (level, message) => {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  try {
    fs.mkdirSync(path.dirname(logPath()), { recursive: true });
    fs.appendFileSync(logPath(), line, "utf8");
  } catch {}
  if (level === "ERROR") console.error(message);
  else console.log(message);
};

function waitForServer(url, timeoutMs = 45000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Server did not become ready: ${url}`));
          return;
        }
        setTimeout(tick, 500);
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Server did not become ready: ${url}`));
          return;
        }
        setTimeout(tick, 500);
      });
    };
    tick();
  });
}

function isPortInUse(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (value) => {
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch {}
      resolve(value);
    };
    socket.setTimeout(1500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

function ensureRuntimeDirs(baseDir) {
  const dirs = ["uploads", path.join("public", "processed"), "logs"];
  for (const rel of dirs) {
    fs.mkdirSync(path.join(baseDir, rel), { recursive: true });
  }
}

function configurePopplerPath() {
  if (process.env.POPPLER_PATH) return;
  const bundled = path.join(app.getAppPath(), "desktop", "bin", "poppler");
  if (fs.existsSync(path.join(bundled, "pdftoppm.exe"))) {
    process.env.POPPLER_PATH = bundled;
    writeLog("INFO", `Using bundled Poppler: ${bundled}`);
    return;
  }
  writeLog("INFO", "No bundled Poppler found. System pdftoppm will be used.");
}

function configurePythonPath() {
  if (process.env.PYTHON_BIN) return;
  const candidates = [
    path.join(process.resourcesPath || "", "python-runtime", "python.exe"),
    path.join(process.resourcesPath || "", "prereqs", "python-runtime", "python.exe"),
    path.join(app.getAppPath(), "python-runtime", "python.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      process.env.PYTHON_BIN = candidate;
      writeLog("INFO", `Using bundled Python runtime: ${candidate}`);
      return;
    }
  }
  writeLog("INFO", "No bundled Python runtime found. System python will be used.");
}

function configureModuleFallbacks() {
  const appBase = app.getAppPath();
  const fallbackPaths = [
    path.join(appBase, "node_modules"),
    path.join(appBase, "node_modules", "call-bind", "node_modules"),
    path.join(appBase, "node_modules", "get-intrinsic", "node_modules"),
  ];
  const existing = (process.env.NODE_PATH || "")
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter(Boolean);
  const merged = Array.from(new Set([...existing, ...fallbackPaths]));
  process.env.NODE_PATH = merged.join(path.delimiter);
  Module._initPaths();
}

function setEnvIfMissing(key, value) {
  if (!process.env[key] && value) process.env[key] = value;
}

function sha256File(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function verifyRuntimeIntegrity() {
  if (!app.isPackaged) return { ok: true };
  try {
    const manifestPath = path.join(app.getAppPath(), "desktop", "assets", "runtime-integrity.json");
    if (!fs.existsSync(manifestPath)) {
      return { ok: false, message: "Runtime integrity manifest not found." };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const files = manifest?.files && typeof manifest.files === "object" ? manifest.files : null;
    if (!files) {
      return { ok: false, message: "Runtime integrity manifest is invalid." };
    }
    for (const [rel, expectedHash] of Object.entries(files)) {
      const target = path.join(app.getAppPath(), rel);
      if (!fs.existsSync(target)) {
        return { ok: false, message: `Protected file missing: ${rel}` };
      }
      const actualHash = sha256File(target);
      if (String(expectedHash).toLowerCase() !== actualHash.toLowerCase()) {
        return { ok: false, message: `Integrity check failed: ${rel}` };
      }
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Runtime integrity error: ${message}` };
  }
}

function createSplashWindow() {
  if (splashWindow) return true;
  const videoPath = path.join(__dirname, "assets", "intro.mp4");
  const splashHtml = path.join(__dirname, "splash.html");
  if (!fs.existsSync(videoPath) || !fs.existsSync(splashHtml)) return false;
  splashShownAt = Date.now();
  splashWindow = new BrowserWindow({
    width: 960,
    height: 540,
    resizable: false,
    movable: true,
    frame: false,
    show: true,
    backgroundColor: "#000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  splashWindow.loadFile(splashHtml, {
    query: { video: `file://${videoPath.replace(/\\/g, "/")}` },
  });
  splashWindow.on("closed", () => {
    splashWindow = null;
    if (pendingMainShow && mainWindow) {
      pendingMainShow = false;
      mainWindow.show();
    }
    if (pendingLicenseShow && licenseWindow) {
      pendingLicenseShow = false;
      licenseWindow.show();
    }
  });
  return true;
}

function scheduleSplashClose() {
  if (!splashWindow) return;
  if (splashCloseTimer) return;
  const remaining = Math.max(0, 5000 - (Date.now() - splashShownAt));
  splashCloseTimer = setTimeout(() => {
    splashCloseTimer = null;
    if (splashWindow) splashWindow.close();
  }, remaining);
}

function resolveMachineGuid() {
  if (process.platform === "win32") {
    try {
      const out = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }
      );
      const line = out
        .split(/\r?\n/)
        .find((v) => v.toLowerCase().includes("machineguid"));
      if (!line) return null;
      const parts = line.trim().split(/\s+/);
      return parts[parts.length - 1] || null;
    } catch {
      return null;
    }
  } else if (process.platform === "darwin") {
    // macOS: use system_profiler
    try {
      const out = execSync(
        "system_profiler SPHardwareDataType",
        { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }
      );
      const line = out.split(/\r?\n/).find((v) => v.includes("Serial Number"));
      if (line) {
        const parts = line.split(":");
        return parts[parts.length - 1]?.trim() || null;
      }
    } catch {}
  }
  return null;
}

function getDeviceFingerprint() {
  let deviceId = resolveMachineGuid();
  
  // Fallback mechanism for all platforms
  if (!deviceId) {
    try {
      const hostname = os.hostname();
      const cpuModel = os.cpus()[0]?.model || "unknown";
      deviceId = `${hostname}-${cpuModel}`;
    } catch {
      deviceId = "no-device-id";
    }
  }

  const raw = [
    deviceId,
    os.hostname(),
    process.arch,
    process.platform,
    os.platform() === "win32" ? (process.env.PROCESSOR_IDENTIFIER || "") : os.type(),
  ].join("|");
  
  const hash = crypto.createHash("sha256").update(raw).digest("hex").toUpperCase();
  return {
    hash,
    publicId: `NP-HID-${hash.slice(0, 4)}`,
  };
}

function isDateExpired(dateStr) {
  if (!dateStr) return true;
  try {
    const timestamp = Date.parse(dateStr);
    if (isNaN(timestamp)) return true;
    return Date.now() > timestamp;
  } catch {
    return true;
  }
}

function loadLicenseState() {
  return readLicenseState(app.getPath("userData"));
}

function saveLicenseState(state) {
  writeLicenseState(app.getPath("userData"), state);
}

function getAnchorPath() {
  return path.join(app.getPath("appData"), ".gereh-anchor.json");
}

function readAnchorFile() {
  try {
    if (!fs.existsSync(getAnchorPath())) return null;
    const parsed = JSON.parse(fs.readFileSync(getAnchorPath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeAnchorFile(anchor) {
  try {
    fs.mkdirSync(path.dirname(getAnchorPath()), { recursive: true });
    fs.writeFileSync(getAnchorPath(), JSON.stringify(anchor, null, 2), "utf8");
  } catch {}
}

function normalizeFirstRunAnchor(state) {
  const userDataPath = app.getPath("userData");
  const registry = readLicenseRegistry(userDataPath);
  const fileAnchor = readAnchorFile() || {};
  const registryFirstRun = Number(registry.firstRunAt || 0);
  const fileFirstRun = Number(fileAnchor.firstRunAt || 0);
  const stateFirstRun = Number(state.firstRunAt || Date.now());
  const candidates = [registryFirstRun, fileFirstRun, stateFirstRun].filter((v) => Number.isFinite(v) && v > 0);
  const canonicalFirstRunAt = candidates.length > 0 ? Math.min(...candidates) : Date.now();

  state.firstRunAt = canonicalFirstRunAt;
  const installId = String(registry.installId || fileAnchor.installId || state.installId || crypto.randomUUID());
  state.installId = installId;
  writeLicenseRegistry(userDataPath, {
    ...registry,
    firstRunAt: canonicalFirstRunAt,
    installId,
    lastSeenAt: Date.now(),
  });
  writeAnchorFile({
    firstRunAt: canonicalFirstRunAt,
    installId,
    lastSeenAt: Date.now(),
  });
}

function parseSignedLicenseInput(input) {
  if (input && typeof input === "object") return input;
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (fs.existsSync(raw)) {
    try {
      return JSON.parse(fs.readFileSync(raw, "utf8"));
    } catch {
      return null;
    }
  }
  return null;
}

function mapSignedLicenseError(reason) {
  if (reason === "missing_public_key") {
    return "Uygulama public key bulamadı. desktop/assets/license-public.pem eksik.";
  }
  if (reason === "bad_signature") return "Lisans imzası geçersiz.";
  if (reason === "invalid_file") return "Lisans dosya formatı geçersiz.";
  return "Lisans doğrulanamadı.";
}

function fromBase64Url(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  if (pad === 2) return `${normalized}==`;
  if (pad === 3) return `${normalized}=`;
  if (pad === 1) return `${normalized}===`;
  return normalized;
}

function parseActivationKey(input) {
  const raw = String(input || "").trim();
  if (!raw.startsWith(ACTIVATION_KEY_PREFIX)) return null;
  const encoded = raw.slice(ACTIVATION_KEY_PREFIX.length);
  const dot = encoded.indexOf(".");
  if (dot <= 0) return null;
  const payloadPart = encoded.slice(0, dot);
  const signaturePart = encoded.slice(dot + 1);
  if (!payloadPart || !signaturePart) return null;
  try {
    const payloadJson = Buffer.from(fromBase64Url(payloadPart), "base64").toString("utf8");
    const payload = JSON.parse(payloadJson);
    const signature = Buffer.from(fromBase64Url(signaturePart), "base64").toString("base64");
    return { payload, signature, keyText: raw };
  } catch {
    return null;
  }
}

function activationKeyHash(keyText) {
  return crypto.createHash("sha256").update(String(keyText || "").trim()).digest("hex");
}

function signatureHash(signatureText) {
  return crypto.createHash("sha256").update(String(signatureText || "").trim()).digest("hex");
}

function resolveLicenseId(payload, fallbackSignature) {
  const payloadId = String(payload?.licenseId || "").trim();
  if (payloadId) return payloadId;
  if (fallbackSignature) return `LEGACY-${signatureHash(fallbackSignature).slice(0, 24).toUpperCase()}`;
  return null;
}

function isKeyRevoked(state, keyText) {
  const keyHash = activationKeyHash(keyText);
  return Array.isArray(state.revokedKeyHashes) && state.revokedKeyHashes.includes(keyHash);
}

function isLicenseIdRevoked(state, licenseId) {
  if (!licenseId) return false;
  return Array.isArray(state.revokedLicenseIds) && state.revokedLicenseIds.includes(licenseId);
}

function isSignedSignatureRevoked(state, signature) {
  if (!signature) return false;
  const hash = signatureHash(signature);
  return Array.isArray(state.revokedSignedSignatures) && state.revokedSignedSignatures.includes(hash);
}

function evaluateActivationKey(state, device) {
  if (!state.activationKey) return { ok: false, reason: "missing" };
  if (isKeyRevoked(state, state.activationKey)) return { ok: false, reason: "revoked" };
  const parsed = parseActivationKey(state.activationKey);
  if (!parsed) return { ok: false, reason: "invalid_format" };
  const verified = verifySignedLicense(
    { payload: parsed.payload, signature: parsed.signature },
    app.getAppPath()
  );
  if (!verified.ok) return { ok: false, reason: verified.reason };
  const payload = verified.payload;
  const licenseId = resolveLicenseId(payload, verified.signature);
  if (isLicenseIdRevoked(state, licenseId)) return { ok: false, reason: "revoked" };
  if (payload.kind !== "activation_key") return { ok: false, reason: "wrong_kind" };
  if (payload.product !== "GEREH") return { ok: false, reason: "wrong_product" };
  if (String(payload.deviceHash || "").toUpperCase() !== device.hash.toUpperCase()) {
    return { ok: false, reason: "device_mismatch" };
  }
  if (isDateExpired(payload.expiresAt)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}

function activateFromActivationKey(keyText) {
  const device = getDeviceFingerprint();
  const state = loadLicenseState();
  
  // Rate limiting check
  if (state.blockedUntil && Date.now() < state.blockedUntil) {
    const minutesLeft = Math.ceil((state.blockedUntil - Date.now()) / 60000);
    return { ok: false, message: `Çok fazla başarısız deneme. Lütfen ${minutesLeft} dakika sonra tekrar deneyin.` };
  }
  
  if (isKeyRevoked(state, keyText)) {
    return { ok: false, message: "Bu key daha önce deaktif edildi ve tekrar kullanılamaz." };
  }
  const parsed = parseActivationKey(keyText);
  if (!parsed) {
    state.failedAttempts = (state.failedAttempts || 0) + 1;
    if (state.failedAttempts > 5) {
      state.blockedUntil = Date.now() + 15 * 60 * 1000; // 15 minute lockout
      saveLicenseState(state);
      return { ok: false, message: "Çok fazla başarısız deneme. Lütfen 15 dakika sonra tekrar deneyin." };
    }
    saveLicenseState(state);
    return { ok: false, message: "Key formatı geçersiz." };
  }
  const verified = verifySignedLicense(
    { payload: parsed.payload, signature: parsed.signature },
    app.getAppPath()
  );
  if (!verified.ok) {
    state.failedAttempts = (state.failedAttempts || 0) + 1;
    if (state.failedAttempts > 5) {
      state.blockedUntil = Date.now() + 15 * 60 * 1000;
      saveLicenseState(state);
      return { ok: false, message: "Çok fazla başarısız deneme. Lütfen 15 dakika sonra tekrar deneyin." };
    }
    saveLicenseState(state);
    return { ok: false, message: mapSignedLicenseError(verified.reason) };
  }
  const payload = verified.payload;
  const resolvedLicenseId = resolveLicenseId(payload, verified.signature);
  if (isLicenseIdRevoked(state, resolvedLicenseId)) {
    return { ok: false, message: "Bu lisans deaktif edildi ve tekrar kullanılamaz." };
  }
  if (payload.kind !== "activation_key") {
    state.failedAttempts = (state.failedAttempts || 0) + 1;
    if (state.failedAttempts > 5) {
      state.blockedUntil = Date.now() + 15 * 60 * 1000;
      saveLicenseState(state);
      return { ok: false, message: "Çok fazla başarısız deneme. Lütfen 15 dakika sonra tekrar deneyin." };
    }
    saveLicenseState(state);
    return { ok: false, message: "Key tipi geçersiz." };
  }
  if (payload.product !== "GEREH") {
    state.failedAttempts = (state.failedAttempts || 0) + 1;
    if (state.failedAttempts > 5) {
      state.blockedUntil = Date.now() + 15 * 60 * 1000;
      saveLicenseState(state);
      return { ok: false, message: "Çok fazla başarısız deneme. Lütfen 15 dakika sonra tekrar deneyin." };
    }
    saveLicenseState(state);
    return { ok: false, message: "Key ürüne ait değil." };
  }
  if (String(payload.deviceHash || "").toUpperCase() !== device.hash.toUpperCase()) {
    state.failedAttempts = (state.failedAttempts || 0) + 1;
    if (state.failedAttempts > 5) {
      state.blockedUntil = Date.now() + 15 * 60 * 1000;
      saveLicenseState(state);
      return { ok: false, message: "Çok fazla başarısız deneme. Lütfen 15 dakika sonra tekrar deneyin." };
    }
    saveLicenseState(state);
    return { ok: false, message: "Bu key bu cihaza ait degil." };
  }
  if (isDateExpired(payload.expiresAt)) {
    state.failedAttempts = (state.failedAttempts || 0) + 1;
    if (state.failedAttempts > 5) {
      state.blockedUntil = Date.now() + 15 * 60 * 1000;
      saveLicenseState(state);
      return { ok: false, message: "Çok fazla başarısız deneme. Lütfen 15 dakika sonra tekrar deneyin." };
    }
    saveLicenseState(state);
    return { ok: false, message: "Key süresi dolmuş." };
  }
  
  // Success - reset failed attempts and unlock
  const nowTs = Date.now();
  state.activatedAt = nowTs;
  state.lastOnlineCheckAt = nowTs;
  state.lastSeenAt = nowTs;
  state.deviceHash = device.hash;
  state.blockedReason = null;
  state.keyHash = activationKeyHash(keyText);
  state.activationKey = String(keyText).trim();
  state.licenseId = resolvedLicenseId;
  state.signedLicense = null;
  state.failedAttempts = 0;
  state.blockedUntil = null;
  saveLicenseState(state);
  return { ok: true, message: "Key ile lisans aktif edildi." };
}

function evaluateSignedLicense(state, device) {
  if (!state.signedLicense) return { ok: false, reason: "missing" };
  if (isSignedSignatureRevoked(state, state.signedLicense.signature)) return { ok: false, reason: "revoked" };
  const verified = verifySignedLicense(state.signedLicense, app.getAppPath());
  if (!verified.ok) return { ok: false, reason: verified.reason };
  const payload = verified.payload;
  const licenseId = resolveLicenseId(payload, verified.signature);
  if (isLicenseIdRevoked(state, licenseId)) return { ok: false, reason: "revoked" };
  if (payload.product !== "GEREH") return { ok: false, reason: "wrong_product" };
  if (payload.deviceHash && String(payload.deviceHash).toUpperCase() !== device.hash.toUpperCase()) {
    return { ok: false, reason: "device_mismatch" };
  }
  if (payload.notBefore) {
    const notBefore = new Date(payload.notBefore).getTime();
    if (!isNaN(notBefore) && Date.now() < notBefore) {
      return { ok: false, reason: "not_started" };
    }
  }
  if (isDateExpired(payload.expiresAt)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}

function activateFromSignedLicense(envelope) {
  const device = getDeviceFingerprint();
  const state = loadLicenseState();
  const verified = verifySignedLicense(envelope, app.getAppPath());
  if (!verified.ok) return { ok: false, message: mapSignedLicenseError(verified.reason) };
  const payload = verified.payload;
  const resolvedLicenseId = resolveLicenseId(payload, verified.signature);
  if (isSignedSignatureRevoked(state, verified.signature) || isLicenseIdRevoked(state, resolvedLicenseId)) {
    return { ok: false, message: "Bu lisans deaktif edildi ve tekrar kullanılamaz." };
  }
  if (payload.product !== "GEREH") return { ok: false, message: "Lisans ürüne ait değil." };
  if (payload.deviceHash && String(payload.deviceHash).toUpperCase() !== device.hash.toUpperCase()) {
    return { ok: false, message: "Bu lisans bu cihaza ait değil." };
  }
  if (isDateExpired(payload.expiresAt)) {
    return { ok: false, message: "Lisans süresi dolmuş." };
  }
  const nowTs = Date.now();
  state.activatedAt = nowTs;
  state.lastOnlineCheckAt = nowTs;
  state.lastSeenAt = nowTs;
  state.deviceHash = device.hash;
  state.blockedReason = null;
  state.keyHash = null;
  state.licenseId = resolvedLicenseId;
  state.signedLicense = { payload, signature: verified.signature };
  state.activationKey = null;
  saveLicenseState(state);
  return { ok: true, message: "İmzalı lisans aktif edildi." };
}

function markClockSkewIfNeeded(state, nowTs) {
  if (!state.lastSeenAt) return false;
  if (Math.abs(nowTs - state.lastSeenAt) > CLOCK_SKEW_TOLERANCE_MS) {
    state.blockedReason = "clock_tamper";
    return true;
  }
  return false;
}

function createLicenseWindow() {
  if (licenseWindow) return;
  const device = getDeviceFingerprint();
  const state = loadLicenseState();
  const trial = getTrialInfo(state, TRIAL_DAYS);
  const deferShow = Boolean(splashWindow);
  licenseWindow = new BrowserWindow({
    width: 740,
    height: 700,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: "GEREH License Activation",
    show: !deferShow,
    webPreferences: {
      preload: path.join(__dirname, "license-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  licenseWindow.removeMenu();
  licenseWindow.loadFile(path.join(__dirname, "license.html"));
  licenseWindow.webContents.once("did-finish-load", () => {
    licenseWindow?.webContents.send("desktop:license-context", {
      deviceId: device.publicId,
      trialExpired: trial.expired,
      trialDaysLeft: trial.daysLeft,
      blockedReason: state.blockedReason,
    });
  });
  licenseWindow.on("closed", () => {
    licenseWindow = null;
  });
  if (deferShow) {
    pendingLicenseShow = true;
    scheduleSplashClose();
  }
}

async function ensureLicenseReady() {
  if (isDev) return true;
  const device = getDeviceFingerprint();
  const state = loadLicenseState();
  normalizeFirstRunAnchor(state);
  const nowTs = Date.now();
  const tampered = markClockSkewIfNeeded(state, nowTs);
  state.lastSeenAt = nowTs;
  saveLicenseState(state);
  if (tampered) {
    createLicenseWindow();
    return false;
  }
  if (state.activatedAt && state.deviceHash === device.hash && !state.blockedReason) {
    if (state.signedLicense) {
      const signed = evaluateSignedLicense(state, device);
      if (signed.ok) return true;
    }
    if (state.activationKey) {
      const keyCheck = evaluateActivationKey(state, device);
      if (keyCheck.ok) return true;
    }
  }
  const trial = getTrialInfo(state, TRIAL_DAYS);
  if (!trial.expired) return true;
  createLicenseWindow();
  return false;
}

async function startBackendIfNeeded() {
  if (backendStarted) return;
  if (isDev) return;
  const alreadyUsed = await isPortInUse(PORT);
  if (alreadyUsed) {
    writeLog("INFO", `Port ${PORT} is already in use. Reusing existing backend.`);
    await waitForServer(`http://127.0.0.1:${PORT}`);
    backendStarted = true;
    return;
  }
  const userDataDir = app.getPath("userData");
  ensureRuntimeDirs(userDataDir);
  process.chdir(userDataDir);
  process.env.NODE_ENV = "production";
  process.env.PORT = String(PORT);
  configurePopplerPath();
  configurePythonPath();
  configureModuleFallbacks();
  const serverEntry = path.join(app.getAppPath(), "dist", "index.cjs");
  require(serverEntry);
  await waitForServer(`http://127.0.0.1:${PORT}`);
  backendStarted = true;
}

function setupAutoUpdater() {
  if (isDev || !autoUpdater) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on("checking-for-update", () => writeLog("INFO", "Updater: checking"));
  autoUpdater.on("update-available", (info) => {
    writeLog("INFO", `Updater: available ${info.version}`);
    mainWindow?.webContents.send("desktop:update-status", { state: "available", version: info.version });
  });
  autoUpdater.on("update-not-available", () => {
    writeLog("INFO", "Updater: not available");
    mainWindow?.webContents.send("desktop:update-status", { state: "none" });
  });
  autoUpdater.on("error", (err) => writeLog("ERROR", `Updater: ${err.message}`));
  autoUpdater.on("download-progress", (p) => {
    mainWindow?.webContents.send("desktop:update-status", { state: "downloading", percent: p.percent });
  });
  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("desktop:update-status", { state: "downloaded" });
  });
  setTimeout(() => autoUpdater.checkForUpdates().catch((e) => writeLog("ERROR", e.message)), 8000);
}

function createMainWindow() {
  const deferShow = Boolean(splashWindow);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0b1220",
    icon: path.join(__dirname, "assets", "icon.ico"),
    show: !deferShow,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const startUrl = isDev
    ? process.env.DESKTOP_START_URL || `http://127.0.0.1:${PORT}`
    : `http://127.0.0.1:${PORT}`;
  mainWindow.loadURL(startUrl);
  if (deferShow) {
    pendingMainShow = true;
    mainWindow.once("ready-to-show", () => scheduleSplashClose());
  }
}

async function forceLicenseLock(message) {
  process.env.NP_LICENSE_ALLOWED = "0";
  if (mainWindow) {
    try {
      await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Lisans Dogrulamasi",
        message: "Lisans dogrulamasi basarisiz.",
        detail: message || "Lütfen lisansınızı yeniden etkinleştirin.",
        buttons: ["Lisans Ekranına Git"],
      });
    } catch {}
    mainWindow.close();
    mainWindow = null;
  }
  createLicenseWindow();
}

ipcMain.handle("desktop:license-status", async () => {
  const state = loadLicenseState();
  const device = getDeviceFingerprint();
  const trial = getTrialInfo(state, TRIAL_DAYS);
  const signedCheck = state.signedLicense ? evaluateSignedLicense(state, device) : { ok: false };
  const keyCheck = state.activationKey ? evaluateActivationKey(state, device) : { ok: false };
  return {
    activated: Boolean(state.activatedAt) && (signedCheck.ok || keyCheck.ok),
    signedLicenseActive: signedCheck.ok,
    activationKeyActive: keyCheck.ok,
    trialDaysLeft: trial.daysLeft,
    trialExpired: trial.expired,
    deviceId: device.publicId,
    hasSignedLicense: Boolean(state.signedLicense),
    blockedReason: state.blockedReason,
  };
});

ipcMain.handle("desktop:activate-license", async (_event, key) => {
  const envelope = parseSignedLicenseInput(key);
  let result = null;
  if (envelope) {
    result = activateFromSignedLicense(envelope);
  } else {
    const activationKey = String(key || "").trim();
    if (!activationKey) {
      return { ok: false, message: "Lütfen lisans key girin." };
    }
    result = activateFromActivationKey(activationKey);
  }
  if (result.ok) {
    process.env.NP_LICENSE_ALLOWED = "1";
    await startBackendIfNeeded();
    licenseWindow?.close();
    if (!mainWindow) createMainWindow();
  }
  return result;
});

ipcMain.handle("desktop:import-license-file", async () => {
  const selected = await dialog.showOpenDialog({
    title: "Lisans dosyasi sec",
    properties: ["openFile"],
    filters: [
      { name: "License Files", extensions: ["json", "npl"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (selected.canceled || selected.filePaths.length === 0) {
    return { ok: false, cancelled: true, message: "İŞlem iptal edildi." };
  }
  try {
    const envelope = JSON.parse(fs.readFileSync(selected.filePaths[0], "utf8"));
    const result = activateFromSignedLicense(envelope);
    if (result.ok) {
      process.env.NP_LICENSE_ALLOWED = "1";
      await startBackendIfNeeded();
      licenseWindow?.close();
      if (!mainWindow) createMainWindow();
    }
    return result;
  } catch {
    return { ok: false, message: "Lisans dosyası okunamadı." };
  }
});

function findLicenseFilesInDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (ext !== ".npl" && ext !== ".json") continue;
    out.push(path.join(dirPath, entry.name));
  }
  return out;
}

function getExternalDriveRoots() {
  if (process.platform !== "win32") return [];
  const roots = [];
  for (let code = 68; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    const root = `${letter}:\\`;
    if (fs.existsSync(root)) roots.push(root);
  }
  return roots;
}

function discoverUsbLicenseCandidates() {
  const roots = getExternalDriveRoots();
  const targetDirs = ["", "license", "licenses", "activation", "gereh"];
  const candidates = [];
  for (const root of roots) {
    for (const rel of targetDirs) {
      const fullDir = rel ? path.join(root, rel) : root;
      const files = findLicenseFilesInDirectory(fullDir);
      for (const filePath of files) candidates.push(filePath);
    }
  }
  candidates.sort((a, b) => {
    const aScore = /license|lisans|activation|gereh/i.test(path.basename(a)) ? 0 : 1;
    const bScore = /license|lisans|activation|gereh/i.test(path.basename(b)) ? 0 : 1;
    return aScore - bScore;
  });
  return Array.from(new Set(candidates));
}

ipcMain.handle("desktop:auto-import-license", async () => {
  const candidates = discoverUsbLicenseCandidates();
  if (candidates.length === 0) {
    return { ok: false, message: "USB'de lisans dosyası bulunamadı." };
  }
  let lastError = null;
  for (const filePath of candidates) {
    try {
      const envelope = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const result = activateFromSignedLicense(envelope);
      if (result.ok) {
        process.env.NP_LICENSE_ALLOWED = "1";
        await startBackendIfNeeded();
        licenseWindow?.close();
        if (!mainWindow) createMainWindow();
        return { ok: true, message: `Lisans bulundu ve yüklendi: ${filePath}` };
      }
      lastError = result.message || "Geçersiz lisans";
    } catch {
      lastError = "Dosya okunamadı";
    }
  }
  return {
    ok: false,
    message: `USB'de dosya bulundu ama dogrulanamadı. Son hata: ${lastError || "Bilinmeyen hata"}`,
  };
});

ipcMain.handle("desktop:export-license-request", async () => {
  const device = getDeviceFingerprint();
  const requestPayload = buildLicenseRequest(device, app.getVersion());
  const now = new Date().toISOString().replace(/[:]/g, "-").replace(/\..+$/, "");
  const suggested = `license-request-${device.publicId}-${now}.json`;
  const selected = await dialog.showSaveDialog({
    title: "Lisans talep dosyasini kaydet",
    defaultPath: path.join(app.getPath("documents"), suggested),
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (selected.canceled || !selected.filePath) {
    return { ok: false, cancelled: true, message: "İşlem iptal edildi." };
  }
  try {
    fs.writeFileSync(selected.filePath, JSON.stringify(requestPayload, null, 2), "utf8");
    return { ok: true, message: "Lisans talep dosyası dışa aktarıldı.", path: selected.filePath };
  } catch {
    return { ok: false, message: "Lisans talep dosyası kaydedilemedi." };
  }
});

ipcMain.handle("desktop:export-active-license", async () => {
  const state = loadLicenseState();
  if (!state.signedLicense) {
    return { ok: false, message: "Aktif imzalı lisans bulunamadı." };
  }
  const device = getDeviceFingerprint();
  const now = new Date().toISOString().replace(/[:]/g, "-").replace(/\..+$/, "");
  const suggested = `license-${device.publicId}-${now}.npl`;
  const selected = await dialog.showSaveDialog({
    title: "Aktif lisansı dışa aktar",
    defaultPath: path.join(app.getPath("documents"), suggested),
    filters: [
      { name: "License Files", extensions: ["npl", "json"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (selected.canceled || !selected.filePath) {
    return { ok: false, cancelled: true, message: "İşlem iptal edildi." };
  }
  try {
    fs.writeFileSync(selected.filePath, JSON.stringify(state.signedLicense, null, 2), "utf8");
    return { ok: true, message: "Aktif lisans dışa aktarıldı.", path: selected.filePath };
  } catch {
    return { ok: false, message: "Lisans dosyası kaydedilemedi." };
  }
});

ipcMain.handle("desktop:deactivate-license", async () => {
  const state = loadLicenseState();
  const nowTs = Date.now();
  state.activatedAt = null;
  state.keyHash = null;
  state.lastOnlineCheckAt = nowTs;
  state.lastSeenAt = nowTs;
  state.deviceHash = null;
  state.blockedReason = null;
  state.signedLicense = null;
  if (state.activationKey) {
    const keyHash = activationKeyHash(state.activationKey);
    const list = Array.isArray(state.revokedKeyHashes) ? state.revokedKeyHashes : [];
    if (!list.includes(keyHash)) list.push(keyHash);
    state.revokedKeyHashes = list;
  }
  if (state.licenseId) {
    const revokedIds = Array.isArray(state.revokedLicenseIds) ? state.revokedLicenseIds : [];
    if (!revokedIds.includes(state.licenseId)) revokedIds.push(state.licenseId);
    state.revokedLicenseIds = revokedIds;
  }
  if (state.signedLicense?.signature) {
    const revokedSignatures = Array.isArray(state.revokedSignedSignatures) ? state.revokedSignedSignatures : [];
    const sigHash = signatureHash(state.signedLicense.signature);
    if (!revokedSignatures.includes(sigHash)) revokedSignatures.push(sigHash);
    state.revokedSignedSignatures = revokedSignatures;
  }
  state.activationKey = null;
  state.licenseId = null;
  saveLicenseState(state);
  process.env.NP_LICENSE_ALLOWED = "0";
  if (mainWindow) {
    mainWindow.close();
    mainWindow = null;
  }
  createLicenseWindow();
  return { ok: true };
});

ipcMain.handle("desktop:check-updates", async () => {
  if (!autoUpdater) return { ok: false, message: "Updater module is not installed." };
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Update error" };
  }
});

process.on("uncaughtException", (err) => {
  writeLog("ERROR", `uncaughtException: ${err.stack || err.message}`);
  const { dialog } = require('electron');
  dialog.showErrorBox('Main Process Hatası', err.message || String(err));
});
process.on("unhandledRejection", (reason) => {
  writeLog("ERROR", `unhandledRejection: ${String(reason)}`);
});

app.whenReady().then(async () => {
  try {
    const integrity = verifyRuntimeIntegrity();
    if (!integrity.ok) {
      await dialog.showMessageBox({
        type: "error",
        title: "GEREH",
        message: "Uygulama dosya bütünlüğü dogrulanamadı.",
        detail: integrity.message || "Integrity check failed.",
      });
      app.quit();
      return;
    }
    createSplashWindow();
    const allowed = await ensureLicenseReady();
    process.env.NP_LICENSE_ALLOWED = allowed ? "1" : "0";
    if (allowed) {
      await startBackendIfNeeded();
      if (isDev) {
        await waitForServer(process.env.DESKTOP_START_URL || `http://127.0.0.1:${PORT}`);
      }
      createMainWindow();
    }
    setupAutoUpdater();
  } catch (err) {
    const message = err instanceof Error ?err.message : String(err);
    writeLog("ERROR", `Startup failed: ${message}`);
    await dialog.showMessageBox({
      type: "error",
      title: "GEREH",
      message: "Uygulama başlatılamadı.",
      detail: message,
    });
    app.quit();
  }

 // Her 1 dakikada bir arka planda lisans ve süre kontrolü yap
  setInterval(async () => {
    const state = loadLicenseState();
    const device = getDeviceFingerprint();
    
    // Eğer kullanıcı zaten lisans aktif etmişse süre kontrolüne gerek yok
    const isLicensed = state.activatedAt && state.deviceHash === device.hash && !state.blockedReason;
    if (ENFORCE_RUNTIME_LICENSE && process.env.NODE_ENV === "production" && isLicensed) {
      if (state.signedLicense) {
        const signed = evaluateSignedLicense(state, device);
        if (!signed.ok) {
          await forceLicenseLock(signed.reason === "expired" ? "Lisans süresi doldu." : "Aktif lisans dogrulanamadı.");
          return;
        }
      } else if (state.activationKey) {
        const keyCheck = evaluateActivationKey(state, device);
        if (!keyCheck.ok) {
          await forceLicenseLock(keyCheck.reason === "expired" ? "Lisans süresi doldu." : "Aktif lisans dogrulanamadı.");
          return;
        }
      }
      return;
    }

    // Deneme süresini kontrol et
    const trial = getTrialInfo(state, TRIAL_DAYS);
    
    if (trial.expired && mainWindow) {
      process.env.NP_LICENSE_ALLOWED = "0";
      // 1. Kullanıcıya uyarı göster
      await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Deneme Süresi Doldu",
        message: "GEREH deneme süreniz sona erdi.",
        detail: "Uygulamayı kullanmaya devam etmek için lütfen bir lisans anahtarı edinin.",
        buttons: ["Lisans Ekranına Git"]
      });

      // 2. Ana pencereyi kapat ve lisans ekranını aç
      mainWindow.close();
      mainWindow = null;
      createLicenseWindow();
    }
  }, 60 * 1000); // 60000 ms = 1 dakika

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  try {
    const state = loadLicenseState();
    state.lastSeenAt = Date.now();
    saveLicenseState(state);
  } catch {}
});





