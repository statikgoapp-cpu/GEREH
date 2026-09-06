const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const failures = [];

const mustExist = (rel) => {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) failures.push(`Missing required file: ${rel}`);
};

const mustExistAny = (rels, label) => {
  const ok = rels.some((rel) => fs.existsSync(path.join(root, rel)));
  if (!ok) failures.push(`Missing required file set: ${label} (${rels.join(" | ")})`);
};

const checkCommand = (cmd, label) => {
  try {
    execSync(cmd, { stdio: "ignore" });
  } catch {
    failures.push(`Missing runtime dependency: ${label}`);
  }
};

mustExist("dist/index.cjs");
mustExist("dist/image-worker.cjs");
mustExist("desktop/main.cjs");
mustExist("desktop/preload.cjs");
mustExist("desktop/license-preload.cjs");
mustExist("desktop/license.html");
mustExist("desktop/assets/icon.ico");
mustExist("node_modules/call-bind-apply-helpers/index.js");
mustExist("node_modules/electron/dist/electron.exe");
mustExist("node_modules/better-sqlite3/build/Release/better_sqlite3.node");

if (process.platform === "win32") {
  try {
    execSync("where pdftoppm", { stdio: "ignore" });
  } catch {
    const bundled = path.join(root, "desktop", "bin", "poppler", "pdftoppm.exe");
    if (!fs.existsSync(bundled)) {
      failures.push("pdftoppm not found. Install Poppler or bundle desktop/bin/poppler/pdftoppm.exe");
    }
  }
}

checkCommand("node -v", "Node.js");

if (failures.length) {
  console.error("Desktop preflight failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Desktop preflight passed.");
