import { SerialPort } from "serialport";
import { logger } from "./logger-bridge";

export class MachineManager {
  private port: SerialPort | null = null;
  private currentPath: string | null = null;

  async listPorts(): Promise<{ path: string; manufacturer?: string; serialNumber?: string }[]> {
    try {
      const ports = await SerialPort.list();

      logger.info(
        { count: ports.length, paths: ports.map((p) => p.path) },
        "Seri portlar tarandı",
      );

      return ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer,
        serialNumber: p.serialNumber,
      }));
    } catch (err) {
      logger.warn({ err }, "Seri portlar okunamadı; boş liste döndürülüyor");
      return [];
    }
  }
  async connect(path: string, baudRate: number = 9600): Promise<void> {
    if (this.port && this.port.isOpen) {
      logger.warn({ currentPath: this.currentPath }, "Zaten baÄŸlÄ± bir port var, Ã¶nce baÄŸlantÄ± kesiliyor");
      await this.disconnect();
    }

    return new Promise<void>((resolve, reject) => {
      const newPort = new SerialPort({ path, baudRate, autoOpen: false });

      newPort.open((err) => {
        if (err) {
          logger.error({ err, path, baudRate }, "Port aÃ§Ä±lamadÄ±");
          reject(new Error(`Port baÄŸlantÄ±sÄ± baÅŸarÄ±sÄ±z: ${err.message}`));
          return;
        }
        this.port = newPort;
        this.currentPath = path;
        logger.info({ path, baudRate }, "Makine baÄŸlandÄ±");
        resolve();
      });

      newPort.on("error", (err) => {
        logger.error({ err, path }, "Seri port hatasÄ±");
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.port) {
      logger.warn("KapatÄ±lacak aÃ§Ä±k port yok");
      return;
    }

    return new Promise<void>((resolve, reject) => {
      if (!this.port || !this.port.isOpen) {
        this.port = null;
        this.currentPath = null;
        resolve();
        return;
      }

      this.port.close((err) => {
        if (err) {
          logger.error({ err }, "Port kapatÄ±lÄ±rken hata oluÅŸtu");
          reject(new Error(`BaÄŸlantÄ± kesilirken hata: ${err.message}`));
          return;
        }
        logger.info({ path: this.currentPath }, "Makine baÄŸlantÄ±sÄ± kesildi");
        this.port = null;
        this.currentPath = null;
        resolve();
      });
    });
  }

  writeRaw(data: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.port || !this.port.isOpen) {
        reject(new Error("Port baÄŸlÄ± deÄŸil"));
        return;
      }

      this.port.write(data, (err) => {
        if (err) {
          logger.error({ err }, "Veri yazÄ±lÄ±rken hata");
          reject(new Error(`Yazma hatasÄ±: ${err.message}`));
          return;
        }

        this.port!.drain((drainErr) => {
          if (drainErr) {
            logger.error({ drainErr }, "Drain hatasÄ±");
            reject(new Error(`Drain hatasÄ±: ${drainErr.message}`));
            return;
          }
          resolve();
        });
      });
    });
  }

  isConnected(): boolean {
    return this.port !== null && this.port.isOpen;
  }

  getCurrentPath(): string | null {
    return this.currentPath;
  }
}

export const machineManager = new MachineManager();

