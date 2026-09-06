import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { logger } from "./logger-bridge";

export interface ProductionProgress {
  index: number;
  percentage: number;
  currentCoord: { x: number; y: number };
}

let io: SocketIOServer | null = null;

export function initSocketIO(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    path: "/api/socket.io",
  });

  io.on("connection", (socket: Socket) => {
    logger.info({ socketId: socket.id }, "İstemci bağlandı");

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id }, "İstemci bağlantısı kesildi");
    });
  });

  logger.info("Socket.IO başlatıldı");
  return io;
}

export function emitProductionProgress(progress: ProductionProgress): void {
  if (!io) {
    logger.warn("Socket.IO henüz başlatılmadı, ilerleme yayımlanamıyor");
    return;
  }
  io.emit("production-progress", progress);
}

export function getSocketIO(): SocketIOServer | null {
  return io;
}
