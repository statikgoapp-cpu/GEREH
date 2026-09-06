const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function tryExec(command) {
  try {
    execSync(command, { stdio: "ignore" });
  } catch {
    // Ignore "process not found" and permission mismatches.
  }
}

function run(command) {
  return execSync(command, { encoding: "utf8" }).trim();
}

function listGEREHProcesses() {
  if (process.platform !== "win32") return [];
  try {
    const output = run(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $_.ProcessName -like \'GEREH*\' } | Select-Object -ExpandProperty ProcessName"'
    );
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function stopRunningDesktopProcesses() {
  if (process.platform !== "win32") return;

  // Kill any running packaged app before electron-builder writes a new portable artifact.
  tryExec(
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $_.ProcessName -like \'GEREH*\' } | Stop-Process -Force"'
  );

  const stillRunning = listGEREHProcesses();
  if (stillRunning.length > 0) {
    throw new Error(
      `GEREH is still running (${stillRunning.join(", ")}). ` +
        "Close all running app instances (and if needed, close them from an elevated Task Manager), then rerun desktop:test-exe."
    );
  }
}

function cleanupPortableArtifacts() {
  const releaseDir = path.resolve(process.cwd(), "release");
  if (!fs.existsSync(releaseDir)) return;

  for (const fileName of fs.readdirSync(releaseDir)) {
    if (!/^GEREH_Portable_.*\.exe$/i.test(fileName)) continue;
    try {
      fs.rmSync(path.join(releaseDir, fileName), { force: true });
    } catch {
      // Ignore file locks here; builder will retry if scanner still holds a lock.
    }
  }

  const remaining = fs
    .readdirSync(releaseDir)
    .filter((fileName) => /^GEREH_Portable_.*\.exe$/i.test(fileName));

  if (remaining.length > 0) {
    throw new Error(
      `Portable artifact is still locked (${remaining.join(", ")}). ` +
        "Close the running portable EXE or antivirus lock, then rerun desktop:test-exe."
    );
  }
}

stopRunningDesktopProcesses();
cleanupPortableArtifacts();
console.log("Desktop cleanup complete.");
