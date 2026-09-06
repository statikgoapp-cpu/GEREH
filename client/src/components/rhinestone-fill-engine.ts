export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface Stone {
  x: number;
  y: number;
  radius: number;
  ssSize: string;
  color: RGB;
}

export interface StonePattern {
  stones: Stone[];
  width: number;
  height: number;
  totalStones: number;
  colorGroups: { color: RGB; count: number }[];
}

export interface FillOptions {
  ssSizes: number[];
  spacing: number;
  gridType: "hex";
  colorMode: "preserve";
  density: number;
  numColors: number;
  multiSize: boolean;
  stoneStyle: "filled" | "outline";
}

export const SS_SIZE_MAP: Record<string, number> = {
  SS2: 0.7,
  SS4: 1.2,
  SS6: 2.0,
  SS10: 3.0,
  SS16: 4.0,
  SS20: 5.0,
  SS30: 6.5,
};

export const DEFAULT_OPTIONS: FillOptions = {
  ssSizes: [0.7, 1.2],
  spacing: 0.3,
  gridType: "hex",
  colorMode: "preserve",
  density: 0.85,
  numColors: 5,
  multiSize: true,
  stoneStyle: "filled",
};

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let rn = r / 255;
  let gn = g / 255;
  let bn = b / 255;

  rn = rn > 0.04045 ? Math.pow((rn + 0.055) / 1.055, 2.4) : rn / 12.92;
  gn = gn > 0.04045 ? Math.pow((gn + 0.055) / 1.055, 2.4) : gn / 12.92;
  bn = bn > 0.04045 ? Math.pow((bn + 0.055) / 1.055, 2.4) : bn / 12.92;

  const x = (rn * 0.4124 + gn * 0.3576 + bn * 0.1805) / 0.95047;
  const y = (rn * 0.2126 + gn * 0.7152 + bn * 0.0722) / 1.0;
  const z = (rn * 0.0193 + gn * 0.1192 + bn * 0.9505) / 1.08883;

  const f = (t: number) =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;

  const L = 116 * f(y) - 16;
  const a = 500 * (f(x) - f(y));
  const bv = 200 * (f(y) - f(z));

  return [L, a, bv];
}

function colorDistance(a: RGB, b: RGB): number {
  const [L1, a1, b1] = rgbToLab(a.r, a.g, a.b);
  const [L2, a2, b2] = rgbToLab(b.r, b.g, b.b);
  return Math.sqrt(
    (L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2
  );
}

function kMeansClustering(
  pixels: RGB[],
  k: number,
  maxIter = 20
): RGB[] {
  const step = Math.max(1, Math.floor(pixels.length / k));
  let centroids: RGB[] = [];
  for (let i = 0; i < k; i++) {
    centroids.push({ ...pixels[i * step] });
  }

  for (let iter = 0; iter < maxIter; iter++) {
    const clusters: RGB[][] = Array.from({ length: k }, () => []);

    for (const px of pixels) {
      let minDist = Infinity;
      let minIdx = 0;
      for (let i = 0; i < k; i++) {
        const d = colorDistance(px, centroids[i]);
        if (d < minDist) {
          minDist = d;
          minIdx = i;
        }
      }
      clusters[minIdx].push(px);
    }

    let moved = false;
    for (let i = 0; i < k; i++) {
      if (clusters[i].length === 0) continue;
      const nr =
        Math.round(clusters[i].reduce((s, c) => s + c.r, 0) / clusters[i].length);
      const ng =
        Math.round(clusters[i].reduce((s, c) => s + c.g, 0) / clusters[i].length);
      const nb =
        Math.round(clusters[i].reduce((s, c) => s + c.b, 0) / clusters[i].length);
      if (nr !== centroids[i].r || ng !== centroids[i].g || nb !== centroids[i].b) {
        moved = true;
      }
      centroids[i] = { r: nr, g: ng, b: nb };
    }
    if (!moved) break;
  }

  return centroids;
}

function buildMask(
  imageData: ImageData,
  centroid: RGB,
  allCentroids: RGB[]
): Uint8Array {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      if (alpha < 10) continue;

      const px: RGB = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
      let minDist = Infinity;
      let minCentroid = 0;
      for (let c = 0; c < allCentroids.length; c++) {
        const d = colorDistance(px, allCentroids[c]);
        if (d < minDist) {
          minDist = d;
          minCentroid = c;
        }
      }
      if (allCentroids[minCentroid] === centroid) {
        mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

function distanceTransform(mask: Uint8Array, width: number, height: number): Float32Array {
  const dist = new Float32Array(width * height);
  const INF = 1e9;

  for (let i = 0; i < dist.length; i++) {
    dist[i] = mask[i] ? INF : 0;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) { dist[i] = 0; continue; }
      const top = y > 0 ? dist[(y - 1) * width + x] + 1 : INF;
      const left = x > 0 ? dist[y * width + x - 1] + 1 : INF;
      dist[i] = Math.min(INF, Math.min(top, left));
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!mask[i]) { dist[i] = 0; continue; }
      const bot = y < height - 1 ? dist[(y + 1) * width + x] + 1 : INF;
      const right = x < width - 1 ? dist[y * width + x + 1] + 1 : INF;
      dist[i] = Math.min(dist[i], Math.min(bot, right));
    }
  }

  return dist;
}

function sampleColor(imageData: ImageData, x: number, y: number): RGB {
  const { width, height, data } = imageData;
  const px = Math.max(0, Math.min(width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(height - 1, Math.round(y)));
  const idx = (py * width + px) * 4;
  return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
}

function ssLabel(radiusPx: number, scale: number): string {
  const radiusMm = radiusPx / scale;
  const diam = radiusMm * 2;
  if (diam >= 6.0) return "SS30";
  if (diam >= 4.5) return "SS20";
  if (diam >= 3.5) return "SS16";
  if (diam >= 2.5) return "SS10";
  if (diam >= 1.6) return "SS6";
  if (diam >= 1.0) return "SS4";
  return "SS2";
}

function placeStones(
  imageData: ImageData,
  mask: Uint8Array,
  dist: Float32Array,
  radiusPx: number,
  spacing: number,
  density: number,
  scale: number
): Stone[] {
  const { width, height } = imageData;
  const stones: Stone[] = [];
  const minDist = dist;

  const gridSpacingX = radiusPx * 2 + spacing * scale;
  const gridSpacingY = gridSpacingX * (Math.sqrt(3) / 2);

  const threshold = radiusPx * density;

  for (let row = 0; row * gridSpacingY < height + radiusPx; row++) {
    const offsetX = row % 2 === 0 ? 0 : gridSpacingX / 2;
    for (let col = 0; col * gridSpacingX - offsetX < width + radiusPx; col++) {
      const cx = col * gridSpacingX - offsetX + radiusPx;
      const cy = row * gridSpacingY + radiusPx;

      if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;

      const px = Math.round(cx);
      const py = Math.round(cy);
      const maskVal = mask[py * width + px];
      if (!maskVal) continue;

      const d = minDist[py * width + px];
      if (d < threshold) continue;

      const color = sampleColor(imageData, cx, cy);
      stones.push({
        x: cx,
        y: cy,
        radius: radiusPx,
        ssSize: ssLabel(radiusPx, scale),
        color,
      });
    }
  }

  return stones;
}

function buildOccupancyMap(
  stones: Stone[],
  width: number,
  height: number
): Set<number> {
  const occupied = new Set<number>();
  for (const s of stones) {
    const r = Math.ceil(s.radius);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= s.radius * s.radius) {
          const px = Math.round(s.x + dx);
          const py = Math.round(s.y + dy);
          if (px >= 0 && px < width && py >= 0 && py < height) {
            occupied.add(py * width + px);
          }
        }
      }
    }
  }
  return occupied;
}

function buildSmallStoneMask(
  mask: Uint8Array,
  occupied: Set<number>,
  width: number,
  height: number
): Uint8Array {
  const newMask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && !occupied.has(i)) {
      newMask[i] = 1;
    }
  }
  return newMask;
}

export async function generateRhinestonePattern(
  imageData: ImageData,
  options: FillOptions
): Promise<StonePattern> {
  const { width, height, data } = imageData;

  const pixels: RGB[] = [];
  const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 80));
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] < 10) continue;
      pixels.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  if (pixels.length === 0) {
    return { stones: [], width, height, totalStones: 0, colorGroups: [] };
  }

  const k = Math.min(options.numColors, Math.max(2, pixels.length > 10 ? options.numColors : 2));
  const centroids = kMeansClustering(pixels, k);

  const scale = Math.min(width, height) / 100;
  const allStones: Stone[] = [];

  const sortedSizes = [...options.ssSizes].sort((a, b) => b - a);

  for (const centroid of centroids) {
    const mask = buildMask(imageData, centroid, centroids);
    const dist = distanceTransform(mask, width, height);

    if (options.multiSize && sortedSizes.length > 1) {
      const largeRadius = (sortedSizes[0] / 2) * scale;
      const largeStones = placeStones(
        imageData, mask, dist, largeRadius,
        options.spacing, options.density, scale
      );

      const occupied = buildOccupancyMap(largeStones, width, height);
      const smallMask = buildSmallStoneMask(mask, occupied, width, height);
      const smallDist = distanceTransform(smallMask, width, height);
      const smallRadius = (sortedSizes[sortedSizes.length - 1] / 2) * scale;
      const smallStones = placeStones(
        imageData, smallMask, smallDist, smallRadius,
        options.spacing, options.density, scale
      );

      allStones.push(...largeStones, ...smallStones);
    } else {
      const radius = (sortedSizes[0] / 2) * scale;
      const stones = placeStones(
        imageData, mask, dist, radius,
        options.spacing, options.density, scale
      );
      allStones.push(...stones);
    }
  }

  const minSep = (options.ssSizes[options.ssSizes.length - 1] / 2) * scale * 1.8;
  const finalStones = removeCollisions(allStones, minSep);

  const colorGroups = computeColorGroups(finalStones, centroids);

  return {
    stones: finalStones,
    width,
    height,
    totalStones: finalStones.length,
    colorGroups,
  };
}

function removeCollisions(stones: Stone[], minSep: number): Stone[] {
  const sorted = [...stones].sort((a, b) => b.radius - a.radius);
  const kept: Stone[] = [];

  for (const s of sorted) {
    let overlap = false;
    for (const k of kept) {
      const dx = s.x - k.x;
      const dy = s.y - k.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < s.radius + k.radius + minSep * 0.1) {
        overlap = true;
        break;
      }
    }
    if (!overlap) {
      kept.push(s);
    }
  }

  return kept;
}

function computeColorGroups(
  stones: Stone[],
  centroids: RGB[]
): { color: RGB; count: number }[] {
  const groups: { color: RGB; count: number }[] = centroids.map((c) => ({
    color: c,
    count: 0,
  }));

  for (const s of stones) {
    let minDist = Infinity;
    let minIdx = 0;
    for (let i = 0; i < centroids.length; i++) {
      const d = colorDistance(s.color, centroids[i]);
      if (d < minDist) {
        minDist = d;
        minIdx = i;
      }
    }
    groups[minIdx].count++;
  }

  return groups.filter((g) => g.count > 0);
}

export function generateSVG(pattern: StonePattern, stoneStyle: "filled" | "outline" = "filled"): string {
  const { stones, width, height } = pattern;
  const circles = stones
    .map((s) => {
      if (stoneStyle === "outline") {
        const sw = Math.max(0.8, s.radius * 0.18);
        return `<circle cx="${s.x.toFixed(2)}" cy="${s.y.toFixed(2)}" r="${s.radius.toFixed(2)}" fill="none" stroke="rgb(${s.color.r},${s.color.g},${s.color.b})" stroke-width="${sw.toFixed(2)}"/>`;
      }
      return `<circle cx="${s.x.toFixed(2)}" cy="${s.y.toFixed(2)}" r="${s.radius.toFixed(2)}" fill="rgb(${s.color.r},${s.color.g},${s.color.b})" stroke="rgba(0,0,0,0.15)" stroke-width="0.5"/>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="white"/>
${circles}
</svg>`;
}

export function generateDXF(pattern: StonePattern): string {
  const { stones } = pattern;
  const scale = 0.1;

  let entities = "";
  for (const s of stones) {
    entities += `  0\nCIRCLE\n  8\n0\n 10\n${(s.x * scale).toFixed(4)}\n 20\n${(s.y * scale).toFixed(4)}\n 30\n0.0\n 40\n${(s.radius * scale).toFixed(4)}\n`;
  }

  return `  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nSECTION\n  2\nENTITIES\n${entities}  0\nENDSEC\n  0\nEOF\n`;
}

export function generatePLT(pattern: StonePattern): string {
  const { stones } = pattern;
  const scale = 40;

  let plt = "IN;SP1;\n";
  for (const s of stones) {
    const x = Math.round(s.x * scale);
    const y = Math.round(s.y * scale);
    const r = Math.round(s.radius * scale);
    const steps = 36;
    let first = true;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const px = Math.round(x + r * Math.cos(angle));
      const py = Math.round(y + r * Math.sin(angle));
      if (first) {
        plt += `PU${px},${py};\n`;
        first = false;
      } else {
        plt += `PD${px},${py};\n`;
      }
    }
  }
  plt += "PU0,0;\nSP0;\n";
  return plt;
}
