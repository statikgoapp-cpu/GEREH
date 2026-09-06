const { spawnSync } = require("node:child_process");
const path = require("node:path");

const pkg = require(path.resolve(process.cwd(), "package.json"));
const productName = (pkg.build && pkg.build.productName) || pkg.name || "App";
const safeProductName = productName.replace(/[^a-zA-Z0-9._-]+/g, "_");
const version = pkg.version || "0.0.0";
const ts = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const artifactName = `${safeProductName}_Portable_${version}_${ts}.\${ext}`;

const args = [
  "electron-builder",
  "--win",
  "portable",
  `-c.portable.artifactName=${artifactName}`,
];

const result = spawnSync("npx", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}
