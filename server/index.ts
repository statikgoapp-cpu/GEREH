import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { logError, logInfo } from "./logger";
// ADIM 1: Yeni eklenen socket-handler'ı import et
import { initSocketIO } from "./socket-handler"; 

const app = express();
const httpServer = createServer(app);

// ADIM 2: Sunucu oluşturulduktan hemen sonra Socket.IO'yu başlat
// Bu, makineyle olan canlı veri hattını kurar.
initSocketIO(httpServer);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Hard gate for backend/API access when desktop license is not active.
// main process flips this flag at runtime.
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== "production") return next();
  const licenseAllowed = process.env.NP_LICENSE_ALLOWED === "1";
  if (licenseAllowed) return next();
  if (req.path === "/api/health") return next();
  if (req.path.startsWith("/api") || req.path.startsWith("/uploads") || req.path.startsWith("/processed")) {
    return res.status(403).json({ ok: false, message: "License required" });
  }
  return next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  logInfo(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  console.log(`GELEN İSTEK: ${req.method} ${req.path}`);
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const logResponse =
          capturedJsonResponse && typeof capturedJsonResponse === "object"
            ? { ...capturedJsonResponse, ...("token" in capturedJsonResponse ? { token: "[redacted]" } : {}) }
            : capturedJsonResponse;
        logLine += ` :: ${JSON.stringify(logResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // registerRoutes fonksiyonu içinde Replit'ten gelen route'ların 
  // eklendiğinden emin olmalısın (Genelde server/routes/index.ts içinde yapılır)
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    logError(`Internal Server Error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "8100", 10);
  const host = process.env.HOST || "0.0.0.0";

  httpServer.listen(port, host, () => {
    log(`serving on http://${host}:${port}`);
  });
})();
