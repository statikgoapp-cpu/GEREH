import { Router } from "express";
import { machineManager } from "./machine-manager";
import { startProduction, stopProduction, isProductionRunning } from "./printer-worker";
import type { Coord } from "./printer-worker";
import { logger } from "./logger-bridge";

const machineRouter = Router();

machineRouter.get("/machine/ports", async (req, res) => {
  try {
    const ports = await machineManager.listPorts();
    res.json({ success: true, ports });
  } catch (err) {
    logger.error({ err }, "Port listesi alınamadı");
    res.status(500).json({ success: false, error: "Port listesi alınamadı" });
  }
});

machineRouter.post("/machine/connect", async (req, res) => {
  const { path, baudRate } = req.body as { path: string; baudRate?: number };

  if (!path) {
    res.status(400).json({ success: false, error: "Port yolu (path) gereklidir" });
    return;
  }

  try {
    await machineManager.connect(path, baudRate ?? 9600);
    res.json({ success: true, message: `${path} portuna bağlandı` });
  } catch (err) {
    logger.error({ err, path }, "Bağlantı kurulamadı");
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

machineRouter.post("/machine/disconnect", async (req, res) => {
  try {
    await machineManager.disconnect();
    res.json({ success: true, message: "Bağlantı kesildi" });
  } catch (err) {
    logger.error({ err }, "Bağlantı kesilemedi");
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

machineRouter.post("/machine/start", async (req, res) => {
  const { coords } = req.body as { coords: Coord[] };

  if (!coords || !Array.isArray(coords) || coords.length === 0) {
    res.status(400).json({ success: false, error: "Koordinat dizisi gereklidir" });
    return;
  }

  if (isProductionRunning()) {
    res.status(409).json({ success: false, error: "Üretim zaten çalışıyor" });
    return;
  }

  if (!machineManager.isConnected()) {
    res.status(400).json({ success: false, error: "Makine bağlı değil" });
    return;
  }

  res.json({ success: true, message: "Üretim başlatıldı", total: coords.length });

  startProduction(coords).catch((err) => {
    logger.error({ err }, "Üretim hatası");
  });
});

machineRouter.post("/machine/stop", async (req, res) => {
  try {
    stopProduction();
    await machineManager.disconnect();
    res.json({ success: true, message: "Acil durdurma gerçekleştirildi" });
  } catch (err) {
    logger.error({ err }, "Acil durdurma hatası");
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

machineRouter.post("/machine/home", async (req, res) => {
  if (!machineManager.isConnected()) {
    res.status(400).json({ success: false, error: "Makine bağlı değil" });
    return;
  }

  try {
    await machineManager.writeRaw("PU0,0;\n");
    res.json({ success: true, message: "Makine başlangıç konumuna döndü" });
  } catch (err) {
    logger.error({ err }, "Home komutu gönderilemedi");
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default machineRouter;
