"use strict";

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let issuerWindow = null;
let loadedRequest = null;
let loadedPrivateKeyPath = null;

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`);
  return `{${pairs.join(",")}}`;
}

function createWindow() {
  issuerWindow = new BrowserWindow({
    width: 880,
    height: 760,
    minWidth: 840,
    minHeight: 700,
    title: "GEREH License Issuer",
    webPreferences: {
      preload: path.join(__dirname, "license-issuer-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  issuerWindow.removeMenu();
  issuerWindow.loadFile(path.join(__dirname, "license-issuer.html"));
  issuerWindow.on("closed", () => {
    issuerWindow = null;
  });
}

function validateIsoDate(value) {
  if (!value) return true;
  return !Number.isNaN(Date.parse(value));
}

function parseFeatures(value) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function buildPayload(input) {
  const customer = String(input.customer || "").trim();
  const product = String(input.product || "GEREH").trim() || "GEREH";
  let expiresAt = String(input.expiresAt || "").trim();
  const features = parseFeatures(input.features || "");
  if (!loadedRequest || !loadedRequest.deviceHash) {
    throw new Error("Lisans talep dosyasi yuklenmedi.");
  }
  if (!customer) throw new Error("Musteri alani zorunlu.");
  if (!expiresAt) {
    throw new Error("expiresAt zorunlu. Bitis tarihi seciniz.");
  }
  if (!validateIsoDate(expiresAt)) {
    throw new Error("expiresAt gecersiz.");
  }
  // Eğer Z olmayan tarih gelirse (local time), UTC'ye çevir
  if (expiresAt && !expiresAt.endsWith('Z')) {
    try {
      const localDate = new Date(expiresAt);
      expiresAt = localDate.toISOString();
    } catch {
      throw new Error("expiresAt gecersiz tarih formati.");
    }
  }
  const payload = {
    version: 1,
    licenseId: `NPL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
    product,
    customer,
    deviceHash: String(loadedRequest.deviceHash).toUpperCase(),
    issuedAt: new Date().toISOString(),
  };
  if (expiresAt) payload.expiresAt = expiresAt;
  if (features.length > 0) payload.features = features;
  return payload;
}

function signPayload(payload, privateKeyPem) {
  const payloadText = canonicalize(payload);
  return crypto.sign(null, Buffer.from(payloadText, "utf8"), privateKeyPem);
}

function normalizePrivateKeyPem(raw) {
  return String(raw || "").replace(/^\uFEFF/, "").trim();
}

function validatePrivateKeyPem(privateKeyPem) {
  const pem = normalizePrivateKeyPem(privateKeyPem);
  if (!pem.includes("BEGIN PRIVATE KEY")) {
    throw new Error("Secilen dosya PRIVATE KEY degil. license-private.pem secmelisiniz.");
  }
  try {
    crypto.createPrivateKey(pem);
  } catch {
    throw new Error("Private key PEM formati gecersiz veya bozuk.");
  }
  return pem;
}

function toBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildActivationKey(payload, privateKeyPem) {
  const signedBuffer = signPayload(payload, privateKeyPem);
  const payloadPart = toBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signaturePart = toBase64Url(signedBuffer);
  return `NPK1-${payloadPart}.${signaturePart}`;
}

ipcMain.handle("issuer:load-request", async () => {
  const selected = await dialog.showOpenDialog({
    title: "Lisans talep dosyasi sec",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }, { name: "All Files", extensions: ["*"] }],
  });
  if (selected.canceled || selected.filePaths.length === 0) {
    return { ok: false, cancelled: true };
  }
  try {
    const raw = fs.readFileSync(selected.filePaths[0], "utf8");
    const parsed = JSON.parse(raw);
    const deviceHash = String(parsed.deviceHash || "").toUpperCase();
    if (!/^[A-F0-9]{64}$/.test(deviceHash)) {
      return { ok: false, message: "request.json icinde gecerli deviceHash yok." };
    }
    loadedRequest = {
      deviceId: parsed.deviceId || "-",
      deviceHash,
      product: parsed.product || "GEREH",
      appVersion: parsed.appVersion || "-",
      requestedAt: parsed.requestedAt || "-",
      path: selected.filePaths[0],
    };
    return { ok: true, request: loadedRequest };
  } catch {
    return { ok: false, message: "request.json okunamadi." };
  }
});

ipcMain.handle("issuer:pick-private-key", async () => {
  const selected = await dialog.showOpenDialog({
    title: "Private key sec (license-private.pem)",
    properties: ["openFile"],
    filters: [{ name: "PEM", extensions: ["pem"] }, { name: "All Files", extensions: ["*"] }],
  });
  if (selected.canceled || selected.filePaths.length === 0) {
    return { ok: false, cancelled: true };
  }
  try {
    const pemRaw = fs.readFileSync(selected.filePaths[0], "utf8");
    validatePrivateKeyPem(pemRaw);
    loadedPrivateKeyPath = selected.filePaths[0];
    return { ok: true, privateKeyPath: loadedPrivateKeyPath };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Private key dosyasi dogrulanamadi.",
    };
  }
});

ipcMain.handle("issuer:generate-key", async (_event, input) => {
  try {
    if (!loadedRequest) return { ok: false, message: "Once request.json yukleyin." };
    if (!loadedPrivateKeyPath || !fs.existsSync(loadedPrivateKeyPath)) {
      return { ok: false, message: "Once private key secin." };
    }
    const payload = {
      ...buildPayload(input || {}),
      kind: "activation_key",
      keyVersion: 1,
      keyId: crypto.randomBytes(6).toString("hex").toUpperCase(),
    };
    const privateKeyPem = validatePrivateKeyPem(fs.readFileSync(loadedPrivateKeyPath, "utf8"));
    const activationKey = buildActivationKey(payload, privateKeyPem);
    const now = new Date().toISOString().replace(/[:]/g, "-").replace(/\..+$/, "");
    const safeCustomer = String(payload.customer).replace(/[^a-zA-Z0-9-_]+/g, "-");
    const defaultName = `activation-key-${safeCustomer}-${loadedRequest.deviceId || "device"}-${now}.txt`;
    const selected = await dialog.showSaveDialog({
      title: "Aktivasyon key dosyasini kaydet",
      defaultPath: path.join(app.getPath("documents"), defaultName),
      filters: [{ name: "Text", extensions: ["txt"] }, { name: "All Files", extensions: ["*"] }],
    });
    if (selected.canceled || !selected.filePath) {
      return { ok: false, cancelled: true };
    }
    fs.writeFileSync(selected.filePath, activationKey, "utf8");
    return { ok: true, outputPath: selected.filePath, payload, activationKey };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Key olusturulamadi." };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
