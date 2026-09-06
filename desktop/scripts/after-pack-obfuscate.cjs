"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const DEFAULT_TARGETS = [
  "desktop/main.cjs",
  "desktop/license-core.cjs",
  "desktop/preload.cjs",
  "desktop/license-preload.cjs",
  "dist/index.cjs",
  "dist/image-worker.cjs",
];
const REPACK_UNPACK_GLOB = "{**/*.node,**/*.dll,**/*.so,**/*.dylib,dist/**/*.py,models/**/*,node_modules/@img/**/*,node_modules/sharp/**/*,node_modules/better-sqlite3/**/*,node_modules/onnxruntime-node/**/*,node_modules/serialport/**/*,node_modules/potrace/**/*}";

function sha256Text(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

module.exports = async function afterPack(context) {
  const shouldObfuscate = process.env.NP_ENABLE_OBFUSCATION === "1";

  const appAsarPath = path.join(context.appOutDir, "resources", "app.asar");
  if (!fs.existsSync(appAsarPath)) {
    console.log(`[obfuscate] app.asar not found: ${appAsarPath}`);
    return;
  }

  let asar;
  let JavaScriptObfuscator = null;
  try {
    asar = require("@electron/asar");
    if (shouldObfuscate) {
      const obfuscatorModule = require("javascript-obfuscator");
      JavaScriptObfuscator = obfuscatorModule.default || obfuscatorModule;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`After-pack dependencies missing: ${message}`);
  }

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "np-obf-"));
  const extractedDir = path.join(tempRoot, "app");
  const mapRoot = path.resolve(process.cwd(), ".secrets", "obfuscation-maps", nowStamp());
  await ensureDir(extractedDir);
  await ensureDir(mapRoot);

  const obfuscationOptions = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.6,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.2,
    identifierNamesGenerator: "hexadecimal",
    renameGlobals: false,
    rotateStringArray: true,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 8,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ["base64"],
    stringArrayThreshold: 0.8,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
    sourceMap: true,
    sourceMapMode: "separate",
  };

  const integrity = {
    version: 1,
    generatedAt: new Date().toISOString(),
    files: {},
  };

  try {
    console.log(`[obfuscate] extracting ${appAsarPath}`);
    asar.extractAll(appAsarPath, extractedDir);

    if (shouldObfuscate && JavaScriptObfuscator) {
      for (const rel of DEFAULT_TARGETS) {
        const abs = path.join(extractedDir, rel);
        if (!fs.existsSync(abs)) {
          console.log(`[obfuscate] skip missing: ${rel}`);
          continue;
        }
        const input = await fsp.readFile(abs, "utf8");
        const result = JavaScriptObfuscator.obfuscate(input, {
          ...obfuscationOptions,
          sourceMapFileName: `${path.basename(rel)}.map`,
        });
        await fsp.writeFile(abs, result.getObfuscatedCode(), "utf8");
        const mapText = result.getSourceMap();
        if (mapText) {
          const safeRel = rel.replace(/[\\/]/g, "__");
          await fsp.writeFile(path.join(mapRoot, `${safeRel}.map`), mapText, "utf8");
        }
      }
    } else {
      console.log("[obfuscate] skipped (set NP_ENABLE_OBFUSCATION=1 to enable)");
    }

    // Always build runtime integrity manifest (with or without obfuscation).
    for (const rel of DEFAULT_TARGETS) {
      const abs = path.join(extractedDir, rel);
      if (!fs.existsSync(abs)) continue;
      const content = await fsp.readFile(abs, "utf8");
      integrity.files[rel] = sha256Text(content);
    }
    const manifestPath = path.join(extractedDir, "desktop", "assets", "runtime-integrity.json");
    await ensureDir(path.dirname(manifestPath));
    await fsp.writeFile(manifestPath, JSON.stringify(integrity, null, 2), "utf8");

    console.log(`[obfuscate] repacking ${appAsarPath}`);
    await asar.createPackageWithOptions(extractedDir, appAsarPath, {
      unpack: REPACK_UNPACK_GLOB,
    });
    if (shouldObfuscate) {
      console.log(`[obfuscate] done. source maps stored at: ${mapRoot}`);
    } else {
      console.log("[obfuscate] done. runtime integrity manifest generated.");
    }
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
};
