import { machineManager } from "./machine-manager";
import { emitProductionProgress } from "./socket-handler";
import { logger } from "./logger-bridge";

export interface Coord {
  x: number;
  y: number;
}

const PACKET_DELAY_MS = 50;

let isRunning = false;
let shouldStop = false;

function coordToPLT(coord: Coord, index: number): string {
  if (index === 0) {
    return `PU${Math.round(coord.x * 40)},${Math.round(coord.y * 40)};\n`;
  }
  return `PD${Math.round(coord.x * 40)},${Math.round(coord.y * 40)};\n`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startProduction(coords: Coord[]): Promise<void> {
  if (isRunning) {
    throw new Error("Üretim zaten çalışıyor");
  }

  if (!machineManager.isConnected()) {
    throw new Error("Makine bağlı değil");
  }

  if (!coords || coords.length === 0) {
    throw new Error("Koordinat dizisi boş");
  }

  isRunning = true;
  shouldStop = false;

  logger.info({ total: coords.length }, "Üretim başlatıldı");

  try {
    await machineManager.writeRaw("IN;\n");
    await sleep(PACKET_DELAY_MS);

    for (let i = 0; i < coords.length; i++) {
      if (shouldStop) {
        logger.info({ stoppedAt: i }, "Üretim acil durdurma ile durduruldu");
        break;
      }

      const coord = coords[i];
      const pltCommand = coordToPLT(coord, i);

      await machineManager.writeRaw(pltCommand);

      const percentage = Math.round(((i + 1) / coords.length) * 100);
      emitProductionProgress({
        index: i,
        percentage,
        currentCoord: coord,
      });

      logger.info({ index: i, percentage, coord }, "Taş gönderildi");

      await sleep(PACKET_DELAY_MS);
    }

    if (!shouldStop) {
      await machineManager.writeRaw("PU0,0;\n");
      emitProductionProgress({
        index: coords.length - 1,
        percentage: 100,
        currentCoord: coords[coords.length - 1],
      });
      logger.info("Üretim tamamlandı");
    }
  } catch (err) {
    logger.error({ err }, "Üretim sırasında hata");
    throw err;
  } finally {
    isRunning = false;
    shouldStop = false;
  }
}

export function stopProduction(): void {
  if (isRunning) {
    shouldStop = true;
    logger.info("Üretim durdurma sinyali gönderildi");
  }
}

export function isProductionRunning(): boolean {
  return isRunning;
}
