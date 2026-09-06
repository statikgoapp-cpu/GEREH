import type { Express } from "express";
import type { Server } from "http";
import path from "path";
import { createRequire } from "module";
import express from "express";
import multer from "multer";
import { Worker } from "worker_threads";
import os from "os";
import sharp from "sharp";
import { existsSync, mkdirSync } from "fs";
import { promises as fsp } from "fs";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { logError, logInfo } from "./logger";
import machineRouter from "./machine-routes";
import { authRouter, authenticateToken } from "./auth";



const UPLOAD_DIR = "uploads";
const PROCESSED_DIR = "public/processed";
const WORKER_MODULE_DIR = typeof __dirname !== "undefined" ? __dirname : process.cwd();
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/avif",
  "image/heic",
  "image/heif",
]);
const ALLOWED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".tiff",
  ".tif",
  ".avif",
  ".heic",
  ".heif",
]);

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
if (!existsSync(PROCESSED_DIR)) mkdirSync(PROCESSED_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: {
    fieldSize: 50 * 1024 * 1024,
    fields: 32,
    fileSize: 200 * 1024 * 1024,
  },
});

type ProcessOptions = {
  targetVectorDiameterMm?: number | null;
  normalizeStones?: boolean;
  pdfDpi?: number | null;
  threshold?: number;
  stoneSensitivity?: number;
  realWidthMm?: number | null;
  useControlNet?: boolean;
  calibrationDiameterPx?: number | null;
  calibrationDiameterMm?: number | null;
  spacingToleranceMm?: number | null;
  autoPrecision?: boolean;
  patternRegions?: Array<{ x: number; y: number; w: number; h: number }>;
  rhinestoneRegions?: Array<{ x: number; y: number; w: number; h: number }>;
  rhinestoneSizeCodes?: string[];
};

type WorkerSuccess = {
  ok: true;
  svgUrl: string;
  dxfUrl: string;
  reportUrl?: string;
};

type WorkerFailure = {
  ok: false;
  stage: string;
  message: string;
};

const toNumber = (value: unknown, fallback: number | null = null) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ?parsed : fallback;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isPdfUploadFile = (file: Pick<Express.Multer.File, "mimetype" | "originalname">) => {
  const mime = String(file.mimetype || "").toLowerCase();
  const ext = path.extname(file.originalname || "").toLowerCase();
  return mime === "application/pdf" || ext === ".pdf";
};

const isAllowedUploadFile = (file: Express.Multer.File) => {
  const mime = String(file.mimetype || "").toLowerCase();
  const ext = path.extname(file.originalname || "").toLowerCase();
  const isPdf = isPdfUploadFile(file);
  const isImage = ALLOWED_IMAGE_TYPES.has(mime) || ALLOWED_IMAGE_EXTENSIONS.has(ext);
  return isPdf || isImage;
};

const convertUploadedImageToPng = async (file: Express.Multer.File) => {
  const sourcePath = file.path;
  const sourceBaseName = path.parse(file.filename).name;
  const normalizedFileName = `${sourceBaseName}-normalized.png`;
  const normalizedPath = path.join(path.dirname(sourcePath), normalizedFileName);

  await sharp(sourcePath, { limitInputPixels: false })
    .rotate()
    .png({ compressionLevel: 1, adaptiveFiltering: false })
    .toFile(normalizedPath);

  if (normalizedPath !== sourcePath) {
    await fsp.unlink(sourcePath).catch(() => {});
  }

  return {
    inputPath: normalizedPath,
    imageUrl: `/uploads/${normalizedFileName}`,
  };
};

const configurePdfModuleFallbacks = () => {
  const runtimeRequire: NodeRequire =
    typeof require !== "undefined" ?require : createRequire(__filename);
  const Module = runtimeRequire("module") as { _initPaths: () => void };
  const appBase = path.resolve(WORKER_MODULE_DIR, "..");
  const fallbackPaths = [
    path.join(appBase, "node_modules"),
    path.join(appBase, "node_modules", "call-bind", "node_modules"),
    path.join(appBase, "node_modules", "get-intrinsic", "node_modules"),
  ];
  const existing = (process.env.NODE_PATH || "")
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter(Boolean);
  process.env.NODE_PATH = Array.from(new Set([...existing, ...fallbackPaths])).join(path.delimiter);
  Module._initPaths();
  return runtimeRequire;
};

const parseRegions = (value: unknown): Array<{ x: number; y: number; w: number; h: number }> => {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        x: Number(item?.x),
        y: Number(item?.y),
        w: Number(item?.w),
        h: Number(item?.h),
      }))
      .filter((item) =>
        Number.isFinite(item.x) &&
        Number.isFinite(item.y) &&
        Number.isFinite(item.w) &&
        Number.isFinite(item.h) &&
        item.w > 0 &&
        item.h > 0
      )
      .map((item) => ({
        x: Math.max(0, Math.min(1, item.x)),
        y: Math.max(0, Math.min(1, item.y)),
        w: Math.max(0, Math.min(1, item.w)),
        h: Math.max(0, Math.min(1, item.h)),
      }));
  } catch {
    return [];
  }
};

const parseStringArray = (value: unknown): string[] => {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item ?? "").trim().toUpperCase())
      .filter((item) => item.length > 0);
  } catch {
    return [];
  }
};

const getSvgPageSize = (svg: string) => {
  const viewBoxMatch = svg.match(/viewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
  if (viewBoxMatch) {
    const vw = Number(viewBoxMatch[1]);
    const vh = Number(viewBoxMatch[2]);
    if (Number.isFinite(vw) && Number.isFinite(vh) && vw > 0 && vh > 0) {
      return { width: vw, height: vh };
    }
  }
  const widthMatch = svg.match(/width=["']([-\d.]+)/i);
  const heightMatch = svg.match(/height=["']([-\d.]+)/i);
  const width = Number(widthMatch?.[1] ??"800");
  const height = Number(heightMatch?.[1] ??"800");
  return {
    width: Number.isFinite(width) && width > 0 ?width : 800,
    height: Number.isFinite(height) && height > 0 ?height : 800,
  };
};

const renderSvgToPdfBuffer = (svg: string) =>
  new Promise<Buffer>((resolve, reject) => {
    try {
      const runtimeRequire = configurePdfModuleFallbacks();
      const PDFDocument = runtimeRequire("pdfkit");
      const svgToPdf = runtimeRequire("svg-to-pdfkit");
      const { width, height } = getSvgPageSize(svg);
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: [Math.max(64, width), Math.max(64, height)],
        margin: 0,
      });
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      svgToPdf(doc, svg, 0, 0, { assumePt: true });
      doc.end();
    } catch (error) {
      reject(error);
    }
  });

const MAX_WORKERS = Math.max(1, Math.min(4, os.cpus().length - 1));
let activeWorkers = 0;
const jobQueue: Array<() => Promise<void>> = [];

const resolveWorkerConfig = () => {
  const isProd = process.env.NODE_ENV === "production";
  const devBuiltWorkerPath = path.resolve(process.cwd(), "dist", "image-worker.cjs");
  return {
    isProd,
    workerPath: isProd
      ?path.resolve(WORKER_MODULE_DIR, "image-worker.cjs")
      : devBuiltWorkerPath,
    execArgv: isProd ?undefined : ["-r", "tsx/cjs"],
    type: undefined,
  };
};

const runNextJob = () => {
  if (activeWorkers >= MAX_WORKERS) return;
  const next = jobQueue.shift();
  if (!next) return;
  activeWorkers += 1;
  void next().finally(() => {
    activeWorkers = Math.max(0, activeWorkers - 1);
    runNextJob();
  });
};

const enqueueJob = (job: () => Promise<void>) => {
  jobQueue.push(job);
  runNextJob();
};

const ensureLicensed = () => {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NP_LICENSE_ALLOWED === "1") return;
  throw new Error("LICENSE_REQUIRED");
};

const runPatternWorker = async (
  patternId: number,
  inputPath: string,
  options: ProcessOptions
) => {
  ensureLicensed();
  await storage.updatePatternStatus(patternId, "processing");
  const patternMeta = await storage.getPattern(patternId);
  if (!patternMeta) return;

  const workerConfig = resolveWorkerConfig();
  logInfo(
    `[worker] mode=${workerConfig.isProd ?"prod" : "dev"} pattern=${patternId} path=${workerConfig.workerPath}`
  );
  const worker = new Worker(workerConfig.workerPath, {
    ...(workerConfig.type ?{ type: workerConfig.type } : {}),
    ...(workerConfig.execArgv ?{ execArgv: workerConfig.execArgv } : {}),
    workerData: { patternMeta, inputPath, options },
  });
  let isDone = false;

  const setFailed = async (reason: string) => {
    if (isDone) return;
    isDone = true;
    logError(`[worker] failed pattern=${patternId} reason=${reason}`);
    await storage.updatePatternStatus(patternId, "failed");
  };

  worker.on("message", async (message: WorkerSuccess | WorkerFailure) => {
    try {
      if (isDone) return;
      if (message.ok) {
        isDone = true;
        await storage.updatePatternStatus(patternId, "completed", message.svgUrl, message.dxfUrl);
        return;
      }
      await setFailed(`${message.stage}: ${message.message}`);
    } catch (err) {
      const text = err instanceof Error ?err.message : String(err);
      logError(`[worker] status-update pattern=${patternId} error=${text}`);
      await storage.updatePatternStatus(patternId, "failed");
    }
  });

  worker.on("error", async (err) => {
    await setFailed(err.message);
  });

  worker.on("exit", async (code) => {
    if (!isDone && code !== 0) await setFailed(`worker exited with code ${code}`);
    if (!isDone && code === 0) await setFailed(`worker exited unexpectedly with code ${code}`);
  });
};


export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.get("/api/health", async (_req, res) => {
    try {
      await storage.listPatterns(0);
      return res.status(200).json({ ok: true, status: "healthy" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, status: "unhealthy", message });
    }
  });
  


  app.use("/api/auth", authRouter);
  app.use("/api", authenticateToken, machineRouter);

  const serveOwnedFile = (directory: string, urlPrefix: string) =>
    async (req: any, res: any) => {
      const filename = path.basename(req.params.filename);
      const fileUrl = `${urlPrefix}/${filename}`;
      const pattern = await storage.getPatternByFileUrl(fileUrl, req.user.userId);
      if (!pattern) return res.status(404).json({ message: "File not found" });
      return res.sendFile(path.resolve(directory, filename));
    };

  app.get("/uploads/:filename", authenticateToken, serveOwnedFile(UPLOAD_DIR, "/uploads"));
  app.get("/processed/:filename", authenticateToken, serveOwnedFile(PROCESSED_DIR, "/processed"));

  app.post("/api/export/pdf", authenticateToken, express.text({ type: "*/*", limit: "20mb" }), async (req, res) => {
    try {
      ensureLicensed();
      const svg = typeof req.body === "string" ?req.body.trim() : "";
      if (!/<svg[\s>]/i.test(svg)) {
        return res.status(400).json({ message: "SVG content is required" });
      }
      const buffer = await renderSvgToPdfBuffer(svg);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=\"export.pdf\"");
      return res.send(buffer);
    } catch (error) {
      if (error instanceof Error && error.message === "LICENSE_REQUIRED") {
        return res.status(403).json({ message: "License required" });
      }
      const message = error instanceof Error ?error.message : String(error);
      return res.status(500).json({ message });
    }
  });

  app.post("/api/production-saves", authenticateToken, upload.none(), async (req: any, res) => {
    try {
      ensureLicensed();
      const mode = String(req.body?.mode ??"rhinestone").toLowerCase();
      const normalizedMode = mode === "pattern" ?"pattern" : "rhinestone";
      const svg = typeof req.body?.svg === "string" ?req.body.svg : "";
      const dxf = typeof req.body?.dxf === "string" ?req.body.dxf : "";
      const plt = typeof req.body?.plt === "string" ?req.body.plt : "";
      const name = typeof req.body?.name === "string" && req.body.name.trim() ?req.body.name.trim() : `${normalizedMode}-session`;
      if (!svg.includes("<svg")) {
        return res.status(400).json({ message: "SVG content is required" });
      }


      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const base = `${unique}-${normalizedMode}-session`;
      const svgFs = path.join(PROCESSED_DIR, `${base}.svg`);
      const dxfFs = path.join(PROCESSED_DIR, `${base}.dxf`);
      const pltFs = path.join(PROCESSED_DIR, `${base}.plt`);
      const pdfFs = path.join(PROCESSED_DIR, `${base}.pdf`);
      await fsp.writeFile(svgFs, svg, "utf-8");
      if (dxf.trim().length > 0) await fsp.writeFile(dxfFs, dxf, "utf-8");
      if (plt.trim().length > 0) await fsp.writeFile(pltFs, plt, "utf-8");
      const pdfBuffer = await renderSvgToPdfBuffer(svg);
      await fsp.writeFile(pdfFs, pdfBuffer);

      const svgUrl = `/processed/${base}.svg`;
      const dxfUrl = dxf.trim().length > 0 ?`/processed/${base}.dxf` : null;
      const created = await storage.createPattern({
        userId: req.user.userId,
        name,
        imageUrl: svgUrl,
        category: normalizedMode,
        sizeCode: null,
        realDiameterMm: null,
        vectorDiameterMm: null,
        holeDiameterMm: null,
      });
      await storage.updatePatternStatus(created.id, "completed", svgUrl, dxfUrl ??undefined, req.user.userId);
      const archived = await storage.updatePatternArchive(created.id, true, req.user.userId);
      return res.status(201).json(archived);
    } catch (error) {
      if (error instanceof Error && error.message === "LICENSE_REQUIRED") {
        return res.status(403).json({ message: "License required" });
      }
      const message = error instanceof Error ?error.message : String(error);
      return res.status(500).json({ message });
    }
  });

  app.get(api.patterns.list.path, authenticateToken, async (req: any, res) => {
    const patterns = await storage.listPatterns(req.user.userId);
    res.json(patterns);
  });

  app.get(api.patterns.get.path, authenticateToken, async (req: any, res) => {
    const pattern = await storage.getPattern(Number(req.params.id), req.user.userId);
    if (!pattern) return res.status(404).json({ message: "Pattern not found" });
    res.json(pattern);
  });

  app.delete(api.patterns.delete.path, authenticateToken, async (req: any, res) => {
    const deleted = await storage.deletePattern(Number(req.params.id), req.user.userId);
    if (!deleted) return res.status(404).json({ message: "Pattern not found" });
    res.json({ success: true });
  });

  app.patch(api.patterns.archive.path, authenticateToken, async (req: any, res) => {
    const id = Number(req.params.id);
    const pattern = await storage.getPattern(id, req.user.userId);
    if (!pattern) return res.status(404).json({ message: "Pattern not found" });

    const archived = Boolean(req.body?.archived);
    if (!archived) {
      const updated = await storage.updatePatternArchive(id, false, req.user.userId);
      return res.json(updated);
    }
    if (pattern.archived) return res.json(pattern);
    const archivedCopy = await storage.createArchivedCopy(pattern);
    res.json(archivedCopy);
  });

  app.post(api.patterns.create.path, authenticateToken, upload.single("image"), async (req: any, res) => {
    try {
      ensureLicensed();
    } catch {
      return res.status(403).json({ message: "License required" });
    }
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });
    const uploadedFile = req.file;
    if (!isAllowedUploadFile(uploadedFile)) {
      return res.status(400).json({
        message: "Unsupported file type. Allowed: PDF, JPG, JPEG, PNG, WEBP, BMP, TIFF, AVIF, HEIC, HEIF.",
      });
    }

    const requestedCategory = String(req.body?.category ??"pattern").toLowerCase();
    const category =
      requestedCategory === "rhinestone" || requestedCategory === "hybrid"
        ?requestedCategory
        : "pattern";
    const shouldNormalizeToPng =
      !isPdfUploadFile(uploadedFile) && (category === "rhinestone" || category === "hybrid");
    let workerInputPath = uploadedFile.path;
    let storedImageUrl = `/uploads/${uploadedFile.filename}`;

    if (shouldNormalizeToPng) {
      try {
        const normalized = await convertUploadedImageToPng(uploadedFile);
        workerInputPath = normalized.inputPath;
        storedImageUrl = normalized.imageUrl;
      } catch (error) {
        const message = error instanceof Error ?error.message : String(error);
        return res.status(400).json({
          message: `Image conversion to PNG failed: ${message}`,
        });
      }
    }

    const pattern = await storage.createPattern({
      userId: req.user.userId,
      name: uploadedFile.originalname ??"",
      imageUrl: storedImageUrl,
      category,
      sizeCode: typeof req.body?.sizeCode === "string" ?req.body.sizeCode : null,
      realDiameterMm: toNumber(req.body?.realDiameterMm, 2.2),
      vectorDiameterMm: toNumber(req.body?.vectorDiameterMm, 2.2),
      holeDiameterMm: toNumber(req.body?.holeDiameterMm, 2.4),
    });

    const options: ProcessOptions = {
      targetVectorDiameterMm: toNumber(req.body?.targetVectorDiameterMm, null),
      normalizeStones: String(req.body?.normalizeStones) === "true",
      pdfDpi: clamp(toNumber(req.body?.pdfDpi, 600) ??600, 72, 1200),
      threshold: toNumber(req.body?.threshold, null) ??undefined,
      stoneSensitivity: toNumber(req.body?.stoneSensitivity, 50) ??50,
      realWidthMm: toNumber(req.body?.realWidthMm, null),
      calibrationDiameterPx: toNumber(req.body?.calibrationDiameterPx, null),
      calibrationDiameterMm: toNumber(req.body?.calibrationDiameterMm, null),
      spacingToleranceMm: toNumber(req.body?.spacingToleranceMm, 0.05),
      autoPrecision: String(req.body?.autoPrecision ??"true") !== "false",
      patternRegions: parseRegions(req.body?.patternRegions),
      rhinestoneRegions: parseRegions(req.body?.rhinestoneRegions),
      rhinestoneSizeCodes: parseStringArray(req.body?.rhinestoneSizeCodes),
      useControlNet:
        category === "rhinestone" || category === "hybrid"
          ?String(req.body?.useControlNet ??"true") !== "false"
          : false,
    };
    logInfo(`[upload] pattern=${pattern.id} category=${category} sizeCode=${pattern.sizeCode ??"NA"}`);

    enqueueJob(async () => {
      await runPatternWorker(pattern.id, workerInputPath, options);
    });
    res.status(201).json(pattern);
  });

  return httpServer;
}



