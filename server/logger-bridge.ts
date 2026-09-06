// server/logger-bridge.ts
import { logInfo, logError } from "./logger";

// Replit'in beklediği logger formatını senin sistemine tercüme ediyoruz
export const logger = {
  info: (obj: any, msg?: string) => {
    const finalMsg = typeof obj === 'string' ? obj : (msg || JSON.stringify(obj));
    logInfo(finalMsg);
  },
  error: (obj: any, msg?: string) => {
    const finalMsg = typeof obj === 'string' ? obj : (msg || JSON.stringify(obj));
    logError(finalMsg);
  },
  warn: (obj: any, msg?: string) => {
    const finalMsg = typeof obj === 'string' ? obj : (msg || JSON.stringify(obj));
    logInfo(`[WARN] ${finalMsg}`);
  }
};