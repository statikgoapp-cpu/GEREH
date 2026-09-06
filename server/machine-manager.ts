import { SerialPort } from "serialport";
import { logger } from "./logger-bridge";

export class MachineManager {
  private port: SerialPort | null = null;
  private currentPath: string | null = null;

  async listPorts(): Promise<{ path: string; manufacturer?: string; serialNumber?: string }[]> {
    try {
      const ports = await SerialPort.list();
      // machine-manager.ts içinde listPorts fonksiyonunun başına ekle
const allDetected = await SerialPort.list();
console.log("DONANIM TARANIYOR: ", ports.length, " adet port bulundu.");
  console.log("BULUNANLAR:", ports.map(p => p.path));
console.log("Sunucu tarafından görülen tüm portlar:", allDetected);
      // BURAYI EKLE: Sunucu terminaline bulunan HER ŞEYİ yazdırır
    console.log("Sistemin bulduğu tüm portlar:", ports.map(p => p.path));
      return ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer,
        serialNumber: p.serialNumber,
      }));
    } catch (err) {
      logger.error({ err }, "Port listesi alınamadı");
      throw new Error("Port listesi alınamadı");
    }
  }

  async connect(path: string, baudRate: number = 9600): Promise<void> {
    if (this.port && this.port.isOpen) {
      logger.warn({ currentPath: this.currentPath }, "Zaten bağlı bir port var, önce bağlantı kesiliyor");
      await this.disconnect();
    }

    return new Promise<void>((resolve, reject) => {
      const newPort = new SerialPort({ path, baudRate, autoOpen: false });

      newPort.open((err) => {
        if (err) {
          logger.error({ err, path, baudRate }, "Port açılamadı");
          reject(new Error(`Port bağlantısı başarısız: ${err.message}`));
          return;
        }
        this.port = newPort;
        this.currentPath = path;
        logger.info({ path, baudRate }, "Makine bağlandı");
        resolve();
      });

      newPort.on("error", (err) => {
        logger.error({ err, path }, "Seri port hatası");
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.port) {
      logger.warn("Kapatılacak açık port yok");
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
          logger.error({ err }, "Port kapatılırken hata oluştu");
          reject(new Error(`Bağlantı kesilirken hata: ${err.message}`));
          return;
        }
        logger.info({ path: this.currentPath }, "Makine bağlantısı kesildi");
        this.port = null;
        this.currentPath = null;
        resolve();
      });
    });
  }

  writeRaw(data: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.port || !this.port.isOpen) {
        reject(new Error("Port bağlı değil"));
        return;
      }

      this.port.write(data, (err) => {
        if (err) {
          logger.error({ err }, "Veri yazılırken hata");
          reject(new Error(`Yazma hatası: ${err.message}`));
          return;
        }

        this.port!.drain((drainErr) => {
          if (drainErr) {
            logger.error({ drainErr }, "Drain hatası");
            reject(new Error(`Drain hatası: ${drainErr.message}`));
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
