import { parentPort, workerData } from "worker_threads";
import path from "path";
import os from "os";
import fs from "fs";
import { promises as fsp } from "fs";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { createRequire } from "module";
import sharp from "sharp";
import potrace from "potrace";
import * as cheerio from "cheerio";

// DOMMatrix polyfill for svg-path-properties in Node.js
if (typeof globalThis.DOMMatrix === "undefined") {
  // @ts-ignore - polyfill for missing DOMMatrix in Node.js
  globalThis.DOMMatrix = class DOMMatrix {
    a: number = 1;
    b: number = 0;
    c: number = 0;
    d: number = 1;
    e: number = 0;
    f: number = 0;

    constructor(init?: string | number[]) {
      if (typeof init === "string") {
        // Parse matrix(a, b, c, d, e, f) format
        const match = /matrix\((.*)\)/.exec(init);
        if (match) {
          const values = match[1].split(",").map((v) => parseFloat(v.trim()));
          if (values.length === 6) {
            [this.a, this.b, this.c, this.d, this.e, this.f] = values;
          }
        }
      } else if (Array.isArray(init) && init.length === 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      }
    }

    multiply(other: DOMMatrix): DOMMatrix {
      const result = new DOMMatrix();
      result.a = this.a * other.a + this.c * other.b;
      result.b = this.b * other.a + this.d * other.b;
      result.c = this.a * other.c + this.c * other.d;
      result.d = this.b * other.c + this.d * other.d;
      result.e = this.a * other.e + this.c * other.f + this.e;
      result.f = this.b * other.e + this.d * other.f + this.f;
      return result;
    }

    transformPoint(point: { x: number; y: number }) {
      return {
        x: this.a * point.x + this.c * point.y + this.e,
        y: this.b * point.x + this.d * point.y + this.f,
      };
    }

    static fromFloat32Array(array32: any): DOMMatrix {
      const matrix = new DOMMatrix();
      matrix.a = array32[0] ?? 1;
      matrix.b = array32[1] ?? 0;
      matrix.c = array32[2] ?? 0;
      matrix.d = array32[3] ?? 1;
      matrix.e = array32[4] ?? 0;
      matrix.f = array32[5] ?? 0;
      return matrix;
    }

    static fromFloat64Array(array64: any): DOMMatrix {
      const matrix = new DOMMatrix();
      matrix.a = array64[0] ?? 1;
      matrix.b = array64[1] ?? 0;
      matrix.c = array64[2] ?? 0;
      matrix.d = array64[3] ?? 1;
      matrix.e = array64[4] ?? 0;
      matrix.f = array64[5] ?? 0;
      return matrix;
    }

    static fromMatrix(other?: any): DOMMatrix {
      if (!other) return new DOMMatrix();
      const matrix = new DOMMatrix();
      matrix.a = other.a ?? 1;
      matrix.b = other.b ?? 0;
      matrix.c = other.c ?? 0;
      matrix.d = other.d ?? 1;
      matrix.e = other.e ?? 0;
      matrix.f = other.f ?? 0;
      return matrix;
    }
  };
}

import { svgPathProperties } from "svg-path-properties";
import {
  CLAHE_CLIP_LIMIT,
  CLAHE_TILE_SIZE,
  DEFAULT_VECTOR_DIAMETER_MM,
  DISTANCE_PEAK_MIN_DIST,
  DISTANCE_PEAK_MIN_VALUE,
  HOUGH_RADIUS_SCAN_STEPS,
  IMAGE_SCALE,
  INVERT_MEAN_THRESHOLD,
  MIN_TARGET_RADIUS_PX,
  MORPH_CLOSE_ITERS,
  MORPH_OPEN_ITERS,
  OTSU_MIN_THRESHOLD,
  OTSU_THRESHOLD_FALLBACK,
  OTSU_THRESHOLD_OFFSET,
  SUBPIXEL_WINDOW_RADIUS,
  TARGET_CENTER_TOLERANCE_MM,
  TARGET_RADIUS_TOLERANCE_MM,
  LOW_CONFIDENCE_THRESHOLD,
  SVG_STROKE_WIDTH,
} from "./constants.ts";
import {
  generateDxfR12FromCircles,
  generateDxfR12FromMixed,
  generateDxfR12FromPolylines,
  type DxfCircle,
  type DxfPoint,
  type DxfPolyline,
} from "./dxf-generator.ts";

type PatternMeta = {
  id: number;
  category?: string | null;
  sizeCode?: string | null;
  realDiameterMm?: number | null;
  vectorDiameterMm?: number | null;
  holeDiameterMm?: number | null;
};

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

type WorkerInput = {
  patternMeta: PatternMeta;
  inputPath: string;
  options: ProcessOptions;
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

type RhinestoneBuildResult = {
  circles: RhinestoneCircle[];
  width: number;
  height: number;
  pxPerMm: number;
  report: RhinestoneReport;
};

type RhinestoneCircle = {
  cx: number;
  cy: number;
  r: number;
  color: string;
  layerSize: string;
  layerColor?: string;
  centerErrorMm: number;
  radiusErrorMm: number;
  confidence: number;
  fitResidualPx: number;
  precisionMode: boolean;
};

type OverlapIssue = {
  i: number;
  j: number;
  distanceMm: number;
  minAllowedMm: number;
};
type Peak = { x: number; y: number; d: number };

type RhinestoneReport = {
  pxPerMm: number;
  avgCenterErrorMm: number;
  avgRadiusErrorMm: number;
  maxDeviationMm: number;
  outOfToleranceCount: number;
  lowConfidenceCount: number;
  overlapCount: number;
  overlaps: OverlapIssue[];
  productionReady: boolean;
  productionMessage: string;
  tolerance: {
    centerMm: number;
    radiusMm: number;
  };
  assessments?: {
    strict: {
      ready: boolean;
      outOfToleranceCount: number;
      tolerance: { centerMm: number; radiusMm: number };
    };
    production: {
      ready: boolean;
      outOfToleranceCount: number;
      tolerance: { centerMm: number; radiusMm: number };
    };
  };
};

class StageError extends Error {
  stage: string;

  constructor(stage: string, message: string) {
    super(message);
    this.stage = stage;
  }
}

const execFileAsync = promisify(execFile);
// Bu fonksiyon senin yeni "Gizli Asistan"ını tetikler

const RADIUS_PRIOR_MIN_SAMPLES = 18;
const RADIUS_PRIOR_MAD_FACTOR = 3.2;
const OVERLAP_RECHECK_RATIO = 0.3;
const OVERLAP_RECHECK_MARGIN_FACTOR = 1.25;
const DEFAULT_FIXED_PX_PER_MM = 3.8;

type RunPythonResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

const getPythonScriptPath = () =>
  resolveReadablePath(
    path.resolve(WORKER_MODULE_DIR, "..", "dist", "pdf_asistan.py"),
    path.resolve(WORKER_MODULE_DIR, "..", "scripts", "pdf_asistan.py")
  ) ?? path.resolve(WORKER_MODULE_DIR, "..", "scripts", "pdf_asistan.py");

const normalizePdfDpi = (value: number | null | undefined) => {
  const parsed = typeof value === "number" ? value : 600;
  const rounded = Math.round(parsed);
  if (!Number.isFinite(rounded)) return 600;
  return Math.min(1200, Math.max(72, rounded));
};

const runPython = (
  pdfPath: string,
  pngPath: string,
  dpi: number
): Promise<RunPythonResult> =>
  new Promise((resolve, reject) => {
    const scriptPath = getPythonScriptPath();
    const pythonCommand = process.env.PYTHON_BIN || "python";
    const normalizedDpi = normalizePdfDpi(dpi);
    console.log("PYTHON STARTED", {
      pythonCommand,
      scriptPath,
      pdfPath,
      pngPath,
      dpi: normalizedDpi,
    });

    const child = spawn(
      pythonCommand,
      [scriptPath, pdfPath, "--png", pngPath, "--dpi", String(normalizedDpi), "--page", "0"],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(new StageError("python", error.message));
    });

    child.on("close", (exitCode) => {
      const code = exitCode ?? -1;
      console.log("PYTHON EXIT CODE", code);
      if (stdout.trim().length > 0) console.log(stdout.trim());
      if (stderr.trim().length > 0) console.error(stderr.trim());
      if (code !== 0) {
        const details = stderr.trim() || stdout.trim();
        const message = details
          ? `Python exited with code ${code}: ${details}`
          : `Python exited with code ${code}`;
        reject(new StageError("python", message));
        return;
      }
      resolve({ stdout, stderr, exitCode: code });
    });
  });

/**
 * PDF Raster Rendering Configuration
 * Customize per document type for optimal extraction
 * 
 * Usage:
 *   // For high-quality extractions
 *   const highQuality: PdfRenderConfig = { pngDpi: 1200, stoneSensitivity: 0.7 };
 *   await renderPdfToPngWithPoppler(pdfPath, highQuality);
 *   
 *   // For fast processing with standard quality
 *   const standard: PdfRenderConfig = { pngDpi: 300, stoneSensitivity: 0.5 };
 *   await renderPdfToPngWithPoppler(pdfPath, standard);
 */
export interface PdfRenderConfig {
  // PNG rendering DPI (higher = better quality, slower processing)
  // Range: 72-1200, Typical: 300-600, Default: 600
  pngDpi?: number;
  // SVG rendering quality (1-2, higher = better)
  // Note: Not all Poppler versions support this, may be ignored
  svgQuality?: number;
  // Blob detection parameters (minimum and maximum stone sizes)
  blobMinSize?: number;  // Minimum blob size in pixels, default: 50
  blobMaxSize?: number;  // Maximum blob size in pixels, default: 50000
  // Stone detection sensitivity (0.0-1.0, lower = more detections, higher = more selective)
  // Range: 0.2-0.8, Default: 0.5
  stoneSensitivity?: number;
}

// Default configuration: balanced for typical PDF patterns
const DEFAULT_PDF_RENDER_CONFIG: PdfRenderConfig = {
  pngDpi: 600,           // Standard 600 DPI for good quality
  svgQuality: 2,         // Standard SVG quality
  blobMinSize: 50,       // Minimum blob size in pixels
  blobMaxSize: 50000,    // Maximum blob size in pixels
  stoneSensitivity: 0.5, // Balanced sensitivity
};
const PRODUCTION_CENTER_TOLERANCE_MM = 0.07;
const PRODUCTION_RADIUS_TOLERANCE_MM = 0.07;
const SIZE_CODE_VECTOR_MM: Record<string, number> = {
  SS4: 1.6,
  SS6: 2.1,
  SS10: 2.9,
  SS12: 3.2,
  SS16: 4.0,
  SS20: 4.8,
};
const SS_SAFETY_GAP_MM: Record<string, number> = {
  SS4: 0.12,
  SS6: 0.16,
  SS10: 0.22,
  SS12: 0.26,
  SS16: 0.34,
  SS20: 0.42,
};
const SS_SPACING_AGGRESSION: Record<string, number> = {
  SS4: 1.0,
  SS6: 1.01,
  SS10: 1.05,
  SS12: 1.08,
  SS16: 1.1,
  SS20: 1.12,
};

const getAdaptiveProductionTolerance = (sizeCode: string) => {
  const radiusBySize: Record<string, number> = {
    SS4: 0.07,
    SS6: 0.075,
    SS10: 0.085,
    SS12: 0.095,
    SS16: 0.105,
    SS20: 0.115,
  };
  const centerBySize: Record<string, number> = {
    SS4: 0.07,
    SS6: 0.072,
    SS10: 0.078,
    SS12: 0.085,
    SS16: 0.092,
    SS20: 0.1,
  };
  const radiusBase = radiusBySize[sizeCode] ??PRODUCTION_RADIUS_TOLERANCE_MM;
  const centerBase = centerBySize[sizeCode] ??PRODUCTION_CENTER_TOLERANCE_MM;
  return {
    radiusMm: Math.min(0.13, radiusBase),
    centerMm: Math.min(0.11, centerBase),
  };
};

const toPlainUint8 = (view: ArrayBufferView) =>
  new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));

const WORKER_MODULE_DIR = typeof __dirname !== "undefined" ? __dirname : process.cwd();

const uniquePaths = (...values: Array<string | undefined | null>) =>
  Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ?value.trim() : ""))
        .filter((value) => value.length > 0)
    )
  );

const resolveReadablePath = (...candidates: Array<string | undefined | null>) =>
  uniquePaths(...candidates).find((candidate) => fs.existsSync(candidate)) ?? null;

const toAsarUnpackedPath = (inputPath: string) => {
  const marker = `${path.sep}app.asar${path.sep}`;
  if (inputPath.includes(marker)) {
    return inputPath.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`);
  }
  if (inputPath.endsWith(`${path.sep}app.asar`)) {
    return `${inputPath}.unpacked`;
  }
  return inputPath;
};

const toSharpInput = (value: string | Buffer | Uint8Array | ArrayBuffer) => {
  if (typeof value === "string") {
    const fileBuffer = fs.readFileSync(value);
    return toPlainUint8(fileBuffer);
  }
  if (Buffer.isBuffer(value)) return toPlainUint8(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return toPlainUint8(value);
  return value;
};

const parseSvgLengthToMm = (value: string | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const match = trimmed.match(/^([+-]?\d*\.?\d+)([a-zA-Z%]*)$/);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return null;
  const unit = (match[2] || "px").toLowerCase();
  if (unit === "mm") return num;
  if (unit === "cm") return num * 10;
  if (unit === "in") return num * 25.4;
  if (unit === "pt") return num * (25.4 / 72);
  if (unit === "pc") return num * (25.4 / 6);
  if (unit === "px") return num * (25.4 / 96);
  return null;
};

const isLossyRasterPath = (inputPath: string) => {
  const ext = path.extname(inputPath).toLowerCase();
  return ext === ".jpg" || ext === ".jpeg" || ext === ".webp";
};

const normalizeSvg = (svgString: string) => {
  const svgTagMatch = svgString.match(/<svg[^>]*>/i);
  if (!svgTagMatch) return svgString;

  const svgTag = svgTagMatch[0];
  const widthMatch = svgTag.match(/width="([0-9.]+)(pt|px)??"/i);
  const heightMatch = svgTag.match(/height="([0-9.]+)(pt|px)??"/i);
  const hasViewBox = /viewBox="/i.test(svgTag);
  const hasPreserve = /preserveAspectRatio="/i.test(svgTag);

  let updatedTag = svgTag;
  if (widthMatch && heightMatch && !hasViewBox) {
    const width = Number(widthMatch[1]);
    const height = Number(heightMatch[1]);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      updatedTag = updatedTag.replace("<svg", `<svg viewBox="0 0 ${width} ${height}"`);
    }
  }

  if (!hasPreserve) {
    updatedTag = updatedTag.replace("<svg", '<svg preserveAspectRatio="xMidYMid meet"');
  }

  return updatedTag === svgTag ?svgString : svgString.replace(svgTag, updatedTag);
};

const circularizeNearCircles = (svgString: string, normalizeStones?: boolean) => {
  const $ = cheerio.load(svgString, { xmlMode: true });
  let replaced = 0;
  const ratioMax = normalizeStones ?1.35 : 1.05;
  const minLengthRatio = normalizeStones ?0.78 : 0.88;
  const maxLengthRatio = normalizeStones ?1.25 : 1.12;

  // Normalize explicit ellipses into circles by averaging radii.
  $("ellipse").each((_, element) => {
    const cx = Number($(element).attr("cx"));
    const cy = Number($(element).attr("cy"));
    const rx = Number($(element).attr("rx"));
    const ry = Number($(element).attr("ry"));
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(rx) || !Number.isFinite(ry)) return;
    const r = (Math.abs(rx) + Math.abs(ry)) * 0.5;
    if (!Number.isFinite(r) || r <= 0) return;
    $(element).replaceWith(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" />`);
    replaced += 1;
  });

  $("path").each((_, element) => {
    const d = $(element).attr("d");
    if (!d) return;

    try {
      const props = new svgPathProperties(d);
      const length = props.getTotalLength();
      const bbox = (props as unknown as { getBBox: () => { x: number; y: number; width: number; height: number } }).getBBox();

      if (bbox.width <= 0 || bbox.height <= 0) return;

      const ratio = bbox.width > bbox.height ?bbox.width / bbox.height : bbox.height / bbox.width;
      if (ratio > ratioMax) return;

      const radius = (bbox.width + bbox.height) / 4;
      const circumference = 2 * Math.PI * radius;
      const lengthRatio = length / circumference;
      if (lengthRatio < minLengthRatio || lengthRatio > maxLengthRatio) return;

      const cx = bbox.x + bbox.width / 2;
      const cy = bbox.y + bbox.height / 2;

      $(element).replaceWith(
        `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}" />`
      );
      replaced += 1;
    } catch {
      return;
    }
  });

  return replaced > 0 ?$.xml() : svgString;
};

const configurePdfModuleFallbacks = () => {
  const runtimeRequire: NodeRequire =
    typeof require !== "undefined"
      ?require
      : createRequire(__filename);
  const Module = runtimeRequire("module") as { _initPaths: () => void };
  const moduleDir = WORKER_MODULE_DIR;
  const appBase = path.resolve(moduleDir, "..");
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

const writePdfFromSvg = async (svg: string, outputPath: string) => {
  const sizeMatch = svg.match(/width="([0-9.]+)(pt|px)??".*height="([0-9.]+)(pt|px)??"/i);
  const pageSize = sizeMatch ?[Number(sizeMatch[1]), Number(sizeMatch[3])] : "A4";

  await new Promise<void>((resolve, reject) => {
    const runtimeRequire = configurePdfModuleFallbacks();
    const PDFDocument = runtimeRequire("pdfkit");
    const svgToPdf = runtimeRequire("svg-to-pdfkit");
    const doc = new PDFDocument({ size: pageSize as any, margin: 0 });
    const stream = fs.createWriteStream(outputPath);
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    doc.on("error", reject);

    doc.pipe(stream);
    svgToPdf(doc, svg, 0, 0);
    doc.end();
  });
};

const buildAutoContrastBinaryMask = (
  gray: Uint8Array,
  width: number,
  height: number,
  thresholdOverride?: number,
  sensitivity = 50
) => {
  const pixelCount = width * height;
  const hist = new Array<number>(256).fill(0);
  let graySum = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    const v = gray[i];
    hist[v] += 1;
    graySum += v;
  }

  let sum = 0;
  for (let t = 0; t < 256; t += 1) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let otsuThreshold = OTSU_THRESHOLD_FALLBACK;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = pixelCount - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      otsuThreshold = t;
    }
  }

  otsuThreshold = Math.max(OTSU_MIN_THRESHOLD, otsuThreshold - OTSU_THRESHOLD_OFFSET);
  const effectiveThreshold = Number.isFinite(thresholdOverride as number)
    ?Math.max(0, Math.min(255, Number(thresholdOverride)))
    : otsuThreshold;
  const tunedThreshold = Math.max(
    0,
    Math.min(255, Math.round(effectiveThreshold - ((sensitivity - 50) / 50) * 10))
  );

  const invert = graySum / pixelCount > INVERT_MEAN_THRESHOLD;
  const iw = width + 1;
  const integral = new Float64Array(iw * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += gray[(y - 1) * width + (x - 1)];
      integral[y * iw + x] = integral[(y - 1) * iw + x] + rowSum;
    }
  }

  const bin = new Uint8Array(pixelCount);
  const winR = Math.max(4, Math.round(Math.min(width, height) * 0.015));
  const localDelta = 10 + (100 - sensitivity) * 0.12;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - winR);
    const y1 = Math.min(height - 1, y + winR);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - winR);
      const x1 = Math.min(width - 1, x + winR);
      const A = y0 * iw + x0;
      const B = y0 * iw + (x1 + 1);
      const C = (y1 + 1) * iw + x0;
      const D = (y1 + 1) * iw + (x1 + 1);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const localMean = (integral[D] - integral[B] - integral[C] + integral[A]) / count;
      const g = gray[y * width + x];
      const adaptiveOn = invert ?g <= localMean - localDelta : g >= localMean + localDelta;
      const globalOn = invert ?g <= tunedThreshold : g >= tunedThreshold;
      bin[y * width + x] = adaptiveOn || globalOn ?1 : 0;
    }
  }

  return bin;
};

const buildChromaAwareMask = (
  baseMask: Uint8Array,
  gray: Uint8Array,
  saturation: Uint8Array,
  width: number,
  height: number,
  sensitivity = 50
) => {
  if (saturation.length !== baseMask.length) return baseMask;
  const hist = new Uint32Array(256);
  for (let i = 0; i < saturation.length; i += 1) hist[saturation[i]] += 1;
  const percentile = (p: number) => {
    const target = Math.max(0, Math.floor(saturation.length * p));
    let acc = 0;
    for (let i = 0; i < hist.length; i += 1) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 0;
  };
  const satP60 = percentile(0.6);
  const satP85 = percentile(0.85);
  const satFloor = Math.max(10, Math.round(satP60 * (0.9 - (sensitivity - 50) * 0.002)));
  const satBoost = Math.max(18, Math.round(satP85 * 0.82));
  const grayGate = 72;

  const mask = new Uint8Array(baseMask.length);
  for (let i = 0; i < baseMask.length; i += 1) {
    const on = baseMask[i] === 1;
    const s = saturation[i];
    const g = gray[i];
    if (on) {
      // Cut weak bridges that come from blur/threshold bleed between dense stones.
      mask[i] = (s < satFloor && g < grayGate) ?0 : 1;
    } else {
      // Recover colored stone cores that can disappear in pure grayscale thresholding.
      mask[i] = (s >= satBoost && g >= grayGate) ?1 : 0;
    }
  }
  return mask;
};

const buildAdaptiveGaussianMask = (
  channel: Uint8Array,
  width: number,
  height: number,
  sensitivity = 50
) => {
  const pixelCount = width * height;
  let mean = 0;
  for (let i = 0; i < pixelCount; i += 1) mean += channel[i];
  mean /= Math.max(1, pixelCount);
  const invert = mean > INVERT_MEAN_THRESHOLD;

  const iw = width + 1;
  const integral = new Float64Array(iw * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += channel[(y - 1) * width + (x - 1)];
      integral[y * iw + x] = integral[(y - 1) * iw + x] + rowSum;
    }
  }

  const winR = Math.max(5, Math.round(Math.min(width, height) * 0.02));
  const localDelta = 10 + (100 - Math.max(0, Math.min(100, sensitivity))) * 0.12;
  const mask = new Uint8Array(pixelCount);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - winR);
    const y1 = Math.min(height - 1, y + winR);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - winR);
      const x1 = Math.min(width - 1, x + winR);
      const A = y0 * iw + x0;
      const B = y0 * iw + (x1 + 1);
      const C = (y1 + 1) * iw + x0;
      const D = (y1 + 1) * iw + (x1 + 1);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const localMean = (integral[D] - integral[B] - integral[C] + integral[A]) / Math.max(1, count);
      const v = channel[y * width + x];
      mask[y * width + x] = invert ?(v <= localMean - localDelta ?1 : 0) : (v >= localMean + localDelta ?1 : 0);
    }
  }
  return mask;
};

const circlePathD = (cx: number, cy: number, r: number) =>
  `M ${(cx - r).toFixed(2)} ${cy.toFixed(2)} ` +
  `a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0 ` +
  `a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`;

const samplePathToPoints = (d: string, maxStep = 2.5): DxfPoint[] => {
  try {
    const props = new svgPathProperties(d);
    const total = props.getTotalLength();
    if (!Number.isFinite(total) || total <= 0) return [];
    const step = Math.max(0.8, Math.min(6, maxStep));
    const count = Math.max(2, Math.ceil(total / step));
    const points: DxfPoint[] = [];
    for (let i = 0; i <= count; i += 1) {
      const at = Math.min(total, (i / count) * total);
      const pt = props.getPointAtLength(at);
      points.push({ x: pt.x, y: pt.y });
    }
    return points;
  } catch {
    return [];
  }
};

const splitPathSubpaths = (d: string): string[] => {
  const parts = d.match(/[Mm][^Mm]*/g);
  if (!parts || parts.length === 0) return [d];
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
};

const sampleCircleToPoints = (cx: number, cy: number, r: number, segments = 72): DxfPoint[] => {
  const points: DxfPoint[] = [];
  const n = Math.max(16, segments);
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    points.push({
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r,
    });
  }
  return points;
};

const pointsAlmostEqual = (a: DxfPoint, b: DxfPoint, epsilon = 0.001) =>
  Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;

const extractPolylinesFromSvg = (svgString: string): DxfPolyline[] => {
  const $ = cheerio.load(svgString, { xmlMode: true });
  const polylines: DxfPolyline[] = [];

  $("path").each((_, element) => {
    const d = $(element).attr("d");
    if (!d) return;
    const subpaths = splitPathSubpaths(d);
    for (const subpath of subpaths) {
      const points = samplePathToPoints(subpath);
      if (points.length < 2) continue;
      const closedByPath = /(?:^|[\s,])z(?:[\s,]|$)/i.test(subpath);
      const closedByPoints = points.length > 2 && pointsAlmostEqual(points[0], points[points.length - 1], 0.01);
      polylines.push({
        points,
        closed: closedByPath || closedByPoints,
        layer: "PATTERN_OUTLINE",
      });
    }
  });

  $("circle").each((_, element) => {
    const cx = Number($(element).attr("cx"));
    const cy = Number($(element).attr("cy"));
    const r = Number($(element).attr("r"));
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || r <= 0) return;
    polylines.push({
      points: sampleCircleToPoints(cx, cy, r),
      closed: true,
      layer: "PATTERN_CIRCLES",
    });
  });

  return polylines;
};

type PatternTraceOptions = {
  excludeCircles?: Array<Pick<RhinestoneCircle, "cx" | "cy" | "r">>;
  includeRegions?: Array<{ x: number; y: number; w: number; h: number }>;
};

const pointInAnyNormalizedRegion = (
  px: number,
  py: number,
  width: number,
  height: number,
  regions: Array<{ x: number; y: number; w: number; h: number }>
) => {
  if (!regions.length) return true;
  const nx = px / Math.max(1, width);
  const ny = py / Math.max(1, height);
  for (const r of regions) {
    if (nx >= r.x && ny >= r.y && nx <= r.x + r.w && ny <= r.y + r.h) return true;
  }
  return false;
};

const computeOtsuThresholdFromHist = (hist: Uint32Array, total: number) => {
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxBetween = 0;
  let threshold = OTSU_THRESHOLD_FALLBACK;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxBetween) {
      maxBetween = between;
      threshold = t;
    }
  }
  return Math.max(OTSU_MIN_THRESHOLD, threshold - OTSU_THRESHOLD_OFFSET);
};

const decideInvertByContrast = (hist: Uint32Array, threshold: number) => {
  let darkStrength = 0;
  let brightStrength = 0;
  for (let i = 0; i < threshold; i += 1) darkStrength += hist[i] * (threshold - i);
  for (let i = threshold + 1; i < 256; i += 1) brightStrength += hist[i] * (i - threshold);
  return darkStrength >= brightStrength;
};

const buildAdaptiveOtsuMask = (
  channel: Uint8Array,
  width: number,
  height: number,
  thresholdBias = 0
) => {
  const total = width * height;
  const hist = new Uint32Array(256);
  for (let i = 0; i < total; i += 1) hist[channel[i]] += 1;
  const otsuThreshold = computeOtsuThresholdFromHist(hist, total);
  const invert = decideInvertByContrast(hist, otsuThreshold);
  const tunedThreshold = Math.max(0, Math.min(255, Math.round(otsuThreshold + thresholdBias)));

  const iw = width + 1;
  const integral = new Float64Array(iw * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let row = 0;
    for (let x = 1; x <= width; x += 1) {
      row += channel[(y - 1) * width + (x - 1)];
      integral[y * iw + x] = integral[(y - 1) * iw + x] + row;
    }
  }

  const winR = Math.max(4, Math.round(Math.min(width, height) * 0.015));
  const localDelta = 11;
  const mask = new Uint8Array(total);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - winR);
    const y1 = Math.min(height - 1, y + winR);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - winR);
      const x1 = Math.min(width - 1, x + winR);
      const A = y0 * iw + x0;
      const B = y0 * iw + (x1 + 1);
      const C = (y1 + 1) * iw + x0;
      const D = (y1 + 1) * iw + (x1 + 1);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const localMean = (integral[D] - integral[B] - integral[C] + integral[A]) / Math.max(1, count);
      const v = channel[y * width + x];
      const adaptiveOn = invert ?v <= localMean - localDelta : v >= localMean + localDelta;
      const globalOn = invert ?v <= tunedThreshold : v >= tunedThreshold;
      mask[y * width + x] = adaptiveOn || globalOn ?1 : 0;
    }
  }
  return mask;
};

const getRasterSource = async (inputPath: string) => {
  return inputPath;
};

const tracePatternSvg = async (inputPath: string, traceOptions: PatternTraceOptions = {}) => {
  let processedBuffer: Buffer;
  try {
    const rasterSource = await getRasterSource(inputPath);
    const lossyInput = isLossyRasterPath(rasterSource);
    let sharpInput = sharp(toSharpInput(rasterSource)).removeAlpha().toColorspace("srgb");
    if (lossyInput) {
      // JPEG/WebP block artifacts: keep deblock light, avoid over-softening edges.
      sharpInput = sharpInput.median(1);
    }
    const { data, info } = await sharpInput
      .normalize()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;
    const channels = info.channels;
    const pixelCount = width * height;

    const gray = new Uint8Array(pixelCount);
    const chR = new Uint8Array(pixelCount);
    const chG = new Uint8Array(pixelCount);
    const chB = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i += 1) {
      const idx = i * channels;
      const r = data[idx];
      const g = data[idx + Math.min(1, channels - 1)];
      const b = data[idx + Math.min(2, channels - 1)];
      chR[i] = r;
      chG[i] = g;
      chB[i] = b;
      gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }

    const grayMask = buildAdaptiveOtsuMask(gray, width, height, 0);
    const rMask = buildAdaptiveOtsuMask(chR, width, height, -2);
    const gMask = buildAdaptiveOtsuMask(chG, width, height, -2);
    const bMask = buildAdaptiveOtsuMask(chB, width, height, -2);

    const mergedMask = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i += 1) {
      const votes = grayMask[i] + rMask[i] + gMask[i] + bMask[i];
      mergedMask[i] = votes >= 2 ?1 : 0;
    }

    const cleanedMask = dilateBinary(
      erodeBinary(
        dilateBinary(
          erodeBinary(mergedMask, width, height, 1),
          width,
          height,
          1
        ),
        width,
        height,
        1
      ),
      width,
      height,
      1
    );

    const masked = Buffer.alloc(pixelCount);
    for (let i = 0; i < pixelCount; i += 1) {
      masked[i] = cleanedMask[i] ?0 : 255;
    }

    const includeRegions = traceOptions.includeRegions ??[];
    if (includeRegions.length > 0) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (!pointInAnyNormalizedRegion(x, y, width, height, includeRegions)) {
            masked[y * width + x] = 255;
          }
        }
      }
    }
    const circles = traceOptions.excludeCircles ??[];
    if (circles.length > 0) {
      for (const circle of circles) {
        const eraseRadius = Math.max(1.2, circle.r * 1.08 + 1.0);
        const ringBand = Math.min(
          Math.max(1.3, circle.r * 0.24 + 0.9),
          Math.max(2.4, circle.r * 0.68)
        );
        const minX = Math.max(0, Math.floor(circle.cx - eraseRadius));
        const maxX = Math.min(width - 1, Math.ceil(circle.cx + eraseRadius));
        const minY = Math.max(0, Math.floor(circle.cy - eraseRadius));
        const maxY = Math.min(height - 1, Math.ceil(circle.cy + eraseRadius));
        for (let y = minY; y <= maxY; y += 1) {
          for (let x = minX; x <= maxX; x += 1) {
            const dx = x - circle.cx;
            const dy = y - circle.cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= eraseRadius && Math.abs(dist - circle.r) <= ringBand) {
              masked[y * width + x] = 255;
            }
          }
        }
      }
    }

    processedBuffer = await sharp(masked, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();
  } catch (err) {
    const message = err instanceof Error ?err.message : "Sharp error";
    throw new StageError("sharp", message);
  }

  return await new Promise<string>((resolve, reject) => {
    potrace.trace(processedBuffer, (err: Error | null, svgString: string) => {
      if (err) {
        reject(new StageError("potrace", err.message));
      } else {
        resolve(svgString);
      }
    });
  });
};

const appendRhinestoneCirclesToSvg = (baseSvg: string, circles: RhinestoneCircle[]) => {
  if (circles.length === 0) return baseSvg;
  const $ = cheerio.load(baseSvg, { xmlMode: true });
  const svg = $("svg").first();
  if (!svg.length) return baseSvg;
  const stoneGroup = [
    `<g fill="none" stroke-width="${Math.max(0.25, SVG_STROKE_WIDTH * 0.7)}" vector-effect="non-scaling-stroke">`,
    ...circles.map((c) => `<circle cx="${c.cx.toFixed(2)}" cy="${c.cy.toFixed(2)}" r="${c.r.toFixed(2)}" stroke="${c.color}" fill="none" />`),
    `</g>`,
  ].join("");
  svg.append(stoneGroup);
  return $.xml();
};

const buildEmptySvgCanvas = (width: number, height: number) =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, width)}" height="${Math.max(1, height)}" viewBox="0 0 ${Math.max(1, width)} ${Math.max(1, height)}" preserveAspectRatio="xMidYMid meet">`,
    `</svg>`,
  ].join("");

type PatternCircleHint = {
  polylineIndex: number;
  cx: number;
  cy: number;
  r: number;
  circularity: number;
};

const toPatternCircleHint = (polyline: DxfPolyline, polylineIndex: number): PatternCircleHint | null => {
  if (!polyline.closed || polyline.points.length < 12) return null;
  const points = polyline.points;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / points.length;
  const cy = sumY / points.length;
  const width = maxX - minX;
  const height = maxY - minY;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const aspect = width > height ?width / height : height / width;
  const r = (width + height) * 0.25;
  if (!Number.isFinite(r) || r < 0.8) return null;

  let radialError = 0;
  for (const p of points) {
    radialError += Math.abs(Math.hypot(p.x - cx, p.y - cy) - r);
  }
  const meanRadialError = radialError / points.length;
  const relativeError = meanRadialError / Math.max(0.001, r);
  const circularity = 1 - Math.min(1, relativeError * 2.2);
  if (aspect > 1.2 || circularity < 0.72) return null;

  return { polylineIndex, cx, cy, r, circularity };
};

const reconcileHybridGeometry = (
  patternPolylines: DxfPolyline[],
  circles: RhinestoneCircle[]
) => {
  const hints = patternPolylines
    .map((polyline, index) => toPatternCircleHint(polyline, index))
    .filter((hint): hint is PatternCircleHint => Boolean(hint));

  const usedHints = new Set<number>();
  const removePatternPolylines = new Set<number>();
  const keptCircles: RhinestoneCircle[] = [];

  for (const circle of circles) {
    let bestHint: PatternCircleHint | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const hint of hints) {
      if (usedHints.has(hint.polylineIndex)) continue;
      const centerDist = Math.hypot(circle.cx - hint.cx, circle.cy - hint.cy);
      const radiusDiff = Math.abs(circle.r - hint.r);
      const centerLimit = Math.max(1.6, circle.r * 0.55);
      const radiusLimit = Math.max(0.8, circle.r * 0.45);
      if (centerDist > centerLimit || radiusDiff > radiusLimit) continue;
      const score = centerDist + radiusDiff * 0.7 - hint.circularity;
      if (score < bestScore) {
        bestScore = score;
        bestHint = hint;
      }
    }

    if (bestHint) {
      usedHints.add(bestHint.polylineIndex);
      removePatternPolylines.add(bestHint.polylineIndex);
      keptCircles.push(circle);
      continue;
    }

    const strictConfidence = Math.max(LOW_CONFIDENCE_THRESHOLD + 0.18, 0.78);
    const residualLimit = Math.max(0.55, circle.r * 0.22);
    if (circle.confidence >= strictConfidence && circle.fitResidualPx <= residualLimit) {
      keptCircles.push(circle);
    }
  }

  const keptPatternPolylines = patternPolylines.filter(
    (_polyline, index) => !removePatternPolylines.has(index)
  );

  return { keptCircles, keptPatternPolylines };
};

const extractBase64Image = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length === 0) return null;
  const idx = value.indexOf("base64,");
  return idx >= 0 ? value.slice(idx + 7) : value;
};

const tryControlNetEnhance = async (inputPng: Buffer): Promise<Buffer | null> => {
  const baseUrl = (process.env.CONTROLNET_API_BASE ?? "http://127.0.0.1:7860").replace(/\/+$/, "");
  const moduleName = process.env.CONTROLNET_MODULE ?? "canny";
  const modelName = process.env.CONTROLNET_MODEL ?? "";
  const payload = {
    controlnet_module: moduleName,
    controlnet_model: modelName,
    controlnet_input_images: [inputPng.toString("base64")],
    controlnet_processor_res: 1024,
    controlnet_threshold_a: 64,
    controlnet_threshold_b: 160,
  };

  const endpoints = [`${baseUrl}/controlnet/detect`, `${baseUrl}/sdapi/v1/controlnet/detect`];
  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) continue;
      const data = (await response.json()) as { images?: unknown[]; image?: unknown };
      const imageCandidate = Array.isArray(data.images) ?data.images[0] : data.image;
      const base64 = extractBase64Image(imageCandidate);
      if (!base64) continue;
      return Buffer.from(base64, "base64");
    } catch {
      continue;
    }
  }
  return null;
};

const dilateBinary = (src: Uint8Array, width: number, height: number, iters = 1) => {
  let cur = src;
  for (let it = 0; it < iters; it += 1) {
    const out = new Uint8Array(cur.length);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        let on = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (cur[(y + dy) * width + (x + dx)] > 0) {
              on = 1;
              break;
            }
          }
          if (on) break;
        }
        out[y * width + x] = on;
      }
    }
    cur = out;
  }
  return cur;
};

const erodeBinary = (src: Uint8Array, width: number, height: number, iters = 1) => {
  let cur = src;
  for (let it = 0; it < iters; it += 1) {
    const out = new Uint8Array(cur.length);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        let on = 1;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (cur[(y + dy) * width + (x + dx)] === 0) {
              on = 0;
              break;
            }
          }
          if (!on) break;
        }
        out[y * width + x] = on;
      }
    }
    cur = out;
  }
  return cur;
};

const applyClaheLike = (gray: Uint8Array, width: number, height: number) => {
  const tile = Math.max(8, CLAHE_TILE_SIZE);
  const out = new Uint8Array(gray.length);
  for (let y0 = 0; y0 < height; y0 += tile) {
    for (let x0 = 0; x0 < width; x0 += tile) {
      const x1 = Math.min(width, x0 + tile);
      const y1 = Math.min(height, y0 + tile);
      const hist = new Uint32Array(256);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          hist[gray[y * width + x]] += 1;
        }
      }
      const area = (x1 - x0) * (y1 - y0);
      const clipLimit = Math.max(1, Math.floor((CLAHE_CLIP_LIMIT * area) / 256));
      let clipped = 0;
      for (let i = 0; i < 256; i += 1) {
        if (hist[i] > clipLimit) {
          clipped += hist[i] - clipLimit;
          hist[i] = clipLimit;
        }
      }
      const redist = Math.floor(clipped / 256);
      for (let i = 0; i < 256; i += 1) hist[i] += redist;
      const cdf = new Uint32Array(256);
      cdf[0] = hist[0];
      for (let i = 1; i < 256; i += 1) cdf[i] = cdf[i - 1] + hist[i];
      const denom = Math.max(1, cdf[255]);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const v = gray[y * width + x];
          out[y * width + x] = Math.max(0, Math.min(255, Math.round((cdf[v] * 255) / denom)));
        }
      }
    }
  }
  return out;
};

const sobelEdges = (gray: Uint8Array, width: number, height: number) => {
  const mag = new Float32Array(width * height);
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const g00 = gray[(y - 1) * width + (x - 1)];
      const g01 = gray[(y - 1) * width + x];
      const g02 = gray[(y - 1) * width + (x + 1)];
      const g10 = gray[y * width + (x - 1)];
      const g12 = gray[y * width + (x + 1)];
      const g20 = gray[(y + 1) * width + (x - 1)];
      const g21 = gray[(y + 1) * width + x];
      const g22 = gray[(y + 1) * width + (x + 1)];
      const gx = -g00 - 2 * g10 - g20 + g02 + 2 * g12 + g22;
      const gy = -g00 - 2 * g01 - g02 + g20 + 2 * g21 + g22;
      const m = Math.sqrt(gx * gx + gy * gy);
      mag[i] = m;
      sum += m;
      sumSq += m * m;
      count += 1;
    }
  }
  const mean = count > 0 ?sum / count : 0;
  const variance = count > 0 ?Math.max(0, sumSq / count - mean * mean) : 0;
  const threshold = mean + Math.sqrt(variance) * 0.6;
  const edge = new Uint8Array(width * height);
  for (let i = 0; i < edge.length; i += 1) edge[i] = mag[i] >= threshold ?1 : 0;
  return edge;
};

const computeDistanceTransform = (mask: Uint8Array, width: number, height: number) => {
  const inf = 1e9;
  const dist = new Float32Array(width * height);
  for (let i = 0; i < dist.length; i += 1) dist[i] = mask[i] ?inf : 0;

  const d1 = 1;
  const d2 = Math.SQRT2;
  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let v = dist[i];
      v = Math.min(v, dist[(y - 1) * width + x] + d1);
      v = Math.min(v, dist[y * width + (x - 1)] + d1);
      v = Math.min(v, dist[(y - 1) * width + (x - 1)] + d2);
      v = Math.min(v, dist[(y - 1) * width + (x + 1)] + d2);
      dist[i] = v;
    }
  }
  for (let y = height - 2; y >= 0; y -= 1) {
    for (let x = width - 2; x >= 1; x -= 1) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let v = dist[i];
      v = Math.min(v, dist[(y + 1) * width + x] + d1);
      v = Math.min(v, dist[y * width + (x + 1)] + d1);
      v = Math.min(v, dist[(y + 1) * width + (x + 1)] + d2);
      v = Math.min(v, dist[(y + 1) * width + (x - 1)] + d2);
      dist[i] = v;
    }
  }
  return dist;
};

const findDistancePeaks = (dist: Float32Array, mask: Uint8Array, width: number, height: number) => {
  const peaks: Peak[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const d = dist[i];
      if (!mask[i] || d < DISTANCE_PEAK_MIN_VALUE) continue;
      let isPeak = true;
      for (let dy = -1; dy <= 1 && isPeak; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          if (dist[(y + dy) * width + (x + dx)] > d) {
            isPeak = false;
            break;
          }
        }
      }
      if (isPeak) peaks.push({ x, y, d });
    }
  }
  peaks.sort((a, b) => b.d - a.d);
  const kept: Peak[] = [];
  for (const p of peaks) {
    let near = false;
    for (const k of kept) {
      const dx = p.x - k.x;
      const dy = p.y - k.y;
      const minDist = Math.max(DISTANCE_PEAK_MIN_DIST, Math.min(p.d, k.d) * 0.7);
      if (dx * dx + dy * dy < minDist * minDist) {
        near = true;
        break;
      }
    }
    if (!near) kept.push(p);
  }
  return kept;
};

const findComponentPeaks = (mask: Uint8Array, width: number, height: number) => {
  const visited = new Uint8Array(width * height);
  const seeds: Peak[] = [];
  const qx = new Int32Array(width * height);
  const qy = new Int32Array(width * height);

  const pushSeed = (cx: number, cy: number, bw: number, bh: number, area: number) => {
    const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
    if (aspect > 1.65) return;
    if (area < 10) return;
    const radius = Math.max(1, (bw + bh) * 0.25);
    if (!Number.isFinite(radius) || radius < 1) return;
    seeds.push({ x: cx, y: cy, d: radius });
  };

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const start = y * width + x;
      if (!mask[start] || visited[start]) continue;

      let head = 0;
      let tail = 0;
      visited[start] = 1;
      qx[tail] = x;
      qy[tail] = y;
      tail += 1;

      let count = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;

      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head += 1;
        count += 1;
        sumX += cx;
        sumY += cy;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1) continue;
            const ni = ny * width + nx;
            if (!mask[ni] || visited[ni]) continue;
            visited[ni] = 1;
            qx[tail] = nx;
            qy[tail] = ny;
            tail += 1;
          }
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const ccx = Math.round(sumX / Math.max(1, count));
      const ccy = Math.round(sumY / Math.max(1, count));
      pushSeed(ccx, ccy, bw, bh, count);
    }
  }

  return seeds;
};

const splitPeaksWithMarkerWatershed = (
  mask: Uint8Array,
  dist: Float32Array,
  width: number,
  height: number,
  peaks: Peak[]
): Peak[] => {
  if (peaks.length < 2) return peaks;
  const labels = new Int32Array(width * height);
  const active: number[] = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) active.push(i);
  }
  if (active.length === 0) return peaks;

  peaks.forEach((p, idx) => {
    const x = Math.max(0, Math.min(width - 1, Math.round(p.x)));
    const y = Math.max(0, Math.min(height - 1, Math.round(p.y)));
    const i = y * width + x;
    if (mask[i]) labels[i] = idx + 1;
  });

  active.sort((a, b) => dist[b] - dist[a]);
  const neighbors = [
    -width - 1, -width, -width + 1,
    -1, 1,
    width - 1, width, width + 1,
  ];
  const collectLabels = (i: number) => {
    const uniq = new Set<number>();
    const x = i % width;
    if (x === 0 || x === width - 1) return uniq;
    for (const off of neighbors) {
      const ni = i + off;
      if (ni < 0 || ni >= labels.length) continue;
      const l = labels[ni];
      if (l > 0) uniq.add(l);
    }
    return uniq;
  };

  for (const i of active) {
    if (labels[i] > 0) continue;
    const uniq = collectLabels(i);
    if (uniq.size === 1) {
      labels[i] = Array.from(uniq)[0];
    } else if (uniq.size > 1) {
      labels[i] = -1;
    }
  }

  for (let iter = 0; iter < 2; iter += 1) {
    for (const i of active) {
      if (labels[i] > 0) continue;
      const uniq = collectLabels(i);
      if (uniq.size === 1) labels[i] = Array.from(uniq)[0];
    }
    for (let k = active.length - 1; k >= 0; k -= 1) {
      const i = active[k];
      if (labels[i] > 0) continue;
      const uniq = collectLabels(i);
      if (uniq.size === 1) labels[i] = Array.from(uniq)[0];
    }
  }

  const best = new Map<number, { i: number; d: number }>();
  for (const i of active) {
    const label = labels[i];
    if (label <= 0) continue;
    const d = dist[i];
    const prev = best.get(label);
    if (!prev || d > prev.d) best.set(label, { i, d });
  }
  if (best.size < 2) return peaks;
  const split: Peak[] = [];
  best.forEach((v) => {
    split.push({
      x: v.i % width,
      y: Math.floor(v.i / width),
      d: v.d,
    });
  });
  split.sort((a, b) => b.d - a.d);
  return split;
};

const estimateRadiusWithHough = (
  cx: number,
  cy: number,
  distVal: number,
  edge: Uint8Array,
  width: number,
  height: number
) => {
  const rMin = Math.max(1, distVal * 0.7);
  const rMax = Math.max(rMin + 1, distVal * 1.8);
  let bestR = distVal;
  let bestScore = -1;
  const step = (rMax - rMin) / Math.max(4, HOUGH_RADIUS_SCAN_STEPS);
  for (let r = rMin; r <= rMax; r += step) {
    let votes = 0;
    let samples = 0;
    for (let a = 0; a < 360; a += 12) {
      const rad = (a * Math.PI) / 180;
      const x = Math.round(cx + Math.cos(rad) * r);
      const y = Math.round(cy + Math.sin(rad) * r);
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      samples += 1;
      votes += edge[y * width + x];
    }
    if (samples < 8) continue;
    const score = votes / samples;
    if (score > bestScore) {
      bestScore = score;
      bestR = r;
    }
  }
  return bestR;
};

const refineCenterSubpixel = (
  cx: number,
  cy: number,
  gray: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number
) => {
  const r = SUBPIXEL_WINDOW_RADIUS;
  let sumW = 0;
  let sumX = 0;
  let sumY = 0;
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const idx = y * width + x;
      if (!mask[idx]) continue;
      const w = 256 - gray[idx];
      sumW += w;
      sumX += x * w;
      sumY += y * w;
    }
  }
  if (sumW <= 0) return { x: cx, y: cy };
  return { x: sumX / sumW, y: sumY / sumW };
};

const resolveOverlaps = (circles: RhinestoneCircle[], gapPx: number, minCenterDistPx = 0) => {
  for (let iter = 0; iter < 8; iter += 1) {
    let moved = 0;
    for (let i = 0; i < circles.length; i += 1) {
      for (let j = i + 1; j < circles.length; j += 1) {
        const a = circles[i];
        const b = circles[j];
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
        const minD = Math.max(a.r + b.r + gapPx, minCenterDistPx);
        if (d >= minD) continue;
        const push = (minD - d) * 0.5;
        const ux = dx / d;
        const uy = dy / d;
        a.cx -= ux * push;
        a.cy -= uy * push;
        b.cx += ux * push;
        b.cy += uy * push;
        moved += push;
      }
    }
    if (moved < 0.001) break;
  }
};

const countMinCenterDistanceViolations = (circles: RhinestoneCircle[], minCenterDistPx: number) => {
  if (minCenterDistPx <= 0 || circles.length < 2) return 0;
  let count = 0;
  const min2 = minCenterDistPx * minCenterDistPx;
  for (let i = 0; i < circles.length; i += 1) {
    for (let j = i + 1; j < circles.length; j += 1) {
      const dx = circles[i].cx - circles[j].cx;
      const dy = circles[i].cy - circles[j].cy;
      if (dx * dx + dy * dy < min2) count += 1;
    }
  }
  return count;
};

const enforceMinCenterDistanceByScore = (circles: RhinestoneCircle[], minCenterDistPx: number) => {
  if (minCenterDistPx <= 0 || circles.length < 2) return circles;
  const scoreOf = (c: RhinestoneCircle) =>
    c.confidence - (c.fitResidualPx / Math.max(0.5, c.r)) - (c.precisionMode ?0.06 : 0);
  const sorted = [...circles].sort((a, b) => scoreOf(b) - scoreOf(a));
  const kept: RhinestoneCircle[] = [];
  
  // Büyük taşlarda biraz daha esnek et: minCenterDistPx'i 0.95 oranında azalt
  const avgRadius = circles.reduce((sum, c) => sum + c.r, 0) / Math.max(1, circles.length);
  const flexFactor = avgRadius > 15 ? 0.95 : 1.0;
  const minCenterDistPxFlexed = minCenterDistPx * flexFactor;
  const min2 = minCenterDistPxFlexed * minCenterDistPxFlexed;
  
  for (const c of sorted) {
    let conflict = false;
    for (const k of kept) {
      const dx = c.cx - k.cx;
      const dy = c.cy - k.cy;
      if (dx * dx + dy * dy < min2) {
        conflict = true;
        break;
      }
    }
    if (!conflict) kept.push(c);
  }
  return kept;
};

const collectEdgeRingPoints = (
  cx: number,
  cy: number,
  radius: number,
  edge: Uint8Array,
  width: number,
  height: number
) => {
  const points: Array<{ x: number; y: number }> = [];
  const ring = Math.max(1.4, radius * 0.4);
  const minR = Math.max(1, radius - ring);
  const maxR = radius + ring;
  const x0 = Math.max(1, Math.floor(cx - maxR - 1));
  const x1 = Math.min(width - 2, Math.ceil(cx + maxR + 1));
  const y0 = Math.max(1, Math.floor(cy - maxR - 1));
  const y1 = Math.min(height - 2, Math.ceil(cy + maxR + 1));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!edge[y * width + x]) continue;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= minR && d <= maxR) {
        points.push({ x, y });
      }
    }
  }
  return points;
};

const fitCircleLeastSquares = (points: Array<{ x: number; y: number }>) => {
  if (points.length < 6) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sz = 0;
  let sxz = 0;
  let syz = 0;

  for (const p of points) {
    const x = p.x;
    const y = p.y;
    const z = x * x + y * y;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sz += z;
    sxz += x * z;
    syz += y * z;
  }

  const n = points.length;
  const a11 = sxx;
  const a12 = sxy;
  const a13 = sx;
  const a21 = sxy;
  const a22 = syy;
  const a23 = sy;
  const a31 = sx;
  const a32 = sy;
  const a33 = n;
  const b1 = -sxz;
  const b2 = -syz;
  const b3 = -sz;

  const det =
    a11 * (a22 * a33 - a23 * a32) -
    a12 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * a32 - a22 * a31);
  if (Math.abs(det) < 1e-9) return null;

  const detA =
    b1 * (a22 * a33 - a23 * a32) -
    a12 * (b2 * a33 - a23 * b3) +
    a13 * (b2 * a32 - a22 * b3);
  const detB =
    a11 * (b2 * a33 - a23 * b3) -
    b1 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * b3 - b2 * a31);
  const detC =
    a11 * (a22 * b3 - b2 * a32) -
    a12 * (a21 * b3 - b2 * a31) +
    b1 * (a21 * a32 - a22 * a31);

  const A = detA / det;
  const B = detB / det;
  const C = detC / det;
  const cx = -A / 2;
  const cy = -B / 2;
  const r2 = cx * cx + cy * cy - C;
  if (!Number.isFinite(r2) || r2 <= 0) return null;
  const r = Math.sqrt(r2);
  return { cx, cy, r };
};

const computeFitResidualPx = (points: Array<{ x: number; y: number }>, cx: number, cy: number, r: number) => {
  if (points.length === 0) return r;
  let acc = 0;
  for (const p of points) {
    const d = Math.hypot(p.x - cx, p.y - cy);
    acc += Math.abs(d - r);
  }
  return acc / points.length;
};

const buildCircleConfidence = (
  edgePts: Array<{ x: number; y: number }>,
  fitResidualPx: number,
  radiusPx: number
) => {
  const ringCirc = 2 * Math.PI * Math.max(0.5, radiusPx);
  const edgeDensity = Math.max(0, Math.min(1, edgePts.length / Math.max(8, ringCirc)));
  const residualNorm = Math.max(0, Math.min(1, 1 - fitResidualPx / Math.max(0.5, radiusPx * 0.45)));
  const circularity = Math.max(0, Math.min(1, 1 - fitResidualPx / Math.max(0.3, radiusPx * 0.35)));
  const radiusVariance = Math.max(0, Math.min(1, 1 - Math.min(1, fitResidualPx / Math.max(0.4, radiusPx))));
  return edgeDensity * 0.3 + circularity * 0.3 + radiusVariance * 0.2 + residualNorm * 0.2;
};

const detectOverlaps = (circles: RhinestoneCircle[], pxPerMm: number, spacingToleranceMm: number): OverlapIssue[] => {
  const issues: OverlapIssue[] = [];
  for (let i = 0; i < circles.length; i += 1) {
    for (let j = i + 1; j < circles.length; j += 1) {
      const a = circles[i];
      const b = circles[j];
      const dPx = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      const dMm = dPx / pxPerMm;
      const minMm = (a.r + b.r) / pxPerMm + spacingToleranceMm;
      if (dMm < minMm) {
        issues.push({ i, j, distanceMm: dMm, minAllowedMm: minMm });
      }
    }
  }
  return issues;
};

const pruneOverlapsByScore = (circles: RhinestoneCircle[], minGapPx = 0) => {
  if (circles.length < 2) return circles;
  const scoreOf = (c: RhinestoneCircle) =>
    c.confidence - (c.fitResidualPx / Math.max(0.5, c.r)) - (c.precisionMode ?0.04 : 0);
  const sorted = [...circles].sort((a, b) => scoreOf(b) - scoreOf(a));
  const kept: RhinestoneCircle[] = [];
  for (const c of sorted) {
    let overlaps = false;
    for (const k of kept) {
      const d = Math.hypot(c.cx - k.cx, c.cy - k.cy);
      // Daha hassas overlap hesaplaması: küçük taşlar için 0.94, büyük taşlar için 0.97
      const overlapFactor = Math.max(c.r, k.r) > 15 ? 0.97 : 0.94;
      const minD = (c.r + k.r) * overlapFactor + minGapPx;
      if (d < minD) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) kept.push(c);
  }
  return kept;
};

const computeMedian = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ?(sorted[mid - 1] + sorted[mid]) * 0.5
    : sorted[mid];
};

const applyGridEngine = (circles: RhinestoneCircle[], holeDiameterPx: number = 0) => {
  if (circles.length < 20) return circles;
  const scoreOf = (c: RhinestoneCircle) => c.confidence - (c.fitResidualPx / Math.max(0.5, c.r));
  const medianR = computeMedian(circles.map((c) => c.r));
  
  // Dinamik Grid: holeDiameter'a bağlı hücre boyutu
  // Eğer holeDiameterPx > 0 ise, bunu temel al; aksi halde medianR'ı kullan
  let cellSize = medianR * 2.4;
  if (holeDiameterPx > 0) {
    // Gap (boşluk) = 0.15 * holeDiameterPx (opsiyonel, ayarlanabilir)
    const gap = holeDiameterPx * 0.15;
    cellSize = Math.max(1, holeDiameterPx + gap);
  }
  
  const minNN = Math.max(0.6, medianR * 0.7);
  const cell = cellSize;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < circles.length; i += 1) {
    const c = circles[i];
    const gx = Math.floor(c.cx / cell);
    const gy = Math.floor(c.cy / cell);
    const key = `${gx}:${gy}`;
    const bucket = grid.get(key) ?? [];
    bucket.push(i);
    grid.set(key, bucket);
  }

  const nearest: number[] = [];
  for (let i = 0; i < circles.length; i += 1) {
    const c = circles[i];
    const gx = Math.floor(c.cx / cell);
    const gy = Math.floor(c.cy / cell);
    let best = Number.POSITIVE_INFINITY;
    for (let ix = gx - 1; ix <= gx + 1; ix += 1) {
      for (let iy = gy - 1; iy <= gy + 1; iy += 1) {
        const bucket = grid.get(`${ix}:${iy}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (i === j) continue;
          const d = Math.hypot(c.cx - circles[j].cx, c.cy - circles[j].cy);
          if (d >= minNN && d < best) best = d;
        }
      }
    }
    if (Number.isFinite(best)) nearest.push(best);
  }
  
  // Dinamik pitch hesaplaması: holeDiameterPx'e dayalı
  let pitch = nearest.length > 20 ? computeMedian(nearest) : Math.max(1.1, medianR * 2.0);
  if (holeDiameterPx > 0) {
    // Merkez mesafesi = holeDiameter + gap
    const gap = holeDiameterPx * 0.15; // %15 boşluk
    const dynamicPitch = holeDiameterPx + gap;
    // Mevcut pitch'i dinamik pitch'e doğru kademeli kontrol et
    pitch = pitch * 0.4 + dynamicPitch * 0.6;
  }

  const snap = (c: RhinestoneCircle, type: "hex" | "square") => {
    const rowStep = type === "hex" ?pitch * 0.8660254 : pitch;
    
    // Scaling faktörü: holeDiameterPx'e bağlı
    let scaleFactor = 1;
    if (holeDiameterPx > 0) {
      const defaultPitch = medianR * 2;
      const dynamicPitch = holeDiameterPx + (holeDiameterPx * 0.15);
      scaleFactor = dynamicPitch / Math.max(0.1, defaultPitch);
    }
    
    let gx = 0;
    let gy = 0;
    let sx = c.cx;
    let sy = c.cy;
    if (type === "square") {
      gx = Math.round(c.cx / pitch);
      gy = Math.round(c.cy / rowStep);
      sx = gx * pitch * scaleFactor;
      sy = gy * rowStep * scaleFactor;
    } else {
      gy = Math.round(c.cy / rowStep);
      const offset = Math.abs(gy) % 2 === 1 ?pitch * 0.5 : 0;
      gx = Math.round((c.cx - offset) / pitch);
      sx = (gx * pitch + offset) * scaleFactor;
      sy = gy * rowStep * scaleFactor;
    }
    return { gx, gy, sx, sy, dist: Math.hypot(sx - c.cx, sy - c.cy) };
  };

  const sample = [...circles].sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 420);
  const avgErr = (type: "hex" | "square") =>
    sample.reduce((acc, c) => acc + snap(c, type).dist, 0) / Math.max(1, sample.length);
  const hexErr = avgErr("hex");
  const sqErr = avgErr("square");
  const gridType: "hex" | "square" = sqErr < hexErr * 0.94 ? "square" : "hex";

  const cv = nearest.length > 2
    ?Math.sqrt(nearest.reduce((a, d) => a + (d - pitch) * (d - pitch), 0) / nearest.length) / Math.max(1e-6, pitch)
    : 0.2;
  const snapStrength = Math.max(0.34, Math.min(0.82, 0.72 - cv * 0.7));
  const maxSnapDist = Math.max(0.7, pitch * 0.44);
  const kept = new Map<string, RhinestoneCircle>();
  const passthrough: RhinestoneCircle[] = [];

  for (const c of circles) {
    const q = snap(c, gridType);
    if (q.dist > maxSnapDist) {
      passthrough.push(c);
      continue;
    }
    const blended: RhinestoneCircle = {
      ...c,
      cx: c.cx * (1 - snapStrength) + q.sx * snapStrength,
      cy: c.cy * (1 - snapStrength) + q.sy * snapStrength,
      precisionMode: c.precisionMode || snapStrength > 0.74,
    };
    const key = `${q.gx}:${q.gy}`;
    const prev = kept.get(key);
    if (!prev || scoreOf(blended) > scoreOf(prev)) kept.set(key, blended);
  }

  const out = [...Array.from(kept.values()), ...passthrough];
  const retainRatio = out.length / Math.max(1, circles.length);
  const pitchToRadius = pitch / Math.max(0.5, medianR);
  const unstableGrid = cv > 0.22;
  const invalidPitch = pitchToRadius < 1.55 || pitchToRadius > 4.9;
  const overPruned = retainRatio < 0.9;
  if (overPruned || (unstableGrid && retainRatio < 0.95) || invalidPitch) {
    console.log(
      `[grid] bypass reason=${
        overPruned ? "over_pruned" : unstableGrid && retainRatio < 0.95 ? "unstable_grid" : "invalid_pitch"
      } type=${gridType} pitch=${pitch.toFixed(3)} cv=${cv.toFixed(3)} keep=${out.length}/${circles.length}`
    );
    return circles;
  }
  console.log(
    `[grid] auto type=${gridType} pitch=${pitch.toFixed(3)} snap=${snapStrength.toFixed(3)} input=${circles.length} output=${out.length}`
  );
  return out;
};

const applyRadiusPrior = (circles: RhinestoneCircle[]) => {
  if (circles.length < RADIUS_PRIOR_MIN_SAMPLES) return circles;
  const radii = circles.map((c) => c.r);
  const median = computeMedian(radii);
  const mad = computeMedian(radii.map((r) => Math.abs(r - median)));
  if (!Number.isFinite(mad) || mad < 0.08) return circles;

  const low = Math.max(MIN_TARGET_RADIUS_PX * 0.8, median - RADIUS_PRIOR_MAD_FACTOR * mad);
  const high = median + (RADIUS_PRIOR_MAD_FACTOR + 0.8) * mad;
  const hardHigh = high * 1.45;
  const kept: RhinestoneCircle[] = [];
  for (const c of circles) {
    const outlier = c.r < low || c.r > high;
    if (outlier) {
      const delta = Math.abs(c.r - median);
      c.precisionMode = true;
      c.confidence *= 0.72;
      c.fitResidualPx += (delta / Math.max(0.2, mad)) * 0.22;
      c.radiusErrorMm += delta * 0.004;
    }
    if (c.r > hardHigh && c.confidence < 0.72) continue;
    kept.push(c);
  }
  return kept;
};

const circleIntersectionRatio = (a: RhinestoneCircle, b: RhinestoneCircle) => {
  const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
  const r1 = a.r;
  const r2 = b.r;
  if (d >= r1 + r2) return 0;
  const minArea = Math.PI * Math.min(r1, r2) * Math.min(r1, r2);
  if (d <= Math.abs(r1 - r2)) return 1;
  const alpha = 2 * Math.acos(Math.max(-1, Math.min(1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))));
  const beta = 2 * Math.acos(Math.max(-1, Math.min(1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))));
  const area1 = 0.5 * r1 * r1 * (alpha - Math.sin(alpha));
  const area2 = 0.5 * r2 * r2 * (beta - Math.sin(beta));
  const overlapArea = area1 + area2;
  return minArea > 0 ?overlapArea / minArea : 0;
};

const repairSevereOverlaps = (
  circles: RhinestoneCircle[],
  gray: Uint8Array,
  mask: Uint8Array,
  dist: Float32Array,
  edges: Uint8Array,
  width: number,
  height: number,
  globalScale: number,
  baseTargetR: number,
  maxSafeR: number,
  pxPerMm: number
) => {
  if (circles.length < 2) return circles;
  const work = [...circles];
  const severePairs: Array<{ i: number; j: number; ratio: number }> = [];
  for (let i = 0; i < work.length; i += 1) {
    for (let j = i + 1; j < work.length; j += 1) {
      const ratio = circleIntersectionRatio(work[i], work[j]);
      if (ratio >= OVERLAP_RECHECK_RATIO) {
        severePairs.push({ i, j, ratio });
      }
    }
  }
  severePairs.sort((a, b) => b.ratio - a.ratio);
  if (severePairs.length === 0) return work;

  for (const pair of severePairs) {
    const a = work[pair.i];
    const b = work[pair.j];
    if (!a || !b) continue;
    const margin = Math.max(4, Math.round(Math.max(a.r, b.r) * OVERLAP_RECHECK_MARGIN_FACTOR));
    const minX = Math.max(1, Math.floor(Math.min(a.cx - a.r, b.cx - b.r) - margin));
    const maxX = Math.min(width - 2, Math.ceil(Math.max(a.cx + a.r, b.cx + b.r) + margin));
    const minY = Math.max(1, Math.floor(Math.min(a.cy - a.r, b.cy - b.r) - margin));
    const maxY = Math.min(height - 2, Math.ceil(Math.max(a.cy + a.r, b.cy + b.r) + margin));
    const roiW = maxX - minX + 1;
    const roiH = maxY - minY + 1;
    if (roiW < 8 || roiH < 8) continue;

    const localMask = new Uint8Array(roiW * roiH);
    const localDist = new Float32Array(roiW * roiH);
    for (let y = 0; y < roiH; y += 1) {
      const gy = minY + y;
      for (let x = 0; x < roiW; x += 1) {
        const gx = minX + x;
        const li = y * roiW + x;
        const gi = gy * width + gx;
        localMask[li] = mask[gi];
        localDist[li] = dist[gi];
      }
    }
    const localPeaks = splitPeaksWithMarkerWatershed(
      localMask,
      localDist,
      roiW,
      roiH,
      findDistancePeaks(localDist, localMask, roiW, roiH)
    ).slice(0, 5);
    if (localPeaks.length < 2) continue;

    const replacements: RhinestoneCircle[] = [];
    for (const p of localPeaks) {
      const gx = minX + p.x;
      const gy = minY + p.y;
      const initial = refineCenterSubpixel(gx, gy, gray, mask, width, height);
      const houghR = estimateRadiusWithHough(initial.x, initial.y, p.d, edges, width, height);
      const edgePts = collectEdgeRingPoints(initial.x, initial.y, houghR, edges, width, height);
      const fitted = fitCircleLeastSquares(edgePts);
      const finalCx = fitted ?(initial.x * 0.6 + fitted.cx * 0.4) : initial.x;
      const finalCy = fitted ?(initial.y * 0.6 + fitted.cy * 0.4) : initial.y;
      const finalRPx = fitted ?(houghR * 0.6 + fitted.r * 0.4) : houghR;
      const mappedR = finalRPx * globalScale;
      const normalizedR = mappedR * 0.45 + baseTargetR * 0.55;
      const minR = Math.max(MIN_TARGET_RADIUS_PX, baseTargetR * 0.72);
      const maxR = Math.max(minR + 0.15, Math.min(maxSafeR, baseTargetR * 1.28));
      const finalR = Math.max(minR, Math.min(maxR, normalizedR));
      const fitResidualPx = computeFitResidualPx(edgePts, finalCx, finalCy, finalRPx);
      const confidence = buildCircleConfidence(edgePts, fitResidualPx, Math.max(0.5, finalRPx));
      const centerErrorMm = Math.hypot(finalCx - initial.x, finalCy - initial.y) / pxPerMm;
      const radiusErrorMm = Math.abs(finalRPx - houghR) / pxPerMm;
      replacements.push({
        cx: finalCx,
        cy: finalCy,
        r: finalR,
        color: "rgb(255,255,255)",
        layerSize: sizeLayerName((finalR * 2) / pxPerMm),
        layerColor: "COLOR_WHITE",
        centerErrorMm,
        radiusErrorMm,
        confidence,
        fitResidualPx,
        precisionMode: true,
      });
    }

    if (replacements.length < 2) continue;
    replacements.sort((c1, c2) =>
      (c2.confidence - c2.fitResidualPx / Math.max(0.5, c2.r)) -
      (c1.confidence - c1.fitResidualPx / Math.max(0.5, c1.r))
    );
    const first = replacements[0];
    const second = replacements.find((c) => {
      const d = Math.hypot(c.cx - first.cx, c.cy - first.cy);
      return d > Math.max(1, (c.r + first.r) * 0.55);
    });
    if (!first || !second) continue;
    work[pair.i] = first;
    work[pair.j] = second;
  }
  return work;
};

const sizeLayerName = (diameterMm: number) => {
  const normalized = Math.max(0.1, diameterMm);
  return `SIZE_${normalized.toFixed(2)}MM`;
};

const applyGrayWorldWhiteBalance = (rgbData: Buffer | Uint8Array, channels: number) => {
  if (channels < 3) return new Uint8Array(rgbData);
  const out = new Uint8Array(rgbData.length);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  const count = Math.max(1, Math.floor(rgbData.length / channels));
  for (let i = 0; i < rgbData.length; i += channels) {
    sumR += rgbData[i];
    sumG += rgbData[i + 1];
    sumB += rgbData[i + 2];
  }
  const avgR = sumR / count;
  const avgG = sumG / count;
  const avgB = sumB / count;
  const gray = (avgR + avgG + avgB) / 3;
  const gainR = avgR > 0 ? gray / avgR : 1;
  const gainG = avgG > 0 ? gray / avgG : 1;
  const gainB = avgB > 0 ? gray / avgB : 1;
  for (let i = 0; i < rgbData.length; i += channels) {
    out[i] = Math.max(0, Math.min(255, Math.round(rgbData[i] * gainR)));
    out[i + 1] = Math.max(0, Math.min(255, Math.round(rgbData[i + 1] * gainG)));
    out[i + 2] = Math.max(0, Math.min(255, Math.round(rgbData[i + 2] * gainB)));
    for (let c = 3; c < channels; c += 1) out[i + c] = rgbData[i + c];
  }
  return out;
};

const normalizeRgbBrightness = (rgbData: Uint8Array, channels: number) => {
  if (channels < 3) return rgbData;
  const luminance = new Uint8Array(Math.floor(rgbData.length / channels));
  for (let i = 0, p = 0; i < rgbData.length; i += channels, p += 1) {
    luminance[p] = Math.round(0.299 * rgbData[i] + 0.587 * rgbData[i + 1] + 0.114 * rgbData[i + 2]);
  }
  const sorted = Array.from(luminance).sort((a, b) => a - b);
  const p5 = sorted[Math.floor(sorted.length * 0.05)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 255;
  const low = Math.min(p5, p95 - 1);
  const high = Math.max(low + 1, p95);
  const scale = 255 / (high - low);
  const out = new Uint8Array(rgbData.length);
  for (let i = 0; i < rgbData.length; i += channels) {
    out[i] = Math.max(0, Math.min(255, Math.round((rgbData[i] - low) * scale)));
    out[i + 1] = Math.max(0, Math.min(255, Math.round((rgbData[i + 1] - low) * scale)));
    out[i + 2] = Math.max(0, Math.min(255, Math.round((rgbData[i + 2] - low) * scale)));
    for (let c = 3; c < channels; c += 1) out[i + c] = rgbData[i + c];
  }
  return out;
};

const sampleCircleColor = (
  rgbData: Buffer | Uint8Array,
  rgbChannels: number,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number
) => {
  if (rgbChannels < 3 || width <= 0 || height <= 0) return "rgb(255,255,255)";
  const rWin = Math.max(1, Math.min(3, Math.round(radius * 0.2)));
  let accR = 0;
  let accG = 0;
  let accB = 0;
  let accW = 0;
  for (let dy = -rWin; dy <= rWin; dy += 1) {
    for (let dx = -rWin; dx <= rWin; dx += 1) {
      const x = Math.max(0, Math.min(width - 1, Math.round(cx + dx)));
      const y = Math.max(0, Math.min(height - 1, Math.round(cy + dy)));
      const idx = (y * width + x) * rgbChannels;
      const pr = rgbData[idx];
      const pg = rgbData[idx + 1];
      const pb = rgbData[idx + 2];
      const w = 1 / (1 + dx * dx + dy * dy);
      accR += pr * w;
      accG += pg * w;
      accB += pb * w;
      accW += w;
    }
  }
  const rr = Math.max(0, Math.min(255, Math.round(accR / Math.max(1e-6, accW))));
  const gg = Math.max(0, Math.min(255, Math.round(accG / Math.max(1e-6, accW))));
  const bb = Math.max(0, Math.min(255, Math.round(accB / Math.max(1e-6, accW))));
  return `rgb(${rr},${gg},${bb})`;
};

const buildRhinestoneCircles = async (
  patternMeta: PatternMeta,
  inputPath: string,
  options: ProcessOptions
) : Promise<RhinestoneBuildResult> => {
  const isPdfInput = path.extname(inputPath).toLowerCase() === ".pdf";
  let rasterSource = inputPath;

  const sizeCode = (patternMeta.sizeCode ?? "").toUpperCase();
  const isSmallStoneCode = sizeCode === "SS4" || sizeCode === "SS6";
  const originalPng = await sharp(toSharpInput(rasterSource)).png().toBuffer();
  const controlNetPng = options.useControlNet ?await tryControlNetEnhance(originalPng) : null;
  if (options.useControlNet) {
    console.log(
      `[rhinestone] controlnet ${controlNetPng ?"applied" : "skipped"}`
    );
  }
  const sourcePng = controlNetPng ??originalPng;
  const base = sharp(sourcePng);
  const meta = await base.metadata();
  const lossyInput = isLossyRasterPath(rasterSource);
  const scale = IMAGE_SCALE;
  const targetWidth = meta.width ?Math.round(meta.width * scale) : undefined;
  const targetHeight = meta.height ?Math.round(meta.height * scale) : undefined;

  let prep = base
    .clone()
    .resize(targetWidth, targetHeight, { kernel: "lanczos3" })
    .removeAlpha()
    .toColorspace("srgb");
  if (lossyInput) {
    // Keep JPEG outputs stable while preserving circle boundaries.
    prep = prep.median(1).sharpen(1.1, 1, 2);
  }
  const { data: rawRgbData, info: rawRgbInfo } = await prep.raw().toBuffer({ resolveWithObject: true });

  const width = rawRgbInfo.width;
  const height = rawRgbInfo.height;
  const rgbChannels = 3;
  const normalizedRgb = new Uint8Array(rawRgbData);
  const grayBuffer = await sharp(normalizedRgb, { raw: { width, height, channels: rgbChannels } })
    .greyscale()
    .normalize()
    .blur(isPdfInput ? 0.7 : (lossyInput ? 0.5 : 0.8))
    .raw()
    .toBuffer();
  const gray = new Uint8Array(grayBuffer);
  const pixelCount = width * height;
  let lSum = 0;
  let lSqSum = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    const g = gray[i];
    lSum += g;
    lSqSum += g * g;
  }
  const saturation = new Uint8Array(pixelCount);
  let satSum = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    const idx = i * rgbChannels;
    const r = normalizedRgb[idx];
    const g = normalizedRgb[idx + 1];
    const b = normalizedRgb[idx + 2];
    const s = Math.max(r, g, b) - Math.min(r, g, b);
    saturation[i] = s;
    satSum += s;
  }

  const grayMean = lSum / Math.max(1, pixelCount);
  const grayVar = Math.max(0, lSqSum / Math.max(1, pixelCount) - grayMean * grayMean);
  const grayStd = Math.sqrt(grayVar);
  const satMean = satSum / Math.max(1, pixelCount);
  const adaptiveSensitivity = Math.max(
    0,
    Math.min(
      100,
      Number(options.stoneSensitivity ??50) +
        (grayStd < 34 ?6 : 0) +
        (grayMean < 70 || grayMean > 190 ?4 : 0)
    )
  );
  const openIters = Math.max(0, MORPH_OPEN_ITERS + (grayStd < 28 ? 1 : 0) - (lossyInput ? 1 : 0));
  const closeIters = MORPH_CLOSE_ITERS + (grayStd < 22 ? 1 : 0) + (lossyInput ? 1 : 0);
  const buildDetectionState = (thresholdMask: Uint8Array) => {
    const morphMask = dilateBinary(
      erodeBinary(
        dilateBinary(
          erodeBinary(thresholdMask, width, height, openIters),
          width,
          height,
          openIters
        ),
        width,
        height,
        closeIters
      ),
      width,
      height,
      closeIters
    );
    const dist = computeDistanceTransform(morphMask, width, height);
    const rawPeaks = (() => {
      if (!isPdfInput) return findDistancePeaks(dist, morphMask, width, height);
      const componentPeaks = findComponentPeaks(morphMask, width, height);
      const distancePeaks = findDistancePeaks(dist, morphMask, width, height);
      if (distancePeaks.length === 0) return componentPeaks;
      if (componentPeaks.length === 0) return distancePeaks;
      const merged = [...componentPeaks];
      // Increased from 9 (3px) to 36 (6px) for dense PDF patterns
      // Prevents false duplicate detection in dense stone arrangements
      // Use componentPeaks.length for density check (rawPeaks not yet defined)
      const mergeThresholdSq = componentPeaks.length > 150 ? 36 : 16;
      for (const p of distancePeaks) {
        let near = false;
        for (const c of componentPeaks) {
          const dx = p.x - c.x;
          const dy = p.y - c.y;
          if (dx * dx + dy * dy <= mergeThresholdSq) {
            near = true;
            break;
          }
        }
        if (!near) merged.push(p);
      }
      return merged;
    })();
    const useWatershedSplit = grayStd < 36 || rawPeaks.length > 900;
    const peaks = useWatershedSplit
      ?splitPeaksWithMarkerWatershed(morphMask, dist, width, height, rawPeaks)
      : rawPeaks;
    return { morphMask, dist, rawPeaks, peaks, useWatershedSplit };
  };

  const classicBaseMask = buildAutoContrastBinaryMask(gray, width, height, options.threshold, adaptiveSensitivity);
  const classicMask = isPdfInput
    ?classicBaseMask
    : buildChromaAwareMask(classicBaseMask, gray, saturation, width, height, adaptiveSensitivity);
  const { morphMask, dist, rawPeaks, peaks, useWatershedSplit } = buildDetectionState(classicMask);
  const edges = sobelEdges(gray, width, height);
  console.log(
    `[rhinestone] seeds=${rawPeaks.length} split=${useWatershedSplit ?peaks.length : rawPeaks.length} std=${grayStd.toFixed(2)} sat=${satMean.toFixed(2)} mode=classic_auto_contrast`
  );

  if (peaks.length === 0) {
    const productionTolerance = getAdaptiveProductionTolerance(sizeCode);
    return {
      circles: [],
      width: meta.width ??width,
      height: meta.height ??height,
      pxPerMm: 1,
      report: {
        pxPerMm: 1,
        avgCenterErrorMm: 0,
        avgRadiusErrorMm: 0,
        maxDeviationMm: 0,
        outOfToleranceCount: 0,
        lowConfidenceCount: 0,
        overlapCount: 0,
        overlaps: [],
        productionReady: false,
        productionMessage: "No circles detected",
        tolerance: {
          centerMm: TARGET_CENTER_TOLERANCE_MM,
          radiusMm: TARGET_RADIUS_TOLERANCE_MM,
        },
        assessments: {
          strict: {
            ready: false,
            outOfToleranceCount: 0,
            tolerance: {
              centerMm: TARGET_CENTER_TOLERANCE_MM,
              radiusMm: TARGET_RADIUS_TOLERANCE_MM,
            },
          },
          production: {
            ready: false,
            outOfToleranceCount: 0,
            tolerance: {
              centerMm: productionTolerance.centerMm,
              radiusMm: productionTolerance.radiusMm,
            },
          },
        },
      },
    };
  }

  const sourceMm = patternMeta.vectorDiameterMm ??DEFAULT_VECTOR_DIAMETER_MM;
  const calibratedPxPerMm =
    Number(options.calibrationDiameterPx) > 0 && Number(options.calibrationDiameterMm) > 0
      ?(Number(options.calibrationDiameterPx) * scale) / Number(options.calibrationDiameterMm)
      : null;
  const envFixedPxPerMmRaw = Number(process.env.RHINESTONE_FIXED_PX_PER_MM);
  const envFixedPxPerMm = Number.isFinite(envFixedPxPerMmRaw) && envFixedPxPerMmRaw > 0
    ?envFixedPxPerMmRaw
    : null;
  const widthBasedPxPerMm = options.realWidthMm && meta.width
    ?Math.max(0.2, width / Math.max(1, options.realWidthMm))
    : null;

  let pxPerMm = DEFAULT_FIXED_PX_PER_MM;
  let pxPerMmSource = "default_fixed";
  if (calibratedPxPerMm) {
    pxPerMm = Math.max(0.2, calibratedPxPerMm);
    pxPerMmSource = "calibration_diameter";
  } else if (envFixedPxPerMm) {
    pxPerMm = Math.max(0.2, envFixedPxPerMm);
    pxPerMmSource = "env_fixed";
  } else if (widthBasedPxPerMm) {
    pxPerMm = Math.max(0.2, widthBasedPxPerMm);
    pxPerMmSource = "real_width";
  }
  console.log(`[rhinestone] scale pxPerMm=${pxPerMm.toFixed(4)} source=${pxPerMmSource}`);
  const sizeCodeTargetMm = SIZE_CODE_VECTOR_MM[sizeCode];
  const targetMm = options.targetVectorDiameterMm ??sizeCodeTargetMm ??sourceMm;
  const globalScale = Math.max(0.35, Math.min(2.4, targetMm / Math.max(0.1, sourceMm)));
  const maxSafeR = Math.max(3, Math.min(width, height) * 0.04);
  const baseTargetR = Math.min(maxSafeR, Math.max(MIN_TARGET_RADIUS_PX, (targetMm * pxPerMm) / 2));
  const circles: RhinestoneCircle[] = [];
  for (const p of peaks) {
    const initial = refineCenterSubpixel(p.x, p.y, gray, morphMask, width, height);
    const houghR = estimateRadiusWithHough(initial.x, initial.y, p.d, edges, width, height);
    let finalCx = initial.x;
    let finalCy = initial.y;
    let finalRPx = houghR;
    let precisionMode = false;
    const usePrecision = options.autoPrecision !== false && houghR < 8;
    const edgePts = collectEdgeRingPoints(initial.x, initial.y, houghR, edges, width, height);
    if (usePrecision) {
      const fitted = fitCircleLeastSquares(edgePts);
      if (fitted) {
        finalCx = fitted.cx;
        finalCy = fitted.cy;
        finalRPx = fitted.r;
        precisionMode = true;
      }
    } else {
      const fitted = fitCircleLeastSquares(edgePts);
      if (fitted) {
        finalCx = (initial.x * 0.65) + (fitted.cx * 0.35);
        finalCy = (initial.y * 0.65) + (fitted.cy * 0.35);
        finalRPx = (houghR * 0.6) + (fitted.r * 0.4);
      }
    }

    const mappedR = finalRPx * globalScale;
    const targetDrivenMinR = Math.max(MIN_TARGET_RADIUS_PX, baseTargetR * 0.45);
    const targetDrivenMaxR = Math.max(targetDrivenMinR + 0.2, Math.min(maxSafeR, baseTargetR * 2.1));
    const shapeDrivenMinR = Math.max(MIN_TARGET_RADIUS_PX, mappedR * 0.72);
    const shapeDrivenMaxR = Math.max(shapeDrivenMinR + 0.2, Math.min(maxSafeR, mappedR * 1.45));
    const minR = lossyInput ?Math.min(shapeDrivenMinR, targetDrivenMinR) : targetDrivenMinR;
    const maxR = lossyInput ?Math.max(shapeDrivenMaxR, targetDrivenMaxR) : targetDrivenMaxR;
    const unclampedR = Math.max(minR, Math.min(maxR, mappedR));
    const targetR = (targetMm * pxPerMm) / 2;
    const lockBandRatio = sizeCodeTargetMm
      ?(sizeCode === "SS4" || sizeCode === "SS6" ?0.07 : 0.1)
      : 0.12;
    const softMin = Math.max(minR, targetR * (1 - lockBandRatio));
    const softMax = Math.min(maxR, targetR * (1 + lockBandRatio));
    const lockAlpha = sizeCodeTargetMm
      ?(sizeCode === "SS4" || sizeCode === "SS6" ?0.76 : 0.58)
      : 0.32;
    const blendedR = unclampedR * (1 - lockAlpha) + targetR * lockAlpha;
    let finalR = Math.max(softMin, Math.min(softMax, blendedR));
    if (isPdfInput) {
      // Keep PDF stone sizes close to selected SS target to avoid radius scatter.
      const pdfLockRatio = isSmallStoneCode ?0.1 : 0.14;
      const minPdfR = targetR * (1 - pdfLockRatio);
      const maxPdfR = targetR * (1 + pdfLockRatio);
      finalR = Math.max(minPdfR, Math.min(maxPdfR, finalR));
    }
    const centerErrorMm = Math.hypot(finalCx - initial.x, finalCy - initial.y) / pxPerMm;
    const radiusErrorFromFitMm = Math.abs(finalRPx - houghR) / pxPerMm;
    const radiusErrorFromTargetMm = Math.abs(finalR - targetR) / pxPerMm;
    const targetRadiusWeight = sizeCodeTargetMm
      ?sizeCode === "SS4" || sizeCode === "SS6"
        ?0.82
        : 0.75
      : 0;
    const radiusErrorMm = sizeCodeTargetMm
      ?radiusErrorFromTargetMm * targetRadiusWeight + radiusErrorFromFitMm * (1 - targetRadiusWeight)
      : radiusErrorFromFitMm;
    const fitResidualPx = computeFitResidualPx(edgePts, finalCx, finalCy, finalRPx);
    const confidence = buildCircleConfidence(edgePts, fitResidualPx, Math.max(0.5, finalRPx));
    const sampledColor = sampleCircleColor(
      normalizedRgb,
      rgbChannels,
      width,
      height,
      finalCx,
      finalCy,
      finalR
    );

    circles.push({
      cx: finalCx,
      cy: finalCy,
      r: finalR,
      color: sampledColor,
      layerSize: sizeLayerName((finalR * 2) / pxPerMm),
      layerColor: undefined,
      centerErrorMm,
      radiusErrorMm,
      confidence,
      fitResidualPx,
      precisionMode,
    });
  }

  let filteredByQuality = circles.filter((c) => {
    if (!isPdfInput) return true;
    const residualLimit = isSmallStoneCode ?Math.max(1.25, c.r * 0.62) : Math.max(1.2, c.r * 0.62);
    const confidenceLimit = isSmallStoneCode ?0.42 : 0.34;
    const radiusErrLimit = isSmallStoneCode ?0.09 : 0.12;
    return (
      c.confidence >= confidenceLimit &&
      c.fitResidualPx <= residualLimit &&
      c.radiusErrorMm <= radiusErrLimit
    );
  });
  if (isPdfInput && filteredByQuality.length < 24 && circles.length > 0) {
    // Controlled fallback: loosen only when strict pass under-detects.
    filteredByQuality = circles.filter((c) => {
      const residualLimit = isSmallStoneCode ?Math.max(1.6, c.r * 0.88) : Math.max(1.25, c.r * 0.72);
      const confidenceLimit = isSmallStoneCode ?0.26 : 0.3;
      const radiusErrLimit = isSmallStoneCode ?0.14 : 0.18;
      return (
        c.confidence >= confidenceLimit &&
        c.fitResidualPx <= residualLimit &&
        c.radiusErrorMm <= radiusErrLimit
      );
    });
    if (filteredByQuality.length === 0) filteredByQuality = circles;
  }

  const sortedCandidates = [...filteredByQuality].sort((a, b) => {
    const qa = a.confidence - (a.fitResidualPx / Math.max(0.5, a.r));
    const qb = b.confidence - (b.fitResidualPx / Math.max(0.5, b.r));
    return qb - qa;
  });

  let deduped: RhinestoneCircle[] = [];
  for (const c of sortedCandidates) {
    let duplicate = false;
    for (const d of deduped) {
      const dx = c.cx - d.cx;
      const dy = c.cy - d.cy;
      const minCenterDist = isPdfInput
        ?Math.max(1.8, (c.r + d.r) * (isSmallStoneCode ?1.15 : 0.95))
        : Math.max(1, Math.min(c.r, d.r) * 0.5);
      if (dx * dx + dy * dy <= minCenterDist * minCenterDist) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) deduped.push(c);
  }
  if (isPdfInput && deduped.length > 0) {
    const preGridMinCenterDist = Math.max(1.8, baseTargetR * (isSmallStoneCode ?2.15 : 1.9));
    deduped = enforceMinCenterDistanceByScore(deduped, preGridMinCenterDist);
  }

  const preOverlap = detectOverlaps(
    deduped,
    pxPerMm,
    Math.max(0, Number(options.spacingToleranceMm ??0))
  );
  const overlapRatio = preOverlap.length / Math.max(1, deduped.length);
  if (overlapRatio > 0.06) {
    deduped = repairSevereOverlaps(
      deduped,
      gray,
      morphMask,
      dist,
      edges,
      width,
      height,
      globalScale,
      baseTargetR,
      maxSafeR,
      pxPerMm
    );
  }

  const holePx = Math.max(0, (patternMeta.holeDiameterMm ??0) * pxPerMm);
  let griddedCircles = applyGridEngine(deduped, holePx);
  const minGapPx = Math.max(
    holePx * 0.5,
    Math.max(0.05, Number(options.spacingToleranceMm ??0.05)) * pxPerMm
  );
  const safetyGapMm = SS_SAFETY_GAP_MM[sizeCode] ??0.2;
  const spacingAggression = SS_SPACING_AGGRESSION[sizeCode] ??1.0;
  const holeDiameterMm = Math.max(0.1, patternMeta.holeDiameterMm ??(targetMm + 0.2));
  const minCenterDistPx = (holeDiameterMm + safetyGapMm) * pxPerMm * spacingAggression;
  const spacingViolBefore = countMinCenterDistanceViolations(griddedCircles, minCenterDistPx);
  let spacingViolAfterResolve = spacingViolBefore;
  resolveOverlaps(griddedCircles, minGapPx, minCenterDistPx);
  spacingViolAfterResolve = countMinCenterDistanceViolations(griddedCircles, minCenterDistPx);
  griddedCircles = enforceMinCenterDistanceByScore(griddedCircles, minCenterDistPx);
  let spacingViolAfterPrune = countMinCenterDistanceViolations(griddedCircles, minCenterDistPx);
  if (spacingAggression > 1.08 && spacingViolAfterPrune > 0) {
    // For larger SS codes, run a second stricter pass to avoid hidden stacking.
    griddedCircles = enforceMinCenterDistanceByScore(griddedCircles, minCenterDistPx * 1.06);
    spacingViolAfterPrune = countMinCenterDistanceViolations(griddedCircles, minCenterDistPx);
  }
  if (isPdfInput && griddedCircles.length === 0 && deduped.length > 0) {
    griddedCircles = deduped;
    spacingViolAfterPrune = countMinCenterDistanceViolations(griddedCircles, minCenterDistPx);
  }
  if (isPdfInput && rawPeaks.length > 0) {
    const maxBySeeds = Math.max(24, Math.round(rawPeaks.length * (isSmallStoneCode ?1.45 : 1.35)));
    if (griddedCircles.length > maxBySeeds) {
      const tightenedMinCenterDist = Math.max(
        minCenterDistPx * 1.12,
        baseTargetR * (isSmallStoneCode ?2.25 : 1.9)
      );
      griddedCircles = enforceMinCenterDistanceByScore(griddedCircles, tightenedMinCenterDist);
      if (griddedCircles.length > maxBySeeds) {
        const scoreOf = (c: RhinestoneCircle) =>
          c.confidence - (c.fitResidualPx / Math.max(0.5, c.r)) - (c.precisionMode ?0.04 : 0);
        griddedCircles = [...griddedCircles]
          .sort((a, b) => scoreOf(b) - scoreOf(a))
          .slice(0, maxBySeeds);
      }
      spacingViolAfterPrune = countMinCenterDistanceViolations(griddedCircles, minCenterDistPx);
      console.log(
        `[pdf-guard] seeds=${rawPeaks.length} limited=${maxBySeeds} final=${griddedCircles.length}`
      );
    }
  }
  console.log(
    `[spacing] mode=legacy ss=${sizeCode || "NA"} aggr=${spacingAggression.toFixed(2)} minCenterDistPx=${minCenterDistPx.toFixed(3)} before=${spacingViolBefore} afterResolve=${spacingViolAfterResolve} afterPrune=${spacingViolAfterPrune} count=${griddedCircles.length}`
  );

  for (const c of griddedCircles) {
    if (
      c.centerErrorMm > TARGET_CENTER_TOLERANCE_MM ||
      c.radiusErrorMm > TARGET_RADIUS_TOLERANCE_MM
    ) {
      c.precisionMode = true;
    }
  }

  const spacingToleranceMm = Math.max(0, Number(options.spacingToleranceMm ??0));
  const overlaps = detectOverlaps(griddedCircles, pxPerMm, spacingToleranceMm);

  for (const c of griddedCircles) {
    c.cx = Math.min(width - c.r, Math.max(c.r, c.cx));
    c.cy = Math.min(height - c.r, Math.max(c.r, c.cy));
    c.cx /= scale;
    c.cy /= scale;
    c.r /= scale;
  }

  const outputPxPerMm = pxPerMm / scale;
  const outputWidth = meta.width ??width;
  const outputHeight = meta.height ??height;
  const constrainedByRegion = (options.rhinestoneRegions && options.rhinestoneRegions.length > 0)
    ?griddedCircles.filter((c) =>
        pointInAnyNormalizedRegion(c.cx, c.cy, outputWidth, outputHeight, options.rhinestoneRegions ??[])
      )
    : griddedCircles;
  const allowedDiametersMm = (options.rhinestoneSizeCodes ?? [])
    .map((code) => SIZE_CODE_VECTOR_MM[String(code).toUpperCase()])
    .filter((mm): mm is number => Number.isFinite(mm) && mm > 0);
  const constrainedCircles =
    allowedDiametersMm.length > 0
      ?constrainedByRegion.filter((c) => {
          const circleDiameterMm = (c.r * 2) / outputPxPerMm;
          return allowedDiametersMm.some((targetMm) => {
            const toleranceMm = Math.max(0.12, targetMm * 0.16);
            return Math.abs(circleDiameterMm - targetMm) <= toleranceMm;
          });
        })
      : constrainedByRegion;

  const avgCenterErrorMm =
    constrainedCircles.length > 0 ?constrainedCircles.reduce((acc, c) => acc + c.centerErrorMm, 0) / constrainedCircles.length : 0;
  const avgRadiusErrorMm =
    constrainedCircles.length > 0 ?constrainedCircles.reduce((acc, c) => acc + c.radiusErrorMm, 0) / constrainedCircles.length : 0;
  const maxDeviationMm = constrainedCircles.reduce(
    (m, c) => Math.max(m, c.centerErrorMm, c.radiusErrorMm),
    0
  );
  const strictOutOfToleranceCount = constrainedCircles.filter(
    (c) =>
      c.centerErrorMm > TARGET_CENTER_TOLERANCE_MM ||
      c.radiusErrorMm > TARGET_RADIUS_TOLERANCE_MM
  ).length;
  const productionTolerance = getAdaptiveProductionTolerance(sizeCode);
  const productionOutOfToleranceCount = constrainedCircles.filter(
    (c) =>
      c.centerErrorMm > productionTolerance.centerMm ||
      c.radiusErrorMm > productionTolerance.radiusMm
  ).length;
  const lowConfidenceCount = constrainedCircles.filter((c) => c.confidence < LOW_CONFIDENCE_THRESHOLD).length;
  const productionReady = productionOutOfToleranceCount === 0;
  const productionMessage = productionReady
    ?`Bu tasarim production-safe tolerans (${productionTolerance.radiusMm.toFixed(2)} mm) ile uretime uygundur.`
    : "Bu tasarim tolerans disi taslar iceriyor. Precision mode veya kaynak kalite iyilestirmesi onerilir.";
  console.log(
    `[rhinestone] circles=${constrainedCircles.length} pxPerMm=${pxPerMm.toFixed(4)} avgCenterErrMm=${avgCenterErrorMm.toFixed(4)} avgRadiusErrMm=${avgRadiusErrorMm.toFixed(4)}`
  );
  return {
    circles: constrainedCircles,
    width: outputWidth,
    height: outputHeight,
    pxPerMm: outputPxPerMm,
    report: {
      pxPerMm: outputPxPerMm,
      avgCenterErrorMm,
      avgRadiusErrorMm,
      maxDeviationMm,
      outOfToleranceCount: strictOutOfToleranceCount,
      lowConfidenceCount,
      overlapCount: overlaps.length,
      overlaps,
      productionReady,
      productionMessage,
      tolerance: {
        centerMm: TARGET_CENTER_TOLERANCE_MM,
        radiusMm: TARGET_RADIUS_TOLERANCE_MM,
      },
      assessments: {
        strict: {
          ready: strictOutOfToleranceCount === 0,
          outOfToleranceCount: strictOutOfToleranceCount,
          tolerance: {
            centerMm: TARGET_CENTER_TOLERANCE_MM,
            radiusMm: TARGET_RADIUS_TOLERANCE_MM,
          },
        },
        production: {
          ready: productionOutOfToleranceCount === 0,
          outOfToleranceCount: productionOutOfToleranceCount,
          tolerance: {
            centerMm: productionTolerance.centerMm,
            radiusMm: productionTolerance.radiusMm,
          },
        },
      },
    },
  };
};

const convertPdfToPngWithPython = async (inputPath: string, options?: ProcessOptions) => {
  const filename = path.basename(inputPath, path.extname(inputPath));
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pdf-png-worker-"));
  const tempPngPath = path.join(tempDir, `${filename}.png`);

  try {
    const pdfDpi = normalizePdfDpi(options?.pdfDpi);
    await runPython(inputPath, tempPngPath, pdfDpi);

    if (!fs.existsSync(tempPngPath)) {
      throw new StageError("python", "PNG created check failed");
    }
    console.log("PNG CREATED", tempPngPath);

    return { tempDir, tempPngPath };
  } catch (error) {
    if (error instanceof StageError) throw error;
    throw new StageError("python", error instanceof Error ? error.message : String(error));
  }
};

const processImageWorker = async (payload: WorkerInput) => {
  const { patternMeta, inputPath, options } = payload;
  const filename = path.basename(inputPath, path.extname(inputPath));
  const outputSvgPath = path.join("public/processed", `${filename}.svg`);
  const outputDxfPath = path.join("public/processed", `${filename}.dxf`);
  const outputPdfPath = path.join("public/processed", `${filename}.pdf`);
  const outputReportPath = path.join("public/processed", `${filename}.report.json`);

  await fsp.mkdir("public/processed", { recursive: true });

  let svg: string;
  const category = patternMeta.category ??"pattern";
  const isRhinestone = category === "rhinestone";
  const isHybrid = category === "hybrid";
  const patternRegions = options.patternRegions ?? [];
  const rhinestoneRegions = options.rhinestoneRegions ?? [];
  const hasPatternSelection = patternRegions.length > 0;
  const hasRhinestoneSelection = rhinestoneRegions.length > 0;
  let circleResult:
    | RhinestoneBuildResult
    | null = null;
  let hybridCircles: RhinestoneCircle[] = [];
  const isPdfInput = path.extname(inputPath).toLowerCase() === ".pdf";
  let workingInputPath = inputPath;
  let pdfTempDirToCleanup: string | null = null;

  if (isPdfInput) {
    const converted = await convertPdfToPngWithPython(inputPath, options);
    workingInputPath = converted.tempPngPath;
    pdfTempDirToCleanup = converted.tempDir;
  }

  try {
    if (isRhinestone || isHybrid) {
      circleResult = await buildRhinestoneCircles(patternMeta, workingInputPath, options);
      console.log(
        `[processImageWorker] circleResult built: circles=${circleResult?.circles.length ?? 0}, ` +
        `width=${circleResult?.width}, height=${circleResult?.height}`
      );
      if (isHybrid) {
        const hasRhinestoneSizeSelection = (options.rhinestoneSizeCodes?.length ?? 0) > 0;
        hybridCircles = hasRhinestoneSelection || hasRhinestoneSizeSelection
          ?[...circleResult.circles]
          : [];
      }
    }

  if (isRhinestone) {
    const rh = circleResult;
    console.log(`[processImageWorker] isRhinestone=true, rh.circles.length=${rh?.circles.length ?? 0}`);
    if (rh && rh.circles.length > 0) {
      const svgParts = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${rh.width}" height="${rh.height}" viewBox="0 0 ${rh.width} ${rh.height}" preserveAspectRatio="xMidYMid meet">`,
        `<g fill="none" stroke-width="${Math.max(0.25, SVG_STROKE_WIDTH * 0.7)}" vector-effect="non-scaling-stroke">`,
        ...rh.circles.map((c) => `<circle cx="${c.cx.toFixed(2)}" cy="${c.cy.toFixed(2)}" r="${c.r.toFixed(2)}" stroke="${c.color}" fill="none" />`),
        `</g>`,
        `</svg>`,
      ];
      svg = svgParts.join("");
    } else {
      throw new StageError(
        "rhinestone",
        "Rhinestone circle detection failed (0 circles). Try threshold/sensitivity or higher resolution image."
      );
    }
  } else {
    const shouldTracePatternLayer = !isHybrid || hasPatternSelection || !hasRhinestoneSelection;
    if (shouldTracePatternLayer) {
      svg = await tracePatternSvg(
        workingInputPath,
        isHybrid && circleResult
          ?{
              excludeCircles: hybridCircles,
              includeRegions: patternRegions,
            }
          : {}
      );
    } else if (circleResult) {
      svg = buildEmptySvgCanvas(circleResult.width, circleResult.height);
    } else {
      svg = await tracePatternSvg(workingInputPath);
    }
  }

  const outlinedSvg = isRhinestone
    ?circleResult && circleResult.circles.length > 0
      ?svg
      : svg
          .replace(/fill="(#000000|black)"/gi, 'fill="none"')
          .replace(
            /stroke="none"/gi,
            `stroke="#ffffff" stroke-width="${SVG_STROKE_WIDTH}" vector-effect="non-scaling-stroke"`
          )
    : svg
        .replace(/fill="(#000000|black)"/gi, 'fill="none"')
        .replace(
          /stroke="none"/gi,
          'stroke="#000000" stroke-width="1" vector-effect="non-scaling-stroke"'
        );

  const normalizedSvg = normalizeSvg(outlinedSvg);
  const circularizedSvg = isRhinestone
    ?normalizedSvg
    : isHybrid
      ?normalizedSvg
    : Boolean(options.normalizeStones)
      ?circularizeNearCircles(circularizeNearCircles(normalizedSvg, true), true)
      : normalizedSvg;

  const basePatternPolylines = !isRhinestone ?extractPolylinesFromSvg(circularizedSvg) : [];
  const mergedHybridCircles = isHybrid ?hybridCircles : [];
  const mergedPatternPolylines = basePatternPolylines;

  const finalSvg = isHybrid
    ?appendRhinestoneCirclesToSvg(circularizedSvg, mergedHybridCircles)
    : circularizedSvg;

  try {
    await fsp.writeFile(outputSvgPath, finalSvg);
  } catch (err) {
    const message = err instanceof Error ?err.message : "SVG write error";
    throw new StageError("svg", message);
  }

  try {
    if (isRhinestone && circleResult && circleResult.circles.length > 0) {
      const rh = circleResult;
      const dxfCircles: DxfCircle[] = rh.circles.map((c) => ({
        cx: c.cx / rh.pxPerMm,
        cy: c.cy / rh.pxPerMm,
        r: c.r / rh.pxPerMm,
        layer: c.layerColor ??"RHINESTONE",
      }));
      const dxf = generateDxfR12FromCircles(dxfCircles);
      await fsp.writeFile(outputDxfPath, dxf);
    } else if (isHybrid && circleResult) {
      const rh = circleResult;
      const dxfCircles: DxfCircle[] = mergedHybridCircles.map((c) => ({
        cx: c.cx / rh.pxPerMm,
        cy: c.cy / rh.pxPerMm,
        r: c.r / rh.pxPerMm,
        layer: c.layerColor ??"RHINESTONE",
      }));
      const dxf = generateDxfR12FromMixed(dxfCircles, mergedPatternPolylines);
      await fsp.writeFile(outputDxfPath, dxf);
    } else {
      const dxf = generateDxfR12FromPolylines(mergedPatternPolylines);
      await fsp.writeFile(outputDxfPath, dxf);
    }
  } catch (err) {
    const message = err instanceof Error ?err.message : "DXF write error";
    throw new StageError("dxf", message);
  }

  try {
    await writePdfFromSvg(finalSvg, outputPdfPath);
  } catch (err) {
    const message = err instanceof Error ?err.message : "PDF write error";
    throw new StageError("pdf", message);
  }

  if ((isRhinestone || isHybrid) && circleResult) {
    try {
      await fsp.writeFile(outputReportPath, JSON.stringify(circleResult.report, null, 2), "utf8");
    } catch (err) {
      const message = err instanceof Error ?err.message : "Report write error";
      throw new StageError("report", message);
    }
  }

    return {
      svgUrl: `/processed/${filename}.svg`,
      dxfUrl: `/processed/${filename}.dxf`,
      reportUrl: isRhinestone || isHybrid ?`/processed/${filename}.report.json` : undefined,
    };
  } finally {
    if (pdfTempDirToCleanup) {
      await fsp.rm(pdfTempDirToCleanup, { recursive: true, force: true });
    }
  }
};

const run = async () => {
  const payload = workerData as WorkerInput;
  try {
    const result = await processImageWorker(payload);
    const message: WorkerSuccess = { ok: true, ...result };
    parentPort?.postMessage(message);
  } catch (err) {
    if (err instanceof StageError) {
      const failure: WorkerFailure = { ok: false, stage: err.stage, message: err.message };
      parentPort?.postMessage(failure);
      return;
    }
    const message = err instanceof Error ?err.message : "Unknown error";
    const failure: WorkerFailure = { ok: false, stage: "worker", message };
    parentPort?.postMessage(failure);
  }
};

void run();
