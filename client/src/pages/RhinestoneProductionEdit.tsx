import { useEffect, useMemo, useRef, useState } from "react";
import { InfoHint } from "@/components/InfoHint";
import { useI18n } from "@/i18n";
import { withApiBase } from "@/lib/api-base";
import { usePatterns } from "@/hooks/use-patterns";
import { useMachineControl } from "../hooks/useMachineControl";
import { useLocation } from "wouter"; // Sayfa değiştirmek için gerekli
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;


type StoneRule = {
  key: string;
  label: string;
  labelKey: string;
  color: string;
  diameterMm: number;
  holeMm: number;
  speed: number;
  pressure: number;
  dxfColor: number;
};

type Stone = {
  id: number;
  x: number;
  y: number;
  r: number;
  layer: string;
  colorIndex: number;
  ruleKey: string | null;
  customColor?: string | null;
};

type DxfPrimitive =
  | { kind: "line"; layer: string; color?: string; x1: number; y1: number; x2: number; y2: number }
  | { kind: "circle"; layer: string; color?: string; cx: number; cy: number; r: number }
  | { kind: "arc"; layer: string; color?: string; cx: number; cy: number; r: number; startDeg: number; endDeg: number }
  | { kind: "polyline"; layer: string; color?: string; points: Array<{ x: number; y: number }>; closed: boolean };

type DragContext = {
  mode: "none" | "pan" | "move";
  startMouseX: number;
  startMouseY: number;
  moved: boolean;
  historyPushed: boolean;
  selectedIds: Set<number>;
  originById: Map<number, { x: number; y: number }>;
  patternPrimitiveIds: Set<number>;
};

// Güncellenmiş Renk-Boyut Kuralları
const RULES: StoneRule[] = [

  { 
    key: "ss16_red", 
    label: "SS16 Red", 
    labelKey: "ss16_red_label",
    color: "#ef4444", 
    diameterMm: 4.0, 
    holeMm: 4.2, 
    speed: 80, 
    pressure: 50, 
    dxfColor: 1 
  },
  { 
    key: "ss20_blue", 
    label: "SS20 Blue", 
    labelKey: "ss20_blue_label",
    color: "#3b82f6", 
    diameterMm: 4.8, 
    holeMm: 5.0, 
    speed: 75, 
    pressure: 55, 
    dxfColor: 5 
  },
  { 
    key: "ss30_green", 
    label: "SS30 Green", 
    labelKey: "ss30_green_label",
    color: "#22c55e", 
    diameterMm: 6.5, 
    holeMm: 6.7, 
    speed: 70, 
    pressure: 60, 
    dxfColor: 3 
  },
  { 
    key: "ss40_yellow", 
    label: "SS40 Yellow", 
    labelKey: "ss40_yellow_label",
    color: "#ffd900", 
    diameterMm: 8.5, 
    holeMm: 8.7, 
    speed: 65, 
    pressure: 65, 
    dxfColor: 7 
  },
  { 
    key: "ss10_white", 
    label: "SS10 White", 
    labelKey: "ss10_white_label",
    color: "#f8fafc", 
    diameterMm: 2.9, 
    holeMm: 3.1, 
    speed: 85, 
    pressure: 45, 
    dxfColor: 7 
  },
  { 
    key: "ss6_pink", 
    label: "SS6 Pink", 
    labelKey: "ss6_pink_label",
    color: "#ec4899", 
    diameterMm: 2.1, 
    holeMm: 2.3, 
    speed: 90, 
    pressure: 40, 
    dxfColor: 6 
  },
];

const normalizeRuleToken = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const inferRuleKeyFromLayerAndColor = (layer: string, colorIndex: number) => {
  const layerTokenRaw = layer.includes("__") ? layer.split("__").pop() ?? layer : layer;
  const layerToken = normalizeRuleToken(layerTokenRaw.replace(/^color_/, ""));
  const exact = RULES.find((r) => normalizeRuleToken(r.key) === layerToken);
  if (exact) return exact.key;
  const byName = RULES.find((r) => normalizeRuleToken(r.label).includes(layerToken) || layerToken.includes(normalizeRuleToken(r.label)));
  if (byName) return byName.key;
  const byColor = RULES.find((r) => r.dxfColor === colorIndex);
  if (byColor) return byColor.key;
  return null;
};

// ==================== GÖRÜNTÜ İŞLEME FONKSİYONLARI ====================


// DXF parsing
const toDxfNumber = (value: string) => {
  const normalized = value.replace(",", ".").trim();
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
};

const insunitsToMmFactor = (insunits: number) => {
  const map: Record<number, number> = {
    0: 1,
    1: 25.4,
    2: 304.8,
    4: 1,
    5: 10,
    6: 1000,
    9: 0.0254,
    10: 914.4,
    14: 100,
  };
  return map[insunits] ?? 1;
};

const parseDxfCircles = (text: string): Stone[] => {
  const raw = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const pairs: Array<{ code: string; value: string }> = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    pairs.push({ code: raw[i], value: raw[i + 1] });
  }

  let insunits = 4;
  for (let i = 0; i < pairs.length - 1; i += 1) {
    if (pairs[i].code === "9" && pairs[i].value === "$INSUNITS") {
      for (let j = i + 1; j < Math.min(i + 8, pairs.length); j += 1) {
        if (pairs[j].code === "70") {
          const parsed = toDxfNumber(pairs[j].value);
          if (Number.isFinite(parsed)) insunits = parsed;
          break;
        }
      }
      break;
    }
  }
  const unitFactor = insunitsToMmFactor(insunits);

  const circles: Stone[] = [];
  for (let i = 0; i < pairs.length; i += 1) {
    if (pairs[i].code !== "0" || pairs[i].value.toUpperCase() !== "CIRCLE") continue;

    let x = NaN;
    let y = NaN;
    let r = NaN;
    let layer = "0";
    let colorIndex = 7;

    let j = i + 1;
    for (; j < pairs.length; j += 1) {
      if (pairs[j].code === "0") break;
      const { code, value } = pairs[j];
      if (code === "8") layer = value || "0";
      if (code === "62") {
        const c = toDxfNumber(value);
        if (Number.isFinite(c)) colorIndex = c;
      }
      if (code === "10") x = toDxfNumber(value);
      if (code === "20") y = toDxfNumber(value);
      if (code === "40") r = toDxfNumber(value);
    }

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r) || r <= 0) {
      i = j - 1;
      continue;
    }

    circles.push({
      id: circles.length + 1,
      x: x * unitFactor,
      y: y * unitFactor,
      r: r * unitFactor,
      layer,
      colorIndex,
      ruleKey: inferRuleKeyFromLayerAndColor(layer, colorIndex),
      customColor: null,
    });
    i = j - 1;
  }
  return circles;
};

const parseDxfPrimitives = (text: string): DxfPrimitive[] => {
  const raw = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const pairs: Array<{ code: string; value: string }> = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    pairs.push({ code: raw[i], value: raw[i + 1] });
  }

  let insunits = 4;
  for (let i = 0; i < pairs.length - 1; i += 1) {
    if (pairs[i].code === "9" && pairs[i].value === "$INSUNITS") {
      for (let j = i + 1; j < Math.min(i + 8, pairs.length); j += 1) {
        if (pairs[j].code === "70") {
          const parsed = toDxfNumber(pairs[j].value);
          if (Number.isFinite(parsed)) insunits = parsed;
          break;
        }
      }
      break;
    }
  }
  const unitFactor = insunitsToMmFactor(insunits);
  const primitives: DxfPrimitive[] = [];

  for (let i = 0; i < pairs.length; i += 1) {
    if (pairs[i].code !== "0") continue;
    const entity = pairs[i].value.toUpperCase();
    if (!["LINE", "CIRCLE", "ARC", "LWPOLYLINE", "POLYLINE"].includes(entity)) continue;

    let j = i + 1;
    if (entity === "LINE") {
      let layer = "0";
      let x1 = NaN;
      let y1 = NaN;
      let x2 = NaN;
      let y2 = NaN;
      for (; j < pairs.length; j += 1) {
        if (pairs[j].code === "0") break;
        const { code, value } = pairs[j];
        if (code === "8") layer = value || "0";
        if (code === "10") x1 = toDxfNumber(value);
        if (code === "20") y1 = toDxfNumber(value);
        if (code === "11") x2 = toDxfNumber(value);
        if (code === "21") y2 = toDxfNumber(value);
      }
      if (Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2)) {
        primitives.push({
          kind: "line",
          layer,
          x1: x1 * unitFactor,
          y1: y1 * unitFactor,
          x2: x2 * unitFactor,
          y2: y2 * unitFactor,
        });
      }
      i = j - 1;
      continue;
    }

    if (entity === "CIRCLE") {
      let layer = "0";
      let cx = NaN;
      let cy = NaN;
      let r = NaN;
      for (; j < pairs.length; j += 1) {
        if (pairs[j].code === "0") break;
        const { code, value } = pairs[j];
        if (code === "8") layer = value || "0";
        if (code === "10") cx = toDxfNumber(value);
        if (code === "20") cy = toDxfNumber(value);
        if (code === "40") r = toDxfNumber(value);
      }
      if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(r) && r > 0) {
        primitives.push({
          kind: "circle",
          layer,
          cx: cx * unitFactor,
          cy: cy * unitFactor,
          r: r * unitFactor,
        });
      }
      i = j - 1;
      continue;
    }

    if (entity === "ARC") {
      let layer = "0";
      let cx = NaN;
      let cy = NaN;
      let r = NaN;
      let startDeg = 0;
      let endDeg = 0;
      for (; j < pairs.length; j += 1) {
        if (pairs[j].code === "0") break;
        const { code, value } = pairs[j];
        if (code === "8") layer = value || "0";
        if (code === "10") cx = toDxfNumber(value);
        if (code === "20") cy = toDxfNumber(value);
        if (code === "40") r = toDxfNumber(value);
        if (code === "50") startDeg = toDxfNumber(value);
        if (code === "51") endDeg = toDxfNumber(value);
      }
      if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(r) && r > 0) {
        primitives.push({
          kind: "arc",
          layer,
          cx: cx * unitFactor,
          cy: cy * unitFactor,
          r: r * unitFactor,
          startDeg: Number.isFinite(startDeg) ? startDeg : 0,
          endDeg: Number.isFinite(endDeg) ? endDeg : 0,
        });
      }
      i = j - 1;
      continue;
    }

    if (entity === "LWPOLYLINE") {
      let layer = "0";
      const xs: number[] = [];
      const ys: number[] = [];
      let closed = false;
      for (; j < pairs.length; j += 1) {
        if (pairs[j].code === "0") break;
        const { code, value } = pairs[j];
        if (code === "8") layer = value || "0";
        if (code === "10") xs.push(toDxfNumber(value));
        if (code === "20") ys.push(toDxfNumber(value));
        if (code === "70") {
          const flags = toDxfNumber(value);
          closed = Number.isFinite(flags) ? (flags & 1) === 1 : false;
        }
      }
      const points: Array<{ x: number; y: number }> = [];
      const n = Math.min(xs.length, ys.length);
      for (let k = 0; k < n; k += 1) {
        if (!Number.isFinite(xs[k]) || !Number.isFinite(ys[k])) continue;
        points.push({ x: xs[k] * unitFactor, y: ys[k] * unitFactor });
      }
      if (points.length >= 2) {
        primitives.push({ kind: "polyline", layer, points, closed });
      }
      i = j - 1;
      continue;
    }

    if (entity === "POLYLINE") {
      let layer = "0";
      let closed = false;
      for (; j < pairs.length; j += 1) {
        if (pairs[j].code === "0") break;
        const { code, value } = pairs[j];
        if (code === "8") layer = value || "0";
        if (code === "70") {
          const flags = toDxfNumber(value);
          closed = Number.isFinite(flags) ? (flags & 1) === 1 : false;
        }
      }

      const points: Array<{ x: number; y: number }> = [];
      let k = j;
      while (k < pairs.length) {
        if (pairs[k].code !== "0") {
          k += 1;
          continue;
        }
        const t = pairs[k].value.toUpperCase();
        if (t === "SEQEND") {
          k += 1;
          break;
        }
        if (t !== "VERTEX") {
          break;
        }
        let x = NaN;
        let y = NaN;
        let m = k + 1;
        for (; m < pairs.length; m += 1) {
          if (pairs[m].code === "0") break;
          if (pairs[m].code === "10") x = toDxfNumber(pairs[m].value);
          if (pairs[m].code === "20") y = toDxfNumber(pairs[m].value);
        }
        if (Number.isFinite(x) && Number.isFinite(y)) {
          points.push({ x: x * unitFactor, y: y * unitFactor });
        }
        k = m;
      }
      if (points.length >= 2) {
        primitives.push({ kind: "polyline", layer, points, closed });
      }
      i = k - 1;
    }
  }

  return primitives;
};

const sanitizeDetectedStones = (input: Stone[], expectedDiameterMm?: number): Stone[] => {
  if (input.length === 0) return input;

  const valid = input.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.r) && s.r > 0);
  if (valid.length === 0) return [];

  const radii = valid.map((s) => s.r).sort((a, b) => a - b);
  const medianR = radii[Math.floor(radii.length / 2)] || 0.1;
  const expectedR = Number.isFinite(expectedDiameterMm) ? Math.max(0.1, Number(expectedDiameterMm) / 2) : null;
  const baseR = expectedR ?? medianR;
  const minR = Math.max(0.18, baseR * 0.45);
  const maxR = Math.max(minR * 2.2, baseR * 2.4);

  const filtered = valid.filter((s) => s.r >= minR && s.r <= maxR);
  if (filtered.length === 0) return [];

  // Keep bigger circles first and drop near-duplicate centers.
  const sorted = [...filtered].sort((a, b) => b.r - a.r);
  const cell = Math.max(0.2, baseR * 1.0);
  const grid = new Map<string, Stone[]>();
  const deduped: Stone[] = [];

  for (const s of sorted) {
    const gx = Math.floor(s.x / cell);
    const gy = Math.floor(s.y / cell);
    let duplicate = false;
    for (let ix = gx - 1; ix <= gx + 1 && !duplicate; ix += 1) {
      for (let iy = gy - 1; iy <= gy + 1 && !duplicate; iy += 1) {
        const bucket = grid.get(`${ix}:${iy}`);
        if (!bucket) continue;
        for (const b of bucket) {
          const d = Math.hypot(s.x - b.x, s.y - b.y);
          const minDist = Math.max(0.25, Math.min(s.r, b.r) * 1.15, baseR * 0.55);
          if (d <= minDist) {
            duplicate = true;
            break;
          }
        }
      }
    }
    if (duplicate) continue;
    deduped.push(s);
    const key = `${gx}:${gy}`;
    const arr = grid.get(key) ?? [];
    arr.push(s);
    grid.set(key, arr);
  }

  let normalized = deduped;
  if (normalized.length > 10000) {
    const strongCell = Math.max(0.3, baseR * 1.3);
    const strongGrid = new Map<string, Stone[]>();
    const secondPass: Stone[] = [];
    for (const s of normalized) {
      const gx = Math.floor(s.x / strongCell);
      const gy = Math.floor(s.y / strongCell);
      let duplicate = false;
      for (let ix = gx - 1; ix <= gx + 1 && !duplicate; ix += 1) {
        for (let iy = gy - 1; iy <= gy + 1 && !duplicate; iy += 1) {
          const bucket = strongGrid.get(`${ix}:${iy}`);
          if (!bucket) continue;
          for (const b of bucket) {
            const d = Math.hypot(s.x - b.x, s.y - b.y);
            const minDist = Math.max(0.32, Math.min(s.r, b.r) * 1.35, baseR * 0.72);
            if (d <= minDist) {
              duplicate = true;
              break;
            }
          }
        }
      }
      if (duplicate) continue;
      secondPass.push(s);
      const key = `${gx}:${gy}`;
      const arr = strongGrid.get(key) ?? [];
      arr.push(s);
      strongGrid.set(key, arr);
    }
    normalized = secondPass;
  }

  return normalized.map((s, idx) => ({ ...s, id: idx + 1 }));
};

const detectCirclesFromImageData = (
  imageData: ImageData,
  width: number,
  height: number,
  mmPerPixel: number
): Stone[] => {
  const data = imageData.data;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const idx = i * 4;
    gray[i] = Math.round(data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114);
  }

  const threshold = 128;
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    binary[i] = gray[i] < threshold ? 1 : 0;
  }

  const visited = new Uint8Array(width * height);
  const stones: Stone[] = [];
  const queueX = new Int32Array(width * height);
  const queueY = new Int32Array(width * height);

  const dirs = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ] as const;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (!binary[idx] || visited[idx]) continue;

      let head = 0;
      let tail = 0;
      visited[idx] = 1;
      queueX[tail] = x;
      queueY[tail] = y;
      tail += 1;

      let count = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;

      while (head < tail) {
        const cx = queueX[head];
        const cy = queueY[head];
        head += 1;

        count += 1;
        sumX += cx;
        sumY += cy;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (const [dx, dy] of dirs) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (!binary[nIdx] || visited[nIdx]) continue;
          visited[nIdx] = 1;
          queueX[tail] = nx;
          queueY[tail] = ny;
          tail += 1;
        }
      }

      if (count < 10) continue;

      const centerX = sumX / count;
      const centerY = sumY / count;
      const bboxW = maxX - minX + 1;
      const bboxH = maxY - minY + 1;
      const aspect = Math.min(bboxW, bboxH) / Math.max(bboxW, bboxH);
      if (aspect < 0.65) continue;

      const radiusPx = Math.sqrt(count / Math.PI);
      const areaRatio = count / (Math.PI * radiusPx * radiusPx);
      if (areaRatio < 0.45 || areaRatio > 1.65) continue;

      stones.push({
        id: stones.length + 1,
        x: centerX * mmPerPixel,
        y: (height - centerY) * mmPerPixel,
        r: radiusPx * mmPerPixel,
        layer: "0",
        colorIndex: 7,
        ruleKey: null,
        customColor: null,
      });
    }
  }

  return stones;
};

const processPdfFileLocal = async (file: File): Promise<Stone[]> => {
  const bytes = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF canvas context olusturulamadi.");

  await page.render({
    canvasContext: ctx,
    viewport,
    canvas,
  }).promise;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const mmPerPixel = 0.3528 / 2; // 1pt=0.3528mm, scale=2
  return sanitizeDetectedStones(detectCirclesFromImageData(imageData, canvas.width, canvas.height, mmPerPixel), 2.9);
};

type UploadPatternResponse = {
  id: number;
};

type PatternStatusResponse = {
  status: "pending" | "processing" | "completed" | "failed";
  dxfUrl?: string | null;
  svgUrl?: string | null;
};

type EditorMode = "rhinestone" | "pattern";
type ImportMode = "pattern" | "rhinestone";

type PatternVectorPreview = {
  patternId: number;
  name: string;
  category: string;
  svgUrl?: string | null;
  dxfUrl?: string | null;
  pdfUrl?: string | null;
  previewUrl: string;
  isPdf: boolean;
};

type SavedEditorSession = {
  version: 1;
  savedAt: string;
  mode: EditorMode;
  importMode: ImportMode;
  zoom: number;
  pan: { x: number; y: number };
  patternStrokeWidth: number;
  fillMode: boolean;
  showSelection: boolean;
  activeRule: string;
  rhinestone: {
    stones: Stone[];
    selectedIds: number[];
    lastImportType: string;
  };
  pattern: {
    primitives: DxfPrimitive[];
    hiddenLayers: string[];
    selectedPrimitiveIds: number[];
    isolateSelection: boolean;
    preview: PatternVectorPreview | null;
    lastImportType: string;
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseSvgToPrimitives = (svgText: string): DxfPrimitive[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const primitives: DxfPrimitive[] = [];
  const readColor = (el: Element) =>
    el.getAttribute("stroke") || el.getAttribute("color") || "#111827";

  doc.querySelectorAll("line").forEach((el) => {
    const x1 = Number(el.getAttribute("x1") ?? "NaN");
    const y1 = Number(el.getAttribute("y1") ?? "NaN");
    const x2 = Number(el.getAttribute("x2") ?? "NaN");
    const y2 = Number(el.getAttribute("y2") ?? "NaN");
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      primitives.push({ kind: "line", layer: "SVG_LINE", color: readColor(el), x1, y1, x2, y2 });
    }
  });

  doc.querySelectorAll("circle").forEach((el) => {
    const cx = Number(el.getAttribute("cx") ?? "NaN");
    const cy = Number(el.getAttribute("cy") ?? "NaN");
    const r = Number(el.getAttribute("r") ?? "NaN");
    if ([cx, cy, r].every(Number.isFinite) && r > 0) {
      primitives.push({ kind: "circle", layer: "SVG_CIRCLE", color: readColor(el), cx, cy, r });
    }
  });

  doc.querySelectorAll("polyline,polygon").forEach((el) => {
    const pointsRaw = (el.getAttribute("points") ?? "").trim();
    if (!pointsRaw) return;
    const pts = pointsRaw
      .split(/\s+/)
      .map((pair) => pair.split(","))
      .filter((pair) => pair.length >= 2)
      .map(([x, y]) => ({ x: Number(x), y: Number(y) }))
      .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
    if (pts.length >= 2) {
      primitives.push({
        kind: "polyline",
        layer: "SVG_POLYLINE",
        color: readColor(el),
        points: pts,
        closed: el.tagName.toLowerCase() === "polygon",
      });
    }
  });

  doc.querySelectorAll("path").forEach((el) => {
    const d = el.getAttribute("d");
    if (!d) return;
    try {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      const total = path.getTotalLength();
      if (!Number.isFinite(total) || total <= 0) return;
      const steps = Math.max(12, Math.min(240, Math.ceil(total / 6)));
      const points: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= steps; i += 1) {
        const p = path.getPointAtLength((i / steps) * total);
        points.push({ x: p.x, y: p.y });
      }
      if (points.length >= 2) {
        primitives.push({
          kind: "polyline",
          layer: "SVG_PATH",
          color: readColor(el),
          points,
          closed: /z\s*$/i.test(d.trim()),
        });
      }
    } catch {
      return;
    }
  });

  return primitives;
};

type SvgCircleColor = {
  x: number;
  y: number;
  r: number;
  color: string;
};

const parseSvgCircleColors = (svgText: string): SvgCircleColor[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const circles: SvgCircleColor[] = [];
  doc.querySelectorAll("circle").forEach((el) => {
    const x = Number(el.getAttribute("cx") ?? "NaN");
    const y = Number(el.getAttribute("cy") ?? "NaN");
    const r = Number(el.getAttribute("r") ?? "NaN");
    const color = (el.getAttribute("stroke") ?? "").trim();
    if ([x, y, r].every(Number.isFinite) && r > 0 && color) {
      circles.push({ x, y, r, color });
    }
  });
  return circles;
};

const applySvgColorsToStones = (stones: Stone[], svgText: string): Stone[] => {
  const svgCircles = parseSvgCircleColors(svgText);
  if (!stones.length || !svgCircles.length) return stones;

  const stoneBounds = stones.reduce(
    (acc, s) => ({
      minX: Math.min(acc.minX, s.x),
      minY: Math.min(acc.minY, s.y),
      maxX: Math.max(acc.maxX, s.x),
      maxY: Math.max(acc.maxY, s.y),
      minR: Math.min(acc.minR, s.r),
      maxR: Math.max(acc.maxR, s.r),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      minR: Number.POSITIVE_INFINITY,
      maxR: Number.NEGATIVE_INFINITY,
    }
  );
  const svgBounds = svgCircles.reduce(
    (acc, c) => ({
      minX: Math.min(acc.minX, c.x),
      minY: Math.min(acc.minY, c.y),
      maxX: Math.max(acc.maxX, c.x),
      maxY: Math.max(acc.maxY, c.y),
      minR: Math.min(acc.minR, c.r),
      maxR: Math.max(acc.maxR, c.r),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      minR: Number.POSITIVE_INFINITY,
      maxR: Number.NEGATIVE_INFINITY,
    }
  );

  const stoneW = Math.max(1e-6, stoneBounds.maxX - stoneBounds.minX);
  const stoneH = Math.max(1e-6, stoneBounds.maxY - stoneBounds.minY);
  const stoneR = Math.max(1e-6, stoneBounds.maxR - stoneBounds.minR);
  const svgW = Math.max(1e-6, svgBounds.maxX - svgBounds.minX);
  const svgH = Math.max(1e-6, svgBounds.maxY - svgBounds.minY);
  const svgR = Math.max(1e-6, svgBounds.maxR - svgBounds.minR);

  const normalizedSvg = svgCircles.map((c) => ({
    ...c,
    nx: (c.x - svgBounds.minX) / svgW,
    ny: (c.y - svgBounds.minY) / svgH,
    nr: (c.r - svgBounds.minR) / svgR,
  }));
  const used = new Uint8Array(normalizedSvg.length);

  return stones.map((s) => {
    const nx = (s.x - stoneBounds.minX) / stoneW;
    const ny = (s.y - stoneBounds.minY) / stoneH;
    const nr = (s.r - stoneBounds.minR) / stoneR;
    let bestIdx = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < normalizedSvg.length; i += 1) {
      if (used[i]) continue;
      const c = normalizedSvg[i];
      const dPos = Math.hypot(nx - c.nx, ny - c.ny);
      const dR = Math.abs(nr - c.nr);
      const score = dPos + dR * 0.35;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestScore < 0.18) {
      used[bestIdx] = 1;
      return { ...s, customColor: normalizedSvg[bestIdx].color };
    }
    return s;
  });
};

const vectorizeWithRhinestoneEngine = async (file: File): Promise<Stone[]> => {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("category", "rhinestone");
  formData.append("sizeCode", "SS10");
  formData.append("realDiameterMm", "2.8");
  formData.append("vectorDiameterMm", "2.9");
  formData.append("holeDiameterMm", "3.1");
  formData.append("targetVectorDiameterMm", "2.9");
  formData.append("normalizeStones", "true");

  const createRes = await fetch(withApiBase("/api/patterns"), {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!createRes.ok) {
    throw new Error("Failed to send file to Rhinestone engine.");
  }

  const created = (await createRes.json()) as UploadPatternResponse;

  const startedAt = Date.now();
  const maxWaitMs = 15 * 60 * 1000;
  let failCount = 0;

  while (Date.now() - startedAt < maxWaitMs) {
    try {
      const statusRes = await fetch(withApiBase(`/api/patterns/${created.id}`), {
        credentials: "include",
      });
      if (statusRes.status === 404) {
        throw new Error("Islem kaydi bulunamadi (404). Sunucu gecici kaydi temizlemis olabilir.");
      }
      if (!statusRes.ok) {
        throw new Error("Isleme durumu okunamadi.");
      }
      failCount = 0;
      const statusData = (await statusRes.json()) as PatternStatusResponse;
      if (statusData.status === "failed") {
        throw new Error("Rhinestone engine failed to process.");
      }
      if (statusData.status === "completed" && statusData.dxfUrl) {
        const dxfRes = await fetch(withApiBase(statusData.dxfUrl), { credentials: "include" });
        if (!dxfRes.ok) {
          throw new Error("Olusan DXF dosyasi okunamadi.");
        }
        let parsed = sanitizeDetectedStones(parseDxfCircles(await dxfRes.text()), 2.9);
        if (statusData.svgUrl) {
          const svgRes = await fetch(withApiBase(statusData.svgUrl), { credentials: "include" });
          if (svgRes.ok) {
            parsed = applySvgColorsToStones(parsed, await svgRes.text());
          }
        }
        if (parsed.length === 0) {
          throw new Error("DXF parsed but no valid stones found.");
        }
        return parsed;
      }
    } catch (error) {
      failCount += 1;
      if (failCount > 5) {
        throw error instanceof Error ? error : new Error("Processing stopped due to temporary network failures.");
      }
    }
    await sleep(2000);
  }

  throw new Error("Processing timed out. Large PDFs may take longer.");
};

const vectorizeWithPatternEngine = async (
  file: File
): Promise<{ primitives: DxfPrimitive[]; svgUrl?: string | null; dxfUrl?: string | null; pdfUrl?: string | null }> => {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("category", "pattern");
  formData.append("normalizeStones", "false");

  const createRes = await fetch(withApiBase("/api/patterns"), {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!createRes.ok) {
    throw new Error("Failed to send file to Pattern engine.");
  }

  const created = (await createRes.json()) as UploadPatternResponse;
  const startedAt = Date.now();
  const maxWaitMs = 15 * 60 * 1000;

  while (Date.now() - startedAt < maxWaitMs) {
    const statusRes = await fetch(withApiBase(`/api/patterns/${created.id}`), {
      credentials: "include",
    });
    if (!statusRes.ok) throw new Error("Could not read Pattern processing status.");
    const statusData = (await statusRes.json()) as PatternStatusResponse;
    if (statusData.status === "failed") {
      throw new Error("Pattern motoru islemi basarisiz tamamladı.");
    }
    if (statusData.status === "completed") {
      const svgUrl = statusData.svgUrl ?? null;
      const dxfUrl = statusData.dxfUrl ?? null;
      const pdfUrl = svgUrl ? svgUrl.replace(/\.svg$/i, ".pdf") : null;
      let primitives: DxfPrimitive[] = [];

      if (dxfUrl) {
        const dxfRes = await fetch(withApiBase(dxfUrl), { credentials: "include" });
        if (dxfRes.ok) {
          const dxfText = await dxfRes.text();
          primitives = parseDxfPrimitives(dxfText);
          if (!primitives.length && dxfText.includes("<svg")) {
            primitives = parseSvgToPrimitives(dxfText);
          }
        }
      }

      if (!primitives.length && svgUrl) {
        const svgRes = await fetch(withApiBase(svgUrl), { credentials: "include" });
        if (svgRes.ok) {
          primitives = parseSvgToPrimitives(await svgRes.text());
        }
      }

      return { primitives, svgUrl, dxfUrl, pdfUrl };
    }
    await sleep(2000);
  }

  throw new Error("Pattern processing timed out.");
};

const buildDxf = (stones: Stone[]) => {
  const layerNames = Array.from(new Set(stones.map((s) => s.layer)));
  const lines = [
    "0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(layerNames.length + 1),
    "0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS",
  ];
  for (const layer of layerNames) {
    lines.push("0", "LAYER", "2", layer, "70", "0", "62", "7", "6", "CONTINUOUS");
  }
  lines.push("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");
  for (const s of stones) {
    lines.push(
      "0", "CIRCLE",
      "8", s.layer,
      "62", String(s.colorIndex),
      "10", s.x.toFixed(5),
      "20", s.y.toFixed(5),
      "30", "0.0",
      "40", s.r.toFixed(5)
    );
  }
  lines.push("0", "ENDSEC", "0", "EOF");
  return lines.join("\n");
};

const buildPlt = (stones: Stone[]) => {
  const mmToPlotter = (v: number) => Math.round(v * 40);
  const out = ["IN;", "SP1;"];
  for (const s of stones) {
    out.push(`PU${mmToPlotter(s.x)},${mmToPlotter(s.y)};CI${mmToPlotter(s.r)};`);
  }
  out.push("SP0;");
  return out.join("\n");
};

const buildPatternDxf = (primitives: DxfPrimitive[]) => {
  const layerNames = Array.from(new Set(primitives.map((p) => p.layer)));
  const lines = [
    "0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(layerNames.length + 1),
    "0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS",
  ];
  for (const layer of layerNames) {
    lines.push("0", "LAYER", "2", layer, "70", "0", "62", "7", "6", "CONTINUOUS");
  }
  lines.push("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");

  for (const p of primitives) {
    if (p.kind === "line") {
      lines.push(
        "0", "LINE",
        "8", p.layer,
        "10", p.x1.toFixed(5),
        "20", p.y1.toFixed(5),
        "11", p.x2.toFixed(5),
        "21", p.y2.toFixed(5)
      );
    } else if (p.kind === "circle") {
      lines.push(
        "0", "CIRCLE",
        "8", p.layer,
        "10", p.cx.toFixed(5),
        "20", p.cy.toFixed(5),
        "40", p.r.toFixed(5)
      );
    } else if (p.kind === "arc") {
      lines.push(
        "0", "ARC",
        "8", p.layer,
        "10", p.cx.toFixed(5),
        "20", p.cy.toFixed(5),
        "40", p.r.toFixed(5),
        "50", p.startDeg.toFixed(5),
        "51", p.endDeg.toFixed(5)
      );
    } else if (p.kind === "polyline") {
      lines.push(
        "0", "LWPOLYLINE",
        "8", p.layer,
        "90", String(p.points.length),
        "70", p.closed ? "1" : "0"
      );
      for (const pt of p.points) {
        lines.push("10", pt.x.toFixed(5), "20", pt.y.toFixed(5));
      }
    }
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return lines.join("\n");
};

const buildPatternSvg = (primitives: DxfPrimitive[], strokeWidth = 1) => {
  if (!primitives.length) {
    return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="1000" height="1000" viewBox="0 0 1000 1000"></svg>`;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of primitives) {
    if (p.kind === "line") {
      minX = Math.min(minX, p.x1, p.x2); minY = Math.min(minY, p.y1, p.y2);
      maxX = Math.max(maxX, p.x1, p.x2); maxY = Math.max(maxY, p.y1, p.y2);
    } else if (p.kind === "circle" || p.kind === "arc") {
      minX = Math.min(minX, p.cx - p.r); minY = Math.min(minY, p.cy - p.r);
      maxX = Math.max(maxX, p.cx + p.r); maxY = Math.max(maxY, p.cy + p.r);
    } else {
      for (const pt of p.points) {
        minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
      }
    }
  }
  const pad = 5;
  const x0 = minX - pad;
  const y0 = minY - pad;
  const width = Math.max(10, maxX - minX + pad * 2);
  const height = Math.max(10, maxY - minY + pad * 2);
  const vbHeight = height;

  const toSvgY = (y: number) => y0 + vbHeight - (y - y0);
  const body: string[] = [];
  for (const p of primitives) {
    const color = p.color ?? "#111827";
    if (p.kind === "line") {
      body.push(`<line x1="${p.x1.toFixed(3)}" y1="${toSvgY(p.y1).toFixed(3)}" x2="${p.x2.toFixed(3)}" y2="${toSvgY(p.y2).toFixed(3)}" stroke="${color}" stroke-width="${strokeWidth.toFixed(3)}" fill="none" />`);
    } else if (p.kind === "circle") {
      body.push(`<circle cx="${p.cx.toFixed(3)}" cy="${toSvgY(p.cy).toFixed(3)}" r="${p.r.toFixed(3)}" stroke="${color}" stroke-width="${strokeWidth.toFixed(3)}" fill="none" />`);
    } else if (p.kind === "arc") {
      const s = (p.startDeg * Math.PI) / 180;
      const e = (p.endDeg * Math.PI) / 180;
      const x1 = p.cx + Math.cos(s) * p.r;
      const y1 = p.cy + Math.sin(s) * p.r;
      const x2 = p.cx + Math.cos(e) * p.r;
      const y2 = p.cy + Math.sin(e) * p.r;
      const large = Math.abs(p.endDeg - p.startDeg) > 180 ? 1 : 0;
      const sweep = p.endDeg >= p.startDeg ? 1 : 0;
      body.push(`<path d="M ${x1.toFixed(3)} ${toSvgY(y1).toFixed(3)} A ${p.r.toFixed(3)} ${p.r.toFixed(3)} 0 ${large} ${sweep} ${x2.toFixed(3)} ${toSvgY(y2).toFixed(3)}" stroke="${color}" stroke-width="${strokeWidth.toFixed(3)}" fill="none" />`);
    } else {
      const pts = p.points.map((pt) => `${pt.x.toFixed(3)},${toSvgY(pt.y).toFixed(3)}`).join(" ");
      if (p.closed) body.push(`<polygon points="${pts}" stroke="${color}" stroke-width="${strokeWidth.toFixed(3)}" fill="none" />`);
      else body.push(`<polyline points="${pts}" stroke="${color}" stroke-width="${strokeWidth.toFixed(3)}" fill="none" />`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width.toFixed(2)}" height="${height.toFixed(2)}" viewBox="${x0.toFixed(3)} ${y0.toFixed(3)} ${width.toFixed(3)} ${height.toFixed(3)}">${body.join("")}</svg>`;
};

const buildRhinestoneSvg = (stones: Stone[], fillMode: boolean, withBackdrop = false) => {
  const safeStones = stones.filter(
    (s) =>
      Number.isFinite(s.x) &&
      Number.isFinite(s.y) &&
      Number.isFinite(s.r) &&
      s.r > 0
  );
  if (!safeStones.length) {
    return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="1000" height="1000" viewBox="0 0 1000 1000"></svg>`;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const s of safeStones) {
    minX = Math.min(minX, s.x - s.r);
    minY = Math.min(minY, s.y - s.r);
    maxX = Math.max(maxX, s.x + s.r);
    maxY = Math.max(maxY, s.y + s.r);
  }
  const pad = 5;
  const x0 = minX - pad;
  const y0 = minY - pad;
  const width = Math.max(10, maxX - minX + pad * 2);
  const height = Math.max(10, maxY - minY + pad * 2);
  const circles = safeStones
    .map((s) => {
      const rule = RULES.find((r) => r.key === s.ruleKey);
      const color = s.customColor ?? rule?.color ?? "#e5e7eb";
      const fill = fillMode ? color : "none";
      return `<circle cx="${s.x.toFixed(3)}" cy="${s.y.toFixed(3)}" r="${s.r.toFixed(3)}" stroke="${color}" stroke-width="1.1" fill="${fill}" />`;
    })
    .join("");
  const backdrop = withBackdrop
    ? `<rect x="${x0.toFixed(3)}" y="${y0.toFixed(3)}" width="${width.toFixed(3)}" height="${height.toFixed(3)}" fill="#000000" />`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width.toFixed(2)}" height="${height.toFixed(2)}" viewBox="${x0.toFixed(3)} ${y0.toFixed(3)} ${width.toFixed(3)} ${height.toFixed(3)}">${backdrop}${circles}</svg>`;
};

const buildPatternPlt = (primitives: DxfPrimitive[]) => {
  const mmToPlotter = (v: number) => Math.round(v * 40);
  const out = ["IN;", "SP1;"];
  for (const p of primitives) {
    if (p.kind === "line") {
      out.push(`PU${mmToPlotter(p.x1)},${mmToPlotter(p.y1)};PD${mmToPlotter(p.x2)},${mmToPlotter(p.y2)};PU;`);
    } else if (p.kind === "circle") {
      out.push(`PU${mmToPlotter(p.cx)},${mmToPlotter(p.cy)};CI${mmToPlotter(p.r)};`);
    } else if (p.kind === "polyline") {
      if (p.points.length < 2) continue;
      const first = p.points[0];
      out.push(`PU${mmToPlotter(first.x)},${mmToPlotter(first.y)};PD;`);
      for (let i = 1; i < p.points.length; i += 1) {
        const pt = p.points[i];
        out.push(`${mmToPlotter(pt.x)},${mmToPlotter(pt.y)};`);
      }
      if (p.closed) out.push(`${mmToPlotter(first.x)},${mmToPlotter(first.y)};`);
      out.push("PU;");
    }
  }
  out.push("SP0;");
  return out.join("\n");
};

const getMimeByExt = (name: string) => {
  const lower = name.toLowerCase();
  if (lower.endsWith(".svg")) return "image/svg+xml;charset=utf-8";
  if (lower.endsWith(".dxf")) return "application/dxf;charset=utf-8";
  if (lower.endsWith(".plt")) return "application/vnd.hp-hpgl;charset=utf-8";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
};

const normalizeExportName = (name: string, ext: string) => {
  const trimmed = name.trim() || "export";
  const withoutExt = trimmed.replace(/\.[^/.]+$/g, "");
  return `${withoutExt}.${ext}`;
};

const triggerDownload = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
};

const downloadText = (name: string, content: string) => {
  const blob = new Blob([content], { type: getMimeByExt(name) });
  triggerDownload(name, blob);
};

const downloadBlob = (name: string, blob: Blob) => {
  triggerDownload(name, blob);
};

const EDITOR_SESSION_KEY = "np_production_editor_session_v1";

export default function RhinestoneProductionEdit() {
  const { t } = useI18n();
  const tx = (key: string, fallback: string) => {
    const v = t(key);
    return v == key ? fallback : v;
  };
  const { data: patterns, refetch: refetchPatterns } = usePatterns();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const patternCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("rhinestone");
  const [importMode, setImportMode] = useState<ImportMode>("rhinestone");
  const [patternPreview, setPatternPreview] = useState<PatternVectorPreview | null>(null);
  const [patternPrimitives, setPatternPrimitives] = useState<DxfPrimitive[]>([]);
  const [hiddenPatternLayers, setHiddenPatternLayers] = useState<Set<string>>(new Set());
  const [selectedPatternPrimitives, setSelectedPatternPrimitives] = useState<Set<number>>(new Set());
  const [isolatePatternSelection, setIsolatePatternSelection] = useState(false);
  const [patternStrokeWidth, setPatternStrokeWidth] = useState(1.1);
  const [stones, setStones] = useState<Stone[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [activeRule, setActiveRule] = useState(RULES[0].key);
  const [zoom, setZoom] = useState(10);
  const [pan, setPan] = useState({ x: 80, y: 80 });
  const [dragging, setDragging] = useState(false);
  const [selectBox, setSelectBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [fillMode, setFillMode] = useState(false);
  const [showSelection, setShowSelection] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastImportType, setLastImportType] = useState<string>("");
  const [loadingFromPattern, setLoadingFromPattern] = useState(false);
  const [showArchiveLoader, setShowArchiveLoader] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const dragRef = useRef<DragContext>({
    mode: "none",
    startMouseX: 0,
    startMouseY: 0,
    moved: false,
    historyPushed: false,
    selectedIds: new Set<number>(),
    originById: new Map<number, { x: number; y: number }>(),
    patternPrimitiveIds: new Set<number>(),
  });
  const historyRef = useRef<Stone[][]>([]);
  const patternHistoryRef = useRef<DxfPrimitive[][]>([]);
  const primarySelectedPatternPrimitive = useMemo(() => {
    const first = selectedPatternPrimitives.values().next();
    return first.done ? null : first.value;
  }, [selectedPatternPrimitives]);

  const cloneStones = (source: Stone[]) => source.map((s) => ({ ...s }));

  const clonePatternPrimitives = (source: DxfPrimitive[]) =>
    source.map((p) => {
      if (p.kind === "line") return { ...p };
      if (p.kind === "circle") return { ...p };
      if (p.kind === "arc") return { ...p };
      return { ...p, points: p.points.map((pt) => ({ ...pt })) };
    });

  const resetHistory = () => {
    historyRef.current = [];
    patternHistoryRef.current = [];
    setCanUndo(false);
  };

  const pushPatternHistory = (snapshot: DxfPrimitive[]) => {
    patternHistoryRef.current.push(clonePatternPrimitives(snapshot));
    if (patternHistoryRef.current.length > 50) patternHistoryRef.current.shift();
    setCanUndo(patternHistoryRef.current.length > 0);
  };

  const { setActivePattern } = useMachineControl(); // Çantayı açtık
  const [, setLocation] = useLocation(); // Sayfa değiştiriciyi aldık

  // Butona basınca çalışacak olan işlem:
  const handleSendToControl = () => {
  const koordinatlar = stones.map(s => ({ x: s.x, y: s.y }));
  
  // Önce hafızaya kaydet
  setActivePattern(koordinatlar); 
  
  // Sonra diğer odaya (sayfaya) geç
  setLocation("/machine-control"); 
};




  const pushHistory = (snapshot: Stone[]) => {
    historyRef.current.push(cloneStones(snapshot));
    if (historyRef.current.length > 50) historyRef.current.shift();
    setCanUndo(historyRef.current.length > 0);
  };

  const undoLastChange = () => {
    if (editorMode === "pattern") {
      const prev = patternHistoryRef.current.pop();
      if (!prev) return;
      setPatternPrimitives(prev);
      setSelectedPatternPrimitives(new Set());
      setCanUndo(patternHistoryRef.current.length > 0);
    } else {
      const prev = historyRef.current.pop();
      if (!prev) return;
      setStones(prev);
      setSelected(new Set());
      setCanUndo(historyRef.current.length > 0);
    }
  };

  const exportSvgAsPdf = async (svgContent: string, fileName: string) => {
    const res = await fetch(withApiBase("/api/export/pdf"), {
      method: "POST",
      headers: { "Content-Type": "image/svg+xml;charset=utf-8" },
      credentials: "include",
      body: svgContent,
    });
    if (!res.ok) {
      const reason = await res.text().catch(() => "");
      throw new Error(`PDF export failed (${res.status})${reason ? `: ${reason}` : ""}`);
    }
    const blob = await res.blob();
    downloadBlob(fileName, blob);
  };

  const saveEditorSession = async () => {
    const payload: SavedEditorSession = {
      version: 1,
      savedAt: new Date().toISOString(),
      mode: editorMode,
      importMode,
      zoom,
      pan,
      patternStrokeWidth,
      fillMode,
      showSelection,
      activeRule,
      rhinestone: {
        stones,
        selectedIds: Array.from(selected),
        lastImportType,
      },
      pattern: {
        primitives: patternPrimitives,
        hiddenLayers: Array.from(hiddenPatternLayers),
        selectedPrimitiveIds: Array.from(selectedPatternPrimitives),
        isolateSelection: isolatePatternSelection,
        preview: patternPreview,
        lastImportType,
      },
    };
    localStorage.setItem(EDITOR_SESSION_KEY, JSON.stringify(payload));
    try {
      const isPattern = editorMode === "pattern";
      const archiveSvg = isPattern
        ? buildPatternSvg(patternPrimitives, patternStrokeWidth)
        : buildRhinestoneSvg(stones, fillMode, false);
      const archiveDxf = isPattern ? buildPatternDxf(patternPrimitives) : buildDxf(stones);
      const archivePlt = isPattern ? buildPatternPlt(patternPrimitives) : buildPlt(stones);
      const baseName = (patternPreview?.name ?? (isPattern ? "pattern-session" : "rhinestone-session"))
        .replace(/\.[^/.]+$/g, "")
        .trim();
      const formData = new FormData();
      formData.append("mode", editorMode);
      formData.append("name", baseName || (isPattern ? "pattern-session" : "rhinestone-session"));
      formData.append("svg", archiveSvg);
      formData.append("dxf", archiveDxf);
      formData.append("plt", archivePlt);
      const res = await fetch(withApiBase("/api/production-saves"), {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        throw new Error(`Archive save failed (${res.status})`);
      }
      const saved = (await res.json()) as { id?: number; archived?: boolean };
      if (!saved?.id) {
        throw new Error(tx("prod_save_id_missing", "Record created but no record id returned."));
      }
      await refetchPatterns();
      setShowArchiveLoader(true);
      alert(`Uretim editoru kaydedildi ve arsive eklendi. Kayit No: #${saved.id}`);
    } catch (error) {
      alert(error instanceof Error ? error.message : tx("prod_archive_save_failed", "Archive save failed."));
    }
  };

  const loadEditorSession = () => {
    setShowArchiveLoader((prev) => !prev);
  };

  const archivedPatterns = useMemo(() => {
    if (!patterns) return [];
    return patterns
      .filter((p) => p.archived)
      .sort((a, b) => {
        const ta = new Date(a.createdAt ?? 0).getTime();
        const tb = new Date(b.createdAt ?? 0).getTime();
        return tb - ta;
      });
  }, [patterns]);

  const shouldConfirmExit = isProcessing || stones.length > 0 || patternPrimitives.length > 0;

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldConfirmExit) return;
      event.preventDefault();
      event.returnValue = "";
    };

    const onDocumentClick = (event: MouseEvent) => {
      if (!shouldConfirmExit) return;
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target === "_blank") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      const nextUrl = new URL(anchor.href, window.location.origin);
      const currentUrl = new URL(window.location.href);
      if (nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search) return;

      const confirmed = window.confirm(tx("prod_confirm_exit", "Are you sure you want to exit?"));
      if (!confirmed) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, [shouldConfirmExit]);

  const cellSizeMm = 8;
  const spatialIndex = useMemo(() => {
    const map = new Map<string, Stone[]>();
    for (const s of stones) {
      const gx = Math.floor(s.x / cellSizeMm);
      const gy = Math.floor(s.y / cellSizeMm);
      const key = `${gx}:${gy}`;
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return map;
  }, [stones]);

  const stats = useMemo(() => {
    const byRule = new Map<string, number>();
    let unassigned = 0;
    for (const s of stones) {
      if (!s.ruleKey) unassigned += 1;
      else byRule.set(s.ruleKey, (byRule.get(s.ruleKey) ?? 0) + 1);
    }
    return { byRule, unassigned };
  }, [stones]);

  const patternBounds = useMemo(() => {
    if (!patternPrimitives.length) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of patternPrimitives) {
      if (p.kind === "line") {
        minX = Math.min(minX, p.x1, p.x2);
        minY = Math.min(minY, p.y1, p.y2);
        maxX = Math.max(maxX, p.x1, p.x2);
        maxY = Math.max(maxY, p.y1, p.y2);
      } else if (p.kind === "circle" || p.kind === "arc") {
        minX = Math.min(minX, p.cx - p.r);
        minY = Math.min(minY, p.cy - p.r);
        maxX = Math.max(maxX, p.cx + p.r);
        maxY = Math.max(maxY, p.cy + p.r);
      } else if (p.kind === "polyline") {
        for (const pt of p.points) {
          minX = Math.min(minX, pt.x);
          minY = Math.min(minY, pt.y);
          maxX = Math.max(maxX, pt.x);
          maxY = Math.max(maxY, pt.y);
        }
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }
    return { minX, minY, maxX, maxY };
  }, [patternPrimitives]);

  const patternLayers = useMemo(
    () => Array.from(new Set(patternPrimitives.map((p) => p.layer))).sort(),
    [patternPrimitives]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, w, h);

    const viewLeft = (-pan.x) / zoom;
    const viewTop = (-pan.y) / zoom;
    const viewRight = (w - pan.x) / zoom;
    const viewBottom = (h - pan.y) / zoom;

    const byColor = new Map<string, Stone[]>();
    for (const s of stones) {
      if (
        s.x + s.r < viewLeft ||
        s.y + s.r < viewTop ||
        s.x - s.r > viewRight ||
        s.y - s.r > viewBottom
      ) continue;
      const rule = RULES.find((r) => r.key === s.ruleKey);
      const color = s.customColor ?? rule?.color ?? "#e5e7eb";
      const arr = byColor.get(color) ?? [];
      arr.push(s);
      byColor.set(color, arr);
    }

    for (const [color, arr] of Array.from(byColor.entries())) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.1;
      if (fillMode) ctx.fillStyle = color;
      for (const s of arr) {
        const cx = pan.x + s.x * zoom;
        const cy = pan.y + s.y * zoom;
        const rr = Math.max(0.8, s.r * zoom);
        ctx.moveTo(cx + rr, cy);
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      }
      if (fillMode) ctx.fill();
      ctx.stroke();
    }

    if (showSelection && selected.size > 0) {
      ctx.beginPath();
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 1.2;
      for (const s of stones) {
        if (!selected.has(s.id)) continue;
        const cx = pan.x + s.x * zoom;
        const cy = pan.y + s.y * zoom;
        const rr = Math.max(1.1, s.r * zoom + 1.5);
        ctx.moveTo(cx + rr, cy);
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      }
      ctx.stroke();
    }

    if (selectBox) {
      const x = Math.min(selectBox.x0, selectBox.x1);
      const y = Math.min(selectBox.y0, selectBox.y1);
      const rw = Math.abs(selectBox.x1 - selectBox.x0);
      const rh = Math.abs(selectBox.y1 - selectBox.y0);
      ctx.fillStyle = "rgba(34,211,238,0.15)";
      ctx.fillRect(x, y, rw, rh);
      ctx.strokeStyle = "#22d3ee";
      ctx.strokeRect(x, y, rw, rh);
    }
  }, [stones, selected, zoom, pan, selectBox, fillMode, showSelection]);

  useEffect(() => {
    if (editorMode !== "pattern") return;
    const canvas = patternCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    const toX = (x: number) => pan.x + x * zoom;
    const toY = (y: number) => pan.y - y * zoom;

    for (let index = 0; index < patternPrimitives.length; index += 1) {
      const primitive = patternPrimitives[index];
      if (hiddenPatternLayers.has(primitive.layer)) continue;
      if (isolatePatternSelection && selectedPatternPrimitives.size > 0 && !selectedPatternPrimitives.has(index)) continue;
      const isSelected = selectedPatternPrimitives.has(index);
      const baseColor = primitive.color ?? "#111827";
      ctx.strokeStyle = isSelected ? "#2563eb" : baseColor;
      ctx.lineWidth = isSelected ? Math.max(2, patternStrokeWidth * 1.8) : Math.max(0.4, patternStrokeWidth);
      if (primitive.kind === "line") {
        ctx.beginPath();
        ctx.moveTo(toX(primitive.x1), toY(primitive.y1));
        ctx.lineTo(toX(primitive.x2), toY(primitive.y2));
        ctx.stroke();
      } else if (primitive.kind === "circle") {
        ctx.beginPath();
        ctx.arc(toX(primitive.cx), toY(primitive.cy), Math.max(0.5, primitive.r * zoom), 0, Math.PI * 2);
        ctx.stroke();
      } else if (primitive.kind === "arc") {
        const startRad = (primitive.startDeg * Math.PI) / 180;
        const endRad = (primitive.endDeg * Math.PI) / 180;
        ctx.beginPath();
        ctx.arc(
          toX(primitive.cx),
          toY(primitive.cy),
          Math.max(0.5, primitive.r * zoom),
          -startRad,
          -endRad,
          true
        );
        ctx.stroke();
      } else if (primitive.kind === "polyline") {
        if (primitive.points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(toX(primitive.points[0].x), toY(primitive.points[0].y));
        for (let i = 1; i < primitive.points.length; i += 1) {
          ctx.lineTo(toX(primitive.points[i].x), toY(primitive.points[i].y));
        }
        if (primitive.closed) {
          ctx.closePath();
        }
        ctx.stroke();
      }
    }
    if (selectBox) {
      const x = Math.min(selectBox.x0, selectBox.x1);
      const y = Math.min(selectBox.y0, selectBox.y1);
      const rw = Math.abs(selectBox.x1 - selectBox.x0);
      const rh = Math.abs(selectBox.y1 - selectBox.y0);
      ctx.fillStyle = "rgba(37,99,235,0.15)";
      ctx.fillRect(x, y, rw, rh);
      ctx.strokeStyle = "#2563eb";
      ctx.strokeRect(x, y, rw, rh);
    }
  }, [editorMode, patternPrimitives, pan, zoom, hiddenPatternLayers, selectedPatternPrimitives, isolatePatternSelection, patternStrokeWidth, selectBox]);

  // ==================== GÜNCELLENMİŞ IMPORT FONKSİYONU ====================
  const onImportFile = async (file?: File) => {
    if (!file) return;
    
    setIsProcessing(true);
    setEditorMode("rhinestone");
    setPatternPreview(null);
    setPatternPrimitives([]);
    setHiddenPatternLayers(new Set());
    setSelectedPatternPrimitives(new Set());
    setIsolatePatternSelection(false);
    
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let parsed: Stone[] = [];
      
      if (ext === "dxf") {
        const text = await file.text();
        const primitives = parseDxfPrimitives(text);
        const circles = sanitizeDetectedStones(parseDxfCircles(text));

        if (importMode === "pattern") {
          resetHistory();
          setEditorMode("pattern");
          setPatternPrimitives(primitives);
          setHiddenPatternLayers(new Set());
          setSelectedPatternPrimitives(new Set());
          setIsolatePatternSelection(false);
          setPatternPreview({
            patternId: Date.now(),
            name: file.name,
            category: "pattern",
            svgUrl: null,
            dxfUrl: null,
            pdfUrl: null,
            previewUrl: "",
            isPdf: false,
          });
          setStones([]);
          setSelected(new Set());
          setLastImportType("DXF_PATTERN");
          if (!primitives.length) {
            alert(tx("prod_dxf_no_editable_entities", "DXF opened but no editable entities found."));
          }
          setIsProcessing(false);
          return;
        }

        parsed = circles;
        if (!parsed.length) {
          alert(tx("prod_dxf_no_rhinestone_circles", "No circular stones found in DXF for rhinestone mode."));
          setIsProcessing(false);
          return;
        }
        setLastImportType("DXF_RHINESTONE");
      } else if (ext === "png" || ext === "jpg" || ext === "jpeg") {
        if (importMode === "rhinestone") {
          parsed = await vectorizeWithRhinestoneEngine(file);
          setLastImportType("RHINESTONE");
        } else {
          const result = await vectorizeWithPatternEngine(file);
          resetHistory();
          setEditorMode("pattern");
          setPatternPrimitives(result.primitives);
          setHiddenPatternLayers(new Set());
          setSelectedPatternPrimitives(new Set());
          setIsolatePatternSelection(false);
          setPatternPreview({
            patternId: Date.now(),
            name: file.name,
            category: "pattern",
            svgUrl: result.svgUrl ?? null,
            dxfUrl: result.dxfUrl ?? null,
            pdfUrl: result.pdfUrl ?? null,
            previewUrl: result.svgUrl ?? result.pdfUrl ?? "",
            isPdf: false,
          });
          setStones([]);
          setSelected(new Set());
          setLastImportType("PATTERN_IMAGE_VECTOR");
          setIsProcessing(false);
          return;
        }
      } else if (ext === "pdf") {
        if (importMode === "rhinestone") {
          parsed = await vectorizeWithRhinestoneEngine(file);
          setLastImportType("RHINESTONE_PDF");
        } else {
          const result = await vectorizeWithPatternEngine(file);
          resetHistory();
          setEditorMode("pattern");
          setPatternPrimitives(result.primitives);
          setHiddenPatternLayers(new Set());
          setSelectedPatternPrimitives(new Set());
          setIsolatePatternSelection(false);
          setPatternPreview({
            patternId: Date.now(),
            name: file.name,
            category: "pattern",
            svgUrl: result.svgUrl ?? null,
            dxfUrl: result.dxfUrl ?? null,
            pdfUrl: result.pdfUrl ?? null,
            previewUrl: result.pdfUrl ?? result.svgUrl ?? "",
            isPdf: Boolean((result.pdfUrl ?? "").toLowerCase().endsWith(".pdf")),
          });
          setStones([]);
          setSelected(new Set());
          setLastImportType("PATTERN_PDF_VECTOR");
          setIsProcessing(false);
          return;
        }
      } else {
        alert(tx("prod_unsupported_file", "Unsupported file format. Please upload DXF, PNG, JPG or PDF."));
        setIsProcessing(false);
        return;
      }
      
      resetHistory();
      setStones(parsed);
      setSelected(new Set());
      
      if (!parsed.length) {
        alert(tx("prod_no_stones_found", "No stones (circles) found in file. Please upload a clearer image."));
        setIsProcessing(false);
        return;
      }
      
      // Bounding box hesapla ve görünüme sığdır
      const bb = parsed.reduce(
        (acc, s) => ({
          minX: Math.min(acc.minX, s.x - s.r),
          minY: Math.min(acc.minY, s.y - s.r),
          maxX: Math.max(acc.maxX, s.x + s.r),
          maxY: Math.max(acc.maxY, s.y + s.r),
        }),
        { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY }
      );
      
      const width = bb.maxX - bb.minX || 100;
      const height = bb.maxY - bb.minY || 100;
      const nextZoom = Math.min(12, Math.max(2, 900 / Math.max(width, height)));
      setZoom(nextZoom);
      setPan({ x: 40 - bb.minX * nextZoom, y: 40 - bb.minY * nextZoom });
      
    } catch (error) {
      console.error(tx("prod_import_error", "Import error:"), error);
      alert(`${tx("prod_file_process_error", "File processing error:")} ${error instanceof Error ? error.message : tx("unknown_error", "Unknown error")}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const loadFromPatternId = async (patternId: number) => {
    if (!Number.isFinite(patternId)) return;
    setLoadingFromPattern(true);
    setIsProcessing(true);
    try {
      const patternRes = await fetch(withApiBase(`/api/patterns/${patternId}`), {
        credentials: "include",
      });
      if (!patternRes.ok) throw new Error("Pattern bulunamadi");
      const pattern = (await patternRes.json()) as {
        id: number;
        name?: string | null;
        category?: string | null;
        svgUrl?: string | null;
        imageUrl?: string | null;
        dxfUrl?: string | null;
      };

      const category = (pattern.category ?? "").toLowerCase();
      const originalExt = (pattern.imageUrl?.split(".").pop() || "").toLowerCase();
      const pdfUrl = pattern.svgUrl ? pattern.svgUrl.replace(/\.svg$/i, ".pdf") : null;
      const previewUrl =
        originalExt === "pdf"
          ? (pdfUrl ?? pattern.svgUrl ?? pattern.imageUrl ?? "")
          : (pattern.svgUrl ?? pdfUrl ?? pattern.imageUrl ?? "");

      if (category && category !== "rhinestone") {
        let primitives: DxfPrimitive[] = [];
        if (pattern.dxfUrl) {
          const dxfRes = await fetch(withApiBase(pattern.dxfUrl), {
            credentials: "include",
          });
          if (dxfRes.ok) {
            const dxfText = await dxfRes.text();
            primitives = parseDxfPrimitives(dxfText);
            if (!primitives.length && dxfText.includes("<svg")) {
              primitives = parseSvgToPrimitives(dxfText);
            }
          }
        }
        if (!primitives.length && pattern.svgUrl) {
          const svgRes = await fetch(withApiBase(pattern.svgUrl), { credentials: "include" });
          if (svgRes.ok) {
            primitives = parseSvgToPrimitives(await svgRes.text());
          }
        }
        if (!previewUrl) throw new Error("Bu desende gosterilecek vektor onizleme bulunamadi.");
        resetHistory();
        setStones([]);
        setSelected(new Set());
        setLastImportType("PATTERN_VECTOR");
        setEditorMode("pattern");
        setPatternPrimitives(primitives);
        setHiddenPatternLayers(new Set());
        setSelectedPatternPrimitives(new Set());
        setIsolatePatternSelection(false);
        setPatternPreview({
          patternId: pattern.id,
          name: pattern.name?.trim() || `pattern-${pattern.id}`,
          category: category || "pattern",
          svgUrl: pattern.svgUrl ?? null,
          dxfUrl: pattern.dxfUrl ?? null,
          pdfUrl,
          previewUrl,
          isPdf: previewUrl.toLowerCase().endsWith(".pdf"),
        });
        return;
      }

      setEditorMode("rhinestone");
      setPatternPreview(null);
      setPatternPrimitives([]);
      setHiddenPatternLayers(new Set());
      setSelectedPatternPrimitives(new Set());
      setIsolatePatternSelection(false);

      let parsed: Stone[] = [];

      if (pattern.dxfUrl) {
        const dxfRes = await fetch(withApiBase(pattern.dxfUrl), {
          credentials: "include",
        });
        if (dxfRes.ok) {
          parsed = sanitizeDetectedStones(parseDxfCircles(await dxfRes.text()));
        }
      }
      if (parsed.length && pattern.svgUrl) {
        const svgRes = await fetch(withApiBase(pattern.svgUrl), { credentials: "include" });
        if (svgRes.ok) {
          parsed = applySvgColorsToStones(parsed, await svgRes.text());
        }
      }

      // Some non-rhinestone patterns do not contain circle entities in DXF.
      // Fallback: re-run the raster through rhinestone engine to generate circles.
      if (!parsed.length && pattern.imageUrl) {
        const imageRes = await fetch(withApiBase(pattern.imageUrl), {
          credentials: "include",
        });
        if (!imageRes.ok) throw new Error("Pattern gorseli alinamadi");
        const blob = await imageRes.blob();
        const inferredExt =
          pattern.name?.split(".").pop()?.toLowerCase() ||
          pattern.imageUrl.split(".").pop()?.toLowerCase() ||
          "png";
        const fileName = pattern.name?.trim() || `pattern-${pattern.id}.${inferredExt}`;
        const file = new File([blob], fileName, {
          type: blob.type || (inferredExt === "pdf" ? "application/pdf" : "image/png"),
        });
        parsed = await vectorizeWithRhinestoneEngine(file);
      }

      if (!parsed.length) {
        throw new Error(tx("prod_no_stone_data", "No stone data could be produced from this pattern. Try another file."));
      }

      resetHistory();
      setStones(parsed);
      setSelected(new Set());
      setLastImportType("PATTERN");

      const bb = parsed.reduce(
        (acc, s) => ({
          minX: Math.min(acc.minX, s.x - s.r),
          minY: Math.min(acc.minY, s.y - s.r),
          maxX: Math.max(acc.maxX, s.x + s.r),
          maxY: Math.max(acc.maxY, s.y + s.r),
        }),
        { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY }
      );
      const width = bb.maxX - bb.minX || 100;
      const height = bb.maxY - bb.minY || 100;
      const nextZoom = Math.min(12, Math.max(2, 900 / Math.max(width, height)));
      setZoom(nextZoom);
      setPan({ x: 40 - bb.minX * nextZoom, y: 40 - bb.minY * nextZoom });
    } catch (error) {
      alert(error instanceof Error ? error.message : tx("prod_pattern_load_error", "Pattern loading failed"));
    } finally {
      setLoadingFromPattern(false);
      setIsProcessing(false);
    }
  };

  const pickAt = (mx: number, my: number) => {
    const wx = (mx - pan.x) / zoom;
    const wy = (my - pan.y) / zoom;
    const gx = Math.floor(wx / cellSizeMm);
    const gy = Math.floor(wy / cellSizeMm);
    let best: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let ix = gx - 1; ix <= gx + 1; ix += 1) {
      for (let iy = gy - 1; iy <= gy + 1; iy += 1) {
        const bucket = spatialIndex.get(`${ix}:${iy}`);
        if (!bucket) continue;
        for (const s of bucket) {
          const d = Math.hypot(s.x - wx, s.y - wy);
          if (d <= Math.max(s.r, 0.6) && d < bestDist) {
            bestDist = d;
            best = s.id;
          }
        }
      }
    }
    return best;
  };

  const pickPatternPrimitiveAt = (mx: number, my: number): number | null => {
    const wx = (mx - pan.x) / zoom;
    const wy = (pan.y - my) / zoom;
    const toleranceMm = Math.max(0.2, 8 / Math.max(0.2, zoom));
    const toleranceSq = toleranceMm * toleranceMm;

    for (let i = patternPrimitives.length - 1; i >= 0; i -= 1) {
      const p = patternPrimitives[i];
      if (hiddenPatternLayers.has(p.layer)) continue;
      if (p.kind === "circle") {
        const d = Math.abs(Math.hypot(wx - p.cx, wy - p.cy) - p.r);
        if (d <= toleranceMm) return i;
      } else if (p.kind === "arc") {
        const d = Math.abs(Math.hypot(wx - p.cx, wy - p.cy) - p.r);
        if (d <= toleranceMm) return i;
      } else if (p.kind === "line") {
        const vx = p.x2 - p.x1;
        const vy = p.y2 - p.y1;
        const len2 = vx * vx + vy * vy;
        if (len2 <= 1e-9) continue;
        const t = Math.max(0, Math.min(1, ((wx - p.x1) * vx + (wy - p.y1) * vy) / len2));
        const px = p.x1 + t * vx;
        const py = p.y1 + t * vy;
        const dsq = (wx - px) * (wx - px) + (wy - py) * (wy - py);
        if (dsq <= toleranceSq) return i;
      } else if (p.kind === "polyline") {
        for (let j = 1; j < p.points.length; j += 1) {
          const a = p.points[j - 1];
          const b = p.points[j];
          const vx = b.x - a.x;
          const vy = b.y - a.y;
          const len2 = vx * vx + vy * vy;
          if (len2 <= 1e-9) continue;
          const t = Math.max(0, Math.min(1, ((wx - a.x) * vx + (wy - a.y) * vy) / len2));
          const px = a.x + t * vx;
          const py = a.y + t * vy;
          const dsq = (wx - px) * (wx - px) + (wy - py) * (wy - py);
          if (dsq <= toleranceSq) return i;
        }
      }
    }
    return null;
  };

  const getPatternPrimitiveBounds = (p: DxfPrimitive) => {
    if (p.kind === "line") {
      return {
        minX: Math.min(p.x1, p.x2),
        minY: Math.min(p.y1, p.y2),
        maxX: Math.max(p.x1, p.x2),
        maxY: Math.max(p.y1, p.y2),
      };
    }
    if (p.kind === "circle" || p.kind === "arc") {
      return { minX: p.cx - p.r, minY: p.cy - p.r, maxX: p.cx + p.r, maxY: p.cy + p.r };
    }
    if (!p.points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return p.points.reduce(
      (acc, pt) => ({
        minX: Math.min(acc.minX, pt.x),
        minY: Math.min(acc.minY, pt.y),
        maxX: Math.max(acc.maxX, pt.x),
        maxY: Math.max(acc.maxY, pt.y),
      }),
      { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY }
    );
  };

  const movePatternPrimitives = (indices: Set<number>, dxMm: number, dyMm: number) => {
    if (!indices.size) return;
    if (!dragRef.current.historyPushed) {
      pushPatternHistory(patternPrimitives);
      dragRef.current.historyPushed = true;
    }
    setPatternPrimitives((prev) =>
      prev.map((p, i) => {
        if (!indices.has(i)) return p;
        if (p.kind === "line") {
          return { ...p, x1: p.x1 + dxMm, y1: p.y1 + dyMm, x2: p.x2 + dxMm, y2: p.y2 + dyMm };
        }
        if (p.kind === "circle") {
          return { ...p, cx: p.cx + dxMm, cy: p.cy + dyMm };
        }
        if (p.kind === "arc") {
          return { ...p, cx: p.cx + dxMm, cy: p.cy + dyMm };
        }
        return {
          ...p,
          points: p.points.map((pt) => ({ x: pt.x + dxMm, y: pt.y + dyMm })),
        };
      })
    );
  };

  const deleteSelectedPatternPrimitives = () => {
    if (!selectedPatternPrimitives.size) return;
    pushPatternHistory(patternPrimitives);
    setPatternPrimitives((prev) => prev.filter((_, i) => !selectedPatternPrimitives.has(i)));
    setSelectedPatternPrimitives(new Set());
  };

  const setSelectedPatternPrimitiveColor = (color: string) => {
    if (!selectedPatternPrimitives.size) return;
    pushPatternHistory(patternPrimitives);
    setPatternPrimitives((prev) =>
      prev.map((p, i) => (selectedPatternPrimitives.has(i) ? { ...p, color } : p))
    );
  };

  const scaleSelectedPatternPrimitive = (factor: number) => {
    if (!selectedPatternPrimitives.size || !Number.isFinite(factor) || factor <= 0) return;
    pushPatternHistory(patternPrimitives);
    setPatternPrimitives((prev) =>
      prev.map((p, i) => {
        if (!selectedPatternPrimitives.has(i)) return p;
        if (p.kind === "circle" || p.kind === "arc") {
          return { ...p, r: Math.max(0.1, p.r * factor) };
        }
        if (p.kind === "line") {
          const cx = (p.x1 + p.x2) * 0.5;
          const cy = (p.y1 + p.y2) * 0.5;
          return {
            ...p,
            x1: cx + (p.x1 - cx) * factor,
            y1: cy + (p.y1 - cy) * factor,
            x2: cx + (p.x2 - cx) * factor,
            y2: cy + (p.y2 - cy) * factor,
          };
        }
        const cx = p.points.reduce((a, pt) => a + pt.x, 0) / p.points.length;
        const cy = p.points.reduce((a, pt) => a + pt.y, 0) / p.points.length;
        return {
          ...p,
          points: p.points.map((pt) => ({
            x: cx + (pt.x - cx) * factor,
            y: cy + (pt.y - cy) * factor,
          })),
        };
      })
    );
  };

  const applyRuleToSelection = () => {
    const rule = RULES.find((r) => r.key === activeRule);
    if (!rule || selected.size === 0) return;

    // Seçili taşların ID'lerini al
    const selectedIds = Array.from(selected);

    // Her bir taş için maksimum izin verilen yarıçapı hesapla (komşu taşlarla çakışmamak için)
    const maxRadii = new Map<number, number>();
    let anyLimited = false;

    // Spatial index kullanarak hızlı komşu taraması
    const cellSize = 8; // mm
    const spatial = new Map<string, Stone[]>();
    for (const s of stones) {
      const gx = Math.floor(s.x / cellSize);
      const gy = Math.floor(s.y / cellSize);
      const key = `${gx}:${gy}`;
      if (!spatial.has(key)) spatial.set(key, []);
      spatial.get(key)!.push(s);
    }

    for (const id of selectedIds) {
      const stone = stones.find(s => s.id === id);
      if (!stone) continue;

      const newRadius = rule.diameterMm / 2;
      let minDistance = Infinity;

      // Komşu hücreleri tara
      const gx = Math.floor(stone.x / cellSize);
      const gy = Math.floor(stone.y / cellSize);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighborKey = `${gx + dx}:${gy + dy}`;
          const neighbors = spatial.get(neighborKey);
          if (!neighbors) continue;
          for (const other of neighbors) {
            if (other.id === id) continue;
            const dist = Math.hypot(stone.x - other.x, stone.y - other.y);
            // Diğer taşın mevcut yarıçapını dikkate al (çakışmayı önlemek için)
            const requiredClearance = newRadius + other.r;
            if (dist < requiredClearance) {
              // Bu taş için izin verilen max yarıçap = dist - other.r
              const allowed = Math.max(0.1, dist - other.r);
              minDistance = Math.min(minDistance, allowed);
            }
          }
        }
      }

      let finalRadius = newRadius;
      if (minDistance < newRadius) {
        finalRadius = Math.max(0.1, minDistance);
        anyLimited = true;
      }
      maxRadii.set(id, finalRadius);
    }

    if (anyLimited) {
      alert(tx("prod_size_limited", "Some stones could not be fully enlarged due to proximity to others. They have been resized to the maximum possible size without collision."));
    }

    // Yeni taş dizisini oluştur
    pushHistory(stones);
    setStones(prev =>
      prev.map(s => {
        if (!selected.has(s.id)) return s;
        const newR = maxRadii.get(s.id) ?? (rule.diameterMm / 2);
        return {
          ...s,
          ruleKey: rule.key,
          customColor: null,
          r: newR,
          layer: `SIZE_${rule.diameterMm.toFixed(2).replace(".", "_")}__${rule.key.toUpperCase()}`,
          colorIndex: rule.dxfColor,
        };
      })
    );
  };

  const deleteSelectedStones = () => {
    if (selected.size === 0) return;
    pushHistory(stones);
    setStones((prev) => prev.filter((s) => !selected.has(s.id)));
    setSelected(new Set());
  };

  const fitToView = () => {
    if (editorMode === "pattern") {
      if (!patternBounds || !patternCanvasRef.current) return;
      const w = patternCanvasRef.current.clientWidth;
      const h = patternCanvasRef.current.clientHeight;
      const width = Math.max(10, patternBounds.maxX - patternBounds.minX);
      const height = Math.max(10, patternBounds.maxY - patternBounds.minY);
      const nextZoom = Math.max(0.2, Math.min(80, Math.min((w - 60) / width, (h - 60) / height)));
      setZoom(nextZoom);
      setPan({
        x: 30 - patternBounds.minX * nextZoom,
        y: 30 + patternBounds.maxY * nextZoom,
      });
      return;
    }
    if (!stones.length || !canvasRef.current) return;
    const bb = stones.reduce(
      (acc, s) => ({
        minX: Math.min(acc.minX, s.x - s.r),
        minY: Math.min(acc.minY, s.y - s.r),
        maxX: Math.max(acc.maxX, s.x + s.r),
        maxY: Math.max(acc.maxY, s.y + s.r),
      }),
      { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY }
    );
    const w = canvasRef.current.clientWidth;
    const h = canvasRef.current.clientHeight;
    const width = Math.max(10, bb.maxX - bb.minX);
    const height = Math.max(10, bb.maxY - bb.minY);
    const nextZoom = Math.max(0.2, Math.min(80, Math.min((w - 60) / width, (h - 60) / height)));
    setZoom(nextZoom);
    setPan({ x: 30 - bb.minX * nextZoom, y: 30 - bb.minY * nextZoom });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        if (editorMode === "pattern") {
          setSelectedPatternPrimitives(new Set(patternPrimitives.map((_, i) => i)));
        } else {
          setSelected(new Set(stones.map((s) => s.id)));
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoLastChange();
      }
      if (e.key === "Escape") {
        setSelected(new Set());
        setSelectedPatternPrimitives(new Set());
        setSelectBox(null);
        setDragging(false);
        dragRef.current = {
          mode: "none",
          startMouseX: 0,
          startMouseY: 0,
          moved: false,
          historyPushed: false,
          selectedIds: new Set<number>(),
          originById: new Map<number, { x: number; y: number }>(),
          patternPrimitiveIds: new Set<number>(),
        };
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (editorMode === "pattern" && selectedPatternPrimitives.size > 0) {
          e.preventDefault();
          deleteSelectedPatternPrimitives();
        } else if (selected.size > 0) {
          e.preventDefault();
          deleteSelectedStones();
        }
      }
      if (e.key.toLowerCase() === "f") fitToView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stones, selected, editorMode, selectedPatternPrimitives, patternPrimitives]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((z) => Math.max(0.2, Math.min(80, z * (event.deltaY < 0 ? 1.08 : 0.92))));
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  useEffect(() => {
    if (editorMode !== "pattern") return;
    const canvas = patternCanvasRef.current;
    if (!canvas) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((z) => Math.max(0.2, Math.min(80, z * (event.deltaY < 0 ? 1.08 : 0.92))));
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [editorMode]);

  useEffect(() => {
    if (editorMode !== "pattern" || !patternBounds || !patternCanvasRef.current) return;
    const w = patternCanvasRef.current.clientWidth;
    const h = patternCanvasRef.current.clientHeight;
    const width = Math.max(10, patternBounds.maxX - patternBounds.minX);
    const height = Math.max(10, patternBounds.maxY - patternBounds.minY);
    const nextZoom = Math.max(0.2, Math.min(80, Math.min((w - 60) / width, (h - 60) / height)));
    setZoom(nextZoom);
    setPan({
      x: 30 - patternBounds.minX * nextZoom,
      y: 30 + patternBounds.maxY * nextZoom,
    });
  }, [editorMode, patternBounds]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const patternIdRaw = params.get("patternId");
    if (!patternIdRaw) return;
    const patternId = Number(patternIdRaw);
    if (!Number.isFinite(patternId)) return;
    void loadFromPatternId(patternId);
  }, []);

  const handleImportModeChange = (mode: ImportMode) => {
    setImportMode(mode);
    setEditorMode(mode);
    setDragging(false);
    setSelectBox(null);
    setSelected(new Set());
    setSelectedPatternPrimitives(new Set());
    dragRef.current = {
      mode: "none",
      startMouseX: 0,
      startMouseY: 0,
      moved: false,
      historyPushed: false,
      selectedIds: new Set<number>(),
      originById: new Map<number, { x: number; y: number }>(),
      patternPrimitiveIds: new Set<number>(),
    };
  };

  return (
  <main className="p-4 sm:p-6 min-h-screen">
    <div className="mb-6 rounded-2xl border border-border/70 bg-white/85 px-4 py-4 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/45 sm:px-5">
      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl xl:text-2xl">
              {editorMode === "pattern"
                ? tx("prod_pattern_vector_preview", "Pattern Vector Preview")
                : (t("production_optimization") || tx("production_optimization", "Production Optimization"))}
              <InfoHint
                text={
                  editorMode === "pattern"
                    ? tx("prod_pattern_mode_desc", "Vectors in pattern category are shown as pattern preview and are not forced into rhinestone mode.")
                    : "Import DXF/PNG/JPG/PDF, edit stones or vectors, then export DXF/SVG/PDF/PLT."
                }
              />
            </h1>
          </div>

          <p className="mt-1 text-sm text-muted-foreground break-words">
            {editorMode === "pattern"
              ? tx("prod_pattern_mode_desc", "")
              : ""}
          </p>

          {loadingFromPattern && (
            <p className="mt-1 text-xs font-medium text-primary">
              {tx("prod_loading_to_editor", "Loading design into Production Editor...")}
            </p>
          )}
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:w-auto 2xl:flex 2xl:flex-wrap 2xl:justify-end">
          <select
            value={importMode}
            onChange={(e) => handleImportModeChange(e.target.value as ImportMode)}
            className="h-10 min-w-0 rounded-xl border border-border/80 bg-primary px-3 text-sm shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            title={tx("prod_import_mode", "File import mode")}
          >
            <option value="pattern">{tx("prod_import_pattern", "Pattern Panel")}</option>
            <option value="rhinestone">{tx("prod_import_rhinestone", "Import: Rhinestone")}</option>
          </select>

          <DropdownMenu>
  <DropdownMenuTrigger asChild>
    <button className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90">
      File
    </button>
  </DropdownMenuTrigger>

  <DropdownMenuContent align="start">

    <DropdownMenuItem asChild>
      <label className="relative flex w-full cursor-pointer items-center">
        {isProcessing
          ? tx("prod_processing", "Processing...")
          : tx("prod_upload_file", "Upload File")}

        <input
          type="file"
          accept=".dxf,.png,.jpg,.jpeg,.pdf"
          className="hidden"
          onChange={(e) => onImportFile(e.target.files?.[0])}
          disabled={isProcessing}
        />
      </label>
    </DropdownMenuItem>

    <DropdownMenuItem onClick={saveEditorSession}>
      {tx("save", "Save")}
    </DropdownMenuItem>

    <DropdownMenuItem onClick={loadEditorSession}>
      {tx("load_saved", "Load Saved")}
    </DropdownMenuItem>

  </DropdownMenuContent>
</DropdownMenu>

          {editorMode === "rhinestone" ? (
            <>
              <button
                className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-primary/90"
                onClick={undoLastChange}
                disabled={!canUndo}
              >
                {tx("undo", "Undo")}
              </button>

              <button
                className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90"
                onClick={fitToView}
              >
                {tx("fit_view", "Fit View")}
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90">
                    {tx("export", "Export")}
                  </button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => downloadText(normalizeExportName("production-output", "dxf"), buildDxf(stones))}>
                    DXF
                  </DropdownMenuItem>

                  <DropdownMenuItem onClick={() => downloadText(normalizeExportName("production-output", "plt"), buildPlt(stones))}>
                    PLT
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    disabled={!stones.length}
                    onClick={async () => {
                      try {
                        const svg = buildRhinestoneSvg(stones, fillMode, true);
                        await exportSvgAsPdf(svg, normalizeExportName("production-output", "pdf"));
                      } catch (error) {
                        alert(error instanceof Error ? error.message : tx("pdf_export_failed", "PDF export failed."));
                      }
                    }}
                  >
                    PDF
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    disabled={!stones.length}
                    onClick={() => {
                      const svg = buildRhinestoneSvg(stones, fillMode, true);
                      downloadBlob(normalizeExportName("production-output", "svg"), new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
                    }}
                  >
                    SVG
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            
            <>
              
              
             {editorMode === "pattern" ? (
            <>
              <button
                className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-primary/90"
                onClick={undoLastChange}
                disabled={!canUndo}
              >
                {tx("undo", "Undo")}
              </button>

              <button
                className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90"
                onClick={fitToView}
              >
                {tx("fit_view", "Fit View")}
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90">
                    {tx("export", "Export")}
                  </button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => downloadText(normalizeExportName("production-output", "dxf"), buildDxf(stones))}>
                    DXF
                  </DropdownMenuItem>

                  <DropdownMenuItem onClick={() => downloadText(normalizeExportName("production-output", "plt"), buildPlt(stones))}>
                    PLT
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    disabled={!stones.length}
                    onClick={async () => {
                      try {
                        const svg = buildRhinestoneSvg(stones, fillMode, true);
                        await exportSvgAsPdf(svg, normalizeExportName("production-output", "pdf"));
                      } catch (error) {
                        alert(error instanceof Error ? error.message : tx("pdf_export_failed", "PDF export failed."));
                      }
                    }}
                  >
                    PDF
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    disabled={!stones.length}
                    onClick={() => {
                      const svg = buildRhinestoneSvg(stones, fillMode, true);
                      downloadBlob(normalizeExportName("production-output", "svg"), new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
                    }}
                  >
                    SVG
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null }
             </>
        

                        
              )}
              
            </div>
          </div>
        </div>
        {showArchiveLoader && (
          <div className="mb-4 rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">{tx("prod_load_from_archive", "Load Saved from Archive")}</h2>
              <div className="flex items-center gap-2">
                <button
                  className="px-2 py-1 rounded border border-border bg-white text-xs hover:bg-slate-50"
                  onClick={() => {
                    window.location.href = "/archive";
                  }}
                  
                >
                  {tx("go_archive", "Go to Archive")}
                </button>
                <button
                  className="px-2 py-1 rounded border border-border bg-white text-xs hover:bg-slate-50"
                  onClick={() => setShowArchiveLoader(false)}
                >
                  {tx("close", "Close")}
                </button>
              </div>
            </div>
            {archivedPatterns.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tx("prod_no_archive_items", "No saved production files found in archive.")}</p>
            ) : (
              <div className="max-h-60 overflow-auto rounded border border-border">
                {archivedPatterns.map((p) => (
                  <button
                    key={p.id}
                    className="w-full text-left px-3 py-2 border-b border-border last:border-b-0 hover:bg-slate-50"
                    onClick={async () => {
                      setShowArchiveLoader(false);
                      await loadFromPatternId(p.id);
                    }}
                  >
                    <div className="text-sm font-medium text-foreground">
                      {p.name?.trim() || `pattern-${p.id}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      #{p.id} · {p.category ?? "pattern"} · {p.status}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-[320px_1fr] gap-4 h-[calc(100vh-120px)]">
          <section className="rounded-xl border border-border bg-white p-4 overflow-auto">
            {editorMode === "pattern" ? (
              <div className="space-y-3 text-sm">
                <p className="font-semibold text-foreground">{tx("prod_pattern_mode", "Pattern Mode")}</p>
                <p className="text-muted-foreground">
                  {tx("prod_pattern_mode_real_preview", "This record is not rhinestone. Production editor opened it as real vector preview without circle conversion.")}
                </p>
                <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-1">
                  <div className="flex justify-between">
                    <span>Pattern ID:</span>
                    <b>{patternPreview?.patternId ?? "-"}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>{tx("category", "Category")}:</span>
                    <b>{patternPreview?.category ?? "-"}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>{tx("import_type", "Import Type")}:</span>
                    <b className="text-primary">{lastImportType || "-"}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>{tx("dxf_entities", "DXF Entities")}:</span>
                    <b>{patternPrimitives.length}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>{tx("layer", "Layer")}:</span>
                    <b>{patternLayers.length}</b>
                  </div>
                  <div className="pt-1">
                    <div className="flex items-center justify-between">
                      <span>{tx("line_thickness", "Line Thickness")}:</span>
                      <b>{patternStrokeWidth.toFixed(1)} px</b>
                    </div>
                    <input
                      type="range"
                      min={0.4}
                      max={6}
                      step={0.1}
                      value={patternStrokeWidth}
                      onChange={(e) => setPatternStrokeWidth(Number(e.target.value))}
                      className="w-full mt-1"
                    />
                  </div>
                </div>
                {patternLayers.length > 0 && (
                  <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-2">
                    <p className="font-semibold text-foreground">{tx("layer_visibility", "Layer Visibility")}</p>
                    {patternLayers.map((layer) => {
                      const visible = !hiddenPatternLayers.has(layer);
                      return (
                        <label key={layer} className="flex items-center justify-between gap-2">
                          <span className="truncate">{layer}</span>
                          <input
                            type="checkbox"
                            checked={visible}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setHiddenPatternLayers((prev) => {
                                const next = new Set(prev);
                                if (checked) next.delete(layer);
                                else next.add(layer);
                                return next;
                              });
                            }}
                          />
                        </label>
                      );
                    })}
                    <button
                      className="w-full mt-1 px-2 py-1 rounded border border-border hover:bg-white"
                      onClick={() => setHiddenPatternLayers(new Set())}
                    >
                      {tx("show_all_layers", "Show All Layers")}
                    </button>
                    <button
                      className="w-full px-2 py-1 rounded border border-border hover:bg-white"
                      onClick={() => setIsolatePatternSelection((v) => !v)}
                    >
                      {isolatePatternSelection ? tx("disable_isolate", "Disable Isolate") : tx("isolate_clicked_part", "Isolate Clicked Part")}
                    </button>
                  </div>
                )}
                <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-2">
                  <p className="font-semibold text-foreground">{tx("selected_linear_item", "Selected Linear Item")}</p>
                  <div className="flex justify-between">
                    <span>{tx("selection", "Selection")}:</span>
                    <b>{selectedPatternPrimitives.size === 0 ? "-" : `${selectedPatternPrimitives.size} ${tx("items", "items")}`}</b>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className="px-2 py-1 rounded border border-border hover:bg-white disabled:opacity-50"
                      disabled={!patternPrimitives.length}
                      onClick={() => setSelectedPatternPrimitives(new Set(patternPrimitives.map((_, i) => i)))}
                    >
                      {tx("select_all", "Select All")}
                    </button>
                    <button
                      className="px-2 py-1 rounded border border-border hover:bg-white disabled:opacity-50"
                      disabled={selectedPatternPrimitives.size === 0}
                      onClick={() => setSelectedPatternPrimitives(new Set())}
                    >
                      {tx("clear_selection", "Clear Selection")}
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>{tx("color", "Color")}:</span>
                    <input
                      type="color"
                      value={
                        primarySelectedPatternPrimitive !== null
                          ? (patternPrimitives[primarySelectedPatternPrimitive]?.color ?? "#111827")
                          : "#111827"
                      }
                      disabled={selectedPatternPrimitives.size === 0}
                      onChange={(e) => setSelectedPatternPrimitiveColor(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className="px-2 py-1 rounded border border-border hover:bg-white disabled:opacity-50"
                      disabled={selectedPatternPrimitives.size === 0}
                      onClick={() => scaleSelectedPatternPrimitive(0.9)}
                    >
                      {tx("shrink", "Shrink")}
                    </button>
                    <button
                      className="px-2 py-1 rounded border border-border hover:bg-white disabled:opacity-50"
                      disabled={selectedPatternPrimitives.size === 0}
                      onClick={() => scaleSelectedPatternPrimitive(1.1)}
                    >
                      {tx("grow", "Grow")}
                    </button>
                  </div>
                  <button
                    className="w-full px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                    disabled={selectedPatternPrimitives.size === 0}
                    onClick={deleteSelectedPatternPrimitives}
                  >
                    {tx("delete_selected_items", "Delete Selected Items")} ({selectedPatternPrimitives.size})
                  </button>
                </div>

                
                <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-800">
                  <p>{tx("prod_dxf_workspace_hint", "In DXF workspace view:")}</p>
                  <ul className="list-disc list-inside space-y-1 mt-1">
                    <li>{tx("prod_click_to_select_item", "Click to select an item")}</li>
                    <li>{tx("prod_drag_selected_item", "Drag selected item to move")}</li>
                    <li>{tx("prod_scroll_zoom_drag_pan", "Scroll to zoom, drag to pan")}</li>
                    <li>{tx("prod_isolate_from_right_panel", "Use isolate button on right panel")}</li>
                  </ul>
                </div>
              </div>

              
            ) : (

              
              <>
            <p className="text-sm font-semibold mb-2">{tx("prod_color_size_rules", "Color-Size Rules")}</p>
            <div className="space-y-2">
              {RULES.map((r) => (
                <button
                  key={r.key}
                  className={`w-full text-left px-3 py-2 rounded border transition-colors ${
                    activeRule === r.key 
                      ? "border-primary bg-primary/10 ring-1 ring-primary" 
                      : "border-border hover:bg-slate-50"
                  }`}
                  onClick={() => setActiveRule(r.key)}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{tx(r.labelKey, r.label)}</span>
                    <span 
                      className="inline-block w-4 h-4 rounded-full border border-slate-300" 
                      style={{ backgroundColor: r.color }} 
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Ø{r.diameterMm}mm / {tx("hole", "Hole")} Ø{r.holeMm}mm / {tx("speed", "Speed")} {r.speed} / {tx("pressure", "Pressure")} {r.pressure}
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-2">
              <button 
                className="w-full px-3 py-2 rounded bg-primary text-primary-foreground text-sm font-medium" 
                onClick={applyRuleToSelection}
              >
                {tx("apply_to_selected_stones", "Apply to Selected Stones")} ({selected.size})
              </button>
              <button 
                className="w-full px-3 py-2 rounded border border-border text-sm hover:bg-slate-50" 
                onClick={() => setSelected(new Set(stones.map((s) => s.id)))}
              >
                {tx("select_all", "Select All")}
              </button>
              <button 
                className="w-full px-3 py-2 rounded border border-border text-sm hover:bg-slate-50" 
                onClick={() => setSelected(new Set())}
              >
                {tx("clear_selection", "Clear Selection")}
              </button>
              <button
                className="w-full px-3 py-2 rounded border border-red-200 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                onClick={deleteSelectedStones}
                disabled={selected.size === 0}
              >
                {tx("delete_selected_stones", "Delete Selected Stones")} ({selected.size})
              </button>
            </div>

            <button 
        onClick={handleSendToControl}
        className="bg-blue-600 p-2 rounded-lg font-bold text-white shadow-lg hover:bg-blue-700 transition-all items-center justify-center w-full mt-4"
      >
        {tx("send_to_machine", "Send to Machine")}
      </button>

            <div className="mt-4 space-y-2 text-xs text-muted-foreground">
              <label className="flex items-center justify-between p-2 rounded hover:bg-slate-50 cursor-pointer">
                <span>{tx("fill_mode", "Fill Mode")}</span>
                <input 
                  type="checkbox" 
                  checked={fillMode} 
                  onChange={(e) => setFillMode(e.target.checked)} 
                />
              </label>
              <label className="flex items-center justify-between p-2 rounded hover:bg-slate-50 cursor-pointer">
                <span>{tx("selection_outline", "Selection Outline")}</span>
                <input 
                  type="checkbox" 
                  checked={showSelection} 
                  onChange={(e) => setShowSelection(e.target.checked)} 
                />
              </label>
            </div>



            <div className="mt-4 p-3 bg-slate-50 rounded-lg text-xs">
              <div className="flex justify-between mb-1">
                <span>{tx("import_type", "Import Type")}:</span>
                <b className="text-primary">{lastImportType || "-"}</b>
              </div>
              <div className="flex justify-between mb-1">
                <span>{tx("total_stones", "Total Stones")}:</span>
                <b className="text-foreground">{stones.length}</b>
              </div>
              <div className="flex justify-between mb-1">
                <span>{tx("selected", "Selected")}:</span>
                <b className="text-primary">{selected.size}</b>
              </div>
              <div className="flex justify-between mb-1">
                <span>{tx("zoom", "Zoom")}:</span>
                <b>{zoom.toFixed(1)}x</b>
              </div>
            </div>

            <div className="mt-4 text-xs">
              <p className="font-semibold mb-2 text-foreground">{tx("distribution_report", "Distribution Report")}:</p>
              <div className="space-y-1">
                <div className="flex justify-between text-muted-foreground">
                  <span>{tx("unassigned", "Unassigned")}</span>
                  <b className={stats.unassigned > 0 ? "text-amber-500" : "text-emerald-600"}>
                    {stats.unassigned}
                  </b>
                </div>
                {RULES.map((r) => (
                  <div key={r.key} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span 
                        className="w-2 h-2 rounded-full" 
                        style={{ backgroundColor: r.color }}
                      />
                      <span className="text-muted-foreground">{tx(r.labelKey, r.label)}</span>
                      
                    </div>
                    <b className="text-foreground">{stats.byRule.get(r.key) ?? 0}</b>
                  </div>
                ))}
              </div>
            </div>
            

            <div className="mt-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-800">
              <ul className="space-y-1 list-disc list-inside">              
              </ul>
              <p className="font-semibold mt-2 mb-1">{tx("shortcuts", "Shortcuts")}:</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>{tx("shortcut_select_all", "Ctrl+A: Select all")}</li>
                <li>{tx("shortcut_undo", "Ctrl+Z: Undo")}</li>
                <li>{tx("shortcut_box_select", "Shift+Drag: Box selection")}</li>
                <li>{tx("shortcut_drag_move", "Drag selected stone: Move")}</li>
                <li>{tx("shortcut_delete_selected", "Delete/Backspace: Delete selected stones")}</li>
                <li>{tx("shortcut_fit_view", "F: Fit to view")}</li>
                <li>{tx("shortcut_clear_selection", "ESC: Clear selection")}</li>
              </ul>
            </div>



            
              </>
            )}
          </section>

          

          <section className="rounded-xl border border-border bg-black/90 overflow-hidden relative">
            {isProcessing && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
                <div className="bg-white p-4 rounded-lg shadow-lg text-center">
                  <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2"></div>
                  <p className="text-sm font-medium">{tx("prod_image_processing", "Processing image...")}</p>
                  <p className="text-xs text-muted-foreground">{tx("prod_detecting_circles", "Detecting circles")}</p>
                </div>
              </div>
            )}
            
            {editorMode === "pattern" ? (
              patternPrimitives.length > 0 ? (
                <canvas
                  ref={patternCanvasRef}
                  className="w-full h-full cursor-grab active:cursor-grabbing bg-white touch-none"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    if (e.shiftKey) {
                      setSelectBox({
                        x0: e.nativeEvent.offsetX,
                        y0: e.nativeEvent.offsetY,
                        x1: e.nativeEvent.offsetX,
                        y1: e.nativeEvent.offsetY,
                      });
                      return;
                    }
                    const mx = e.nativeEvent.offsetX;
                    const my = e.nativeEvent.offsetY;
                    const picked = pickPatternPrimitiveAt(mx, my);
                    const toggleMulti = e.ctrlKey || e.metaKey;
                    if (toggleMulti && picked !== null) {
                      setSelectedPatternPrimitives((prev) => {
                        const next = new Set(prev);
                        if (next.has(picked)) next.delete(picked);
                        else next.add(picked);
                        return next;
                      });
                      return;
                    }
                    let activeSelection = selectedPatternPrimitives;
                    if (picked !== null) {
                      if (!selectedPatternPrimitives.has(picked)) {
                        activeSelection = new Set(selectedPatternPrimitives);
                        activeSelection.add(picked);
                        setSelectedPatternPrimitives(activeSelection);
                      }
                    }
                    setDragging(true);
                    dragRef.current = {
                      mode: picked === null ? "pan" : "move",
                      startMouseX: mx,
                      startMouseY: my,
                      moved: false,
                      historyPushed: false,
                      selectedIds: new Set<number>(),
                      originById: new Map<number, { x: number; y: number }>(),
                      patternPrimitiveIds: picked === null ? new Set<number>() : new Set(activeSelection),
                    };
                  }}
                  onPointerMove={(e) => {
                    if (selectBox) {
                      setSelectBox((s) =>
                        s ? { ...s, x1: e.nativeEvent.offsetX, y1: e.nativeEvent.offsetY } : s
                      );
                      return;
                    }
                    if (!dragging) return;
                    const isMove = dragRef.current.mode === "move";
                    const ids = dragRef.current.patternPrimitiveIds;
                    if (isMove && ids.size > 0) {
                      const dxPx = e.nativeEvent.offsetX - dragRef.current.startMouseX;
                      const dyPx = e.nativeEvent.offsetY - dragRef.current.startMouseY;
                      if (Math.abs(dxPx) > 0 || Math.abs(dyPx) > 0) {
                        dragRef.current.moved = true;
                      }
                      const dxMm = dxPx / Math.max(0.2, zoom);
                      const dyMm = -dyPx / Math.max(0.2, zoom);
                      dragRef.current.startMouseX = e.nativeEvent.offsetX;
                      dragRef.current.startMouseY = e.nativeEvent.offsetY;
                      movePatternPrimitives(ids, dxMm, dyMm);
                      return;
                    }
                    const panDx = e.nativeEvent.offsetX - dragRef.current.startMouseX;
                    const panDy = e.nativeEvent.offsetY - dragRef.current.startMouseY;
                    if (Math.abs(panDx) > 0 || Math.abs(panDy) > 0) {
                      dragRef.current.moved = true;
                    }
                    setPan((p) => ({ x: p.x + panDx, y: p.y + panDy }));
                    dragRef.current.startMouseX = e.nativeEvent.offsetX;
                    dragRef.current.startMouseY = e.nativeEvent.offsetY;
                  }}
                  onPointerUp={() => {
                    if (selectBox) {
                      const x0 = Math.min(selectBox.x0, selectBox.x1);
                      const y0 = Math.min(selectBox.y0, selectBox.y1);
                      const x1 = Math.max(selectBox.x0, selectBox.x1);
                      const y1 = Math.max(selectBox.y0, selectBox.y1);
                      const worldMinX = (x0 - pan.x) / zoom;
                      const worldMaxX = (x1 - pan.x) / zoom;
                      const worldMaxY = (pan.y - y0) / zoom;
                      const worldMinY = (pan.y - y1) / zoom;
                      const ids = new Set<number>();
                      for (let i = 0; i < patternPrimitives.length; i += 1) {
                        const p = patternPrimitives[i];
                        if (hiddenPatternLayers.has(p.layer)) continue;
                        const b = getPatternPrimitiveBounds(p);
                        const intersects =
                          b.maxX >= worldMinX &&
                          b.minX <= worldMaxX &&
                          b.maxY >= worldMinY &&
                          b.minY <= worldMaxY;
                        if (intersects) ids.add(i);
                      }
                      setSelectedPatternPrimitives((prev) => {
                        const next = new Set(prev);
                        ids.forEach((id) => next.add(id));
                        return next;
                      });
                      setSelectBox(null);
                      return;
                    }
                    setDragging(false);
                    dragRef.current = {
                      mode: "none",
                      startMouseX: 0,
                      startMouseY: 0,
                      moved: false,
                      historyPushed: false,
                      selectedIds: new Set<number>(),
                      originById: new Map<number, { x: number; y: number }>(),
                      patternPrimitiveIds: new Set<number>(),
                    };
                  }}
                  onPointerCancel={() => {
                    setDragging(false);
                    dragRef.current = {
                      mode: "none",
                      startMouseX: 0,
                      startMouseY: 0,
                      moved: false,
                      historyPushed: false,
                      selectedIds: new Set<number>(),
                      originById: new Map<number, { x: number; y: number }>(),
                      patternPrimitiveIds: new Set<number>(),
                    };
                  }}
                  onPointerLeave={() => {
                    setDragging(false);
                    dragRef.current = {
                      mode: "none",
                      startMouseX: 0,
                      startMouseY: 0,
                      moved: false,
                      historyPushed: false,
                      selectedIds: new Set<number>(),
                      originById: new Map<number, { x: number; y: number }>(),
                      patternPrimitiveIds: new Set<number>(),
                    };
                  }}
                />
              ) : (
                <div className="w-full h-full bg-white">
                  {patternPreview?.isPdf ? (
                    <iframe
                      src={`${withApiBase(patternPreview.previewUrl)}?v=${patternPreview.patternId}`}
                      className="w-full h-full border-0"
                      title="Pattern Vector PDF Preview"
                    />
                  ) : (
                    <img
                      src={`${withApiBase(patternPreview?.previewUrl ?? "")}?v=${patternPreview?.patternId ?? "preview"}`}
                      alt={tx("prod_pattern_vector_preview", "Pattern Vector Preview")}
                      className="w-full h-full object-contain"
                    />
                  )}
                </div>
              )
            ) : (
            <canvas
              ref={canvasRef}
              className="w-full h-full cursor-crosshair touch-none"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                if (e.shiftKey) {
                  setSelectBox({ 
                    x0: e.nativeEvent.offsetX, 
                    y0: e.nativeEvent.offsetY, 
                    x1: e.nativeEvent.offsetX, 
                    y1: e.nativeEvent.offsetY 
                  });
                  return;
                }
                const mouseX = e.nativeEvent.offsetX;
                const mouseY = e.nativeEvent.offsetY;
                const pickedId = pickAt(mouseX, mouseY);
                const toggleMulti = e.ctrlKey || e.metaKey;
                if (toggleMulti && pickedId) {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(pickedId)) next.delete(pickedId);
                    else next.add(pickedId);
                    return next;
                  });
                  return;
                }
                const selectedIds =
                  pickedId && selected.has(pickedId)
                    ? new Set(selected)
                    : pickedId
                      ? (() => {
                          const next = new Set(selected);
                          next.add(pickedId);
                          return next;
                        })()
                      : new Set<number>();

                if (pickedId && !selected.has(pickedId)) {
                  setSelected(selectedIds);
                }

                if (selectedIds.size > 0) {
                  const originById = new Map<number, { x: number; y: number }>();
                  for (const s of stones) {
                    if (selectedIds.has(s.id)) {
                      originById.set(s.id, { x: s.x, y: s.y });
                    }
                  }
                  dragRef.current = {
                    mode: "move",
                    startMouseX: mouseX,
                    startMouseY: mouseY,
                    moved: false,
                    historyPushed: false,
                    selectedIds,
                    originById,
                    patternPrimitiveIds: new Set<number>(),
                  };
                } else {
                  dragRef.current = {
                    mode: "pan",
                    startMouseX: mouseX,
                    startMouseY: mouseY,
                    moved: false,
                    historyPushed: false,
                    selectedIds: new Set<number>(),
                    originById: new Map<number, { x: number; y: number }>(),
                    patternPrimitiveIds: new Set<number>(),
                  };
                }
                setDragging(true);
              }}
              onPointerMove={(e) => {
                if (selectBox) {
                  setSelectBox((s) => 
                    s ? { ...s, x1: e.nativeEvent.offsetX, y1: e.nativeEvent.offsetY } : s
                  );
                  return;
                }
                if (!dragging) return;
                if (dragRef.current.mode === "move") {
                  const dxMm = (e.nativeEvent.offsetX - dragRef.current.startMouseX) / zoom;
                  const dyMm = (e.nativeEvent.offsetY - dragRef.current.startMouseY) / zoom;
                  if (Math.abs(dxMm) > 0.001 || Math.abs(dyMm) > 0.001) {
                    dragRef.current.moved = true;
                    if (!dragRef.current.historyPushed) {
                      pushHistory(stones);
                      dragRef.current.historyPushed = true;
                    }
                  }
                  setStones((prev) =>
                    prev.map((s) => {
                      const origin = dragRef.current.originById.get(s.id);
                      if (!origin) return s;
                      return {
                        ...s,
                        x: origin.x + dxMm,
                        y: origin.y + dyMm,
                      };
                    })
                  );
                  return;
                }
                const panDx = e.nativeEvent.offsetX - dragRef.current.startMouseX;
                const panDy = e.nativeEvent.offsetY - dragRef.current.startMouseY;
                dragRef.current.moved =
                  dragRef.current.moved || Math.abs(panDx) > 0 || Math.abs(panDy) > 0;
                setPan((p) => ({ x: p.x + panDx, y: p.y + panDy }));
                dragRef.current.startMouseX = e.nativeEvent.offsetX;
                dragRef.current.startMouseY = e.nativeEvent.offsetY;
              }}
              onPointerUp={(e) => {
                if (selectBox) {
                  const x0 = Math.min(selectBox.x0, selectBox.x1);
                  const y0 = Math.min(selectBox.y0, selectBox.y1);
                  const x1 = Math.max(selectBox.x0, selectBox.x1);
                  const y1 = Math.max(selectBox.y0, selectBox.y1);
                  const wx0 = (x0 - pan.x) / zoom;
                  const wy0 = (y0 - pan.y) / zoom;
                  const wx1 = (x1 - pan.x) / zoom;
                  const wy1 = (y1 - pan.y) / zoom;
                  const gx0 = Math.floor(wx0 / cellSizeMm);
                  const gy0 = Math.floor(wy0 / cellSizeMm);
                  const gx1 = Math.floor(wx1 / cellSizeMm);
                  const gy1 = Math.floor(wy1 / cellSizeMm);
                  const ids = new Set<number>();
                  for (let gx = gx0; gx <= gx1; gx += 1) {
                    for (let gy = gy0; gy <= gy1; gy += 1) {
                      const bucket = spatialIndex.get(`${gx}:${gy}`);
                      if (!bucket) continue;
                      for (const s of bucket) {
                        const cx = pan.x + s.x * zoom;
                        const cy = pan.y + s.y * zoom;
                        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) ids.add(s.id);
                      }
                    }
                  }
                  setSelected((prev) => {
                    const next = new Set(prev);
                    ids.forEach((id) => next.add(id));
                    return next;
                  });
                  setSelectBox(null);
                  return;
                }
                const mode = dragRef.current.mode;
                const moved = dragRef.current.moved;
                setDragging(false);
                dragRef.current = {
                  mode: "none",
                  startMouseX: 0,
                  startMouseY: 0,
                  moved: false,
                  historyPushed: false,
                  selectedIds: new Set<number>(),
                  originById: new Map<number, { x: number; y: number }>(),
                  patternPrimitiveIds: new Set<number>(),
                };

                if (mode === "move") return;
                if (moved) return;

                const id = pickAt(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
                if (!id) return;
                setSelected((prev) => {
                  const next = new Set(prev);
                  next.add(id);
                  return next;
                });
              }}
              onPointerCancel={() => {
                setDragging(false);
                dragRef.current = {
                  mode: "none",
                  startMouseX: 0,
                  startMouseY: 0,
                  moved: false,
                  historyPushed: false,
                  selectedIds: new Set<number>(),
                  originById: new Map<number, { x: number; y: number }>(),
                  patternPrimitiveIds: new Set<number>(),
                };
              }}
            />
            )}
            
            {editorMode === "rhinestone" && (
              <div className="absolute top-4 right-4 bg-black/70 text-white text-xs px-3 py-2 rounded-lg backdrop-blur">
                <div>{tx("prod_mouse_help", "Touch/Mouse: Tap = Select | Shift+Drag = Box selection")}</div>
                <div>{tx("prod_scroll_help", "Scroll: Zoom in/out | Drag = Pan")}</div>
              </div>
            )}
            {editorMode === "pattern" && patternPrimitives.length > 0 && (
              <div className="absolute top-4 right-4 bg-black/70 text-white text-xs px-3 py-2 rounded-lg backdrop-blur">
                <div>{tx("prod_dxf_view_active", "DXF workspace view active")}</div>
                <div>{tx("prod_scroll_help", "Scroll: Zoom in/out | Drag = Pan")}</div>
              </div>
            )}
          </section>
        </div>
      </main>
  );
}

