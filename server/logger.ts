import { promises as fsp } from "fs";
import path from "path";

const LOG_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "gereh-patterner.log");

const writeLine = async (level: "INFO" | "ERROR", message: string) => {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${message}\n`;
  try {
    await fsp.mkdir(LOG_DIR, { recursive: true });
    await fsp.appendFile(LOG_FILE, line, "utf8");
  } catch {
    // swallow logging failures
  }
};

export const logInfo = (message: string) => {
  void writeLine("INFO", message);
  console.log(message);
};

export const logError = (message: string) => {
  void writeLine("ERROR", message);
  console.error(message);
};
