import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { getApiBase } from "@/lib/api-base";

export interface Coord {
  x: number;
  y: number;
}

export interface ProductionProgress {
  index: number;
  percentage: number;
  currentCoord: Coord;
}

export interface UseMachineControlReturn {
  isConnected: boolean;
  isPrinting: boolean;
  progress: number;
  activeStoneIndex: number | null;
  activeCoord: Coord | null;
  socketConnected: boolean;
  setIsConnected: (v: boolean) => void;
  startProduction: (coords: Coord[]) => Promise<void>;
  emergencyStop: () => Promise<void>;
  goHome: () => Promise<void>;
  setActivePattern: (coords: Coord[] | null) => void;
  activePattern: Coord[] | null;
  loadPatternForProduction: (coords: Coord[]) => void;
}

const API_BASE = "/api";

// --- KRİTİK: Sayfa değişse bile veriyi tutan global değişken ---
let kaliciDesenHafizasi: Coord[] | null = null;

export function useMachineControl(): UseMachineControlReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeStoneIndex, setActiveStoneIndex] = useState<number | null>(null);
  const [activeCoord, setActiveCoord] = useState<Coord | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  
  // Başlangıç değerini global hafızadan alıyoruz
  const [activePattern, setActivePatternState] = useState<Coord[] | null>(kaliciDesenHafizasi);

  // Deseni hafızaya kaydeden ve ekranı güncelleyen fonksiyon
  const setActivePattern = (coords: Coord[] | null) => {
    kaliciDesenHafizasi = coords; // Global değişkene yaz (Kalıcı)
    setActivePatternState(coords); // React State'e yaz (Görünür)
  };

  // Senin istediğin "loadPatternForProduction" aslında setActivePattern ile aynı işi yapmalı
  const loadPatternForProduction = (coords: Coord[]) => {
    setActivePattern(coords);
  };

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const apiBase = getApiBase();
    const socketOrigin = apiBase || window.location.origin;
    const socket = io(socketOrigin, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketConnected(true);
    });

    socket.on("disconnect", () => {
      setSocketConnected(false);
    });

    socket.on("production-progress", (data: ProductionProgress) => {
      setProgress(data.percentage);
      setActiveStoneIndex(data.index);
      setActiveCoord(data.currentCoord);

      if (data.percentage === 100) {
        setIsPrinting(false);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const startProduction = useCallback(async (coords: Coord[]): Promise<void> => {
    const response = await fetch(`${API_BASE}/machine/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coords }),
    });

    if (!response.ok) {
      const data = await response.json() as { error?: string };
      throw new Error(data.error ?? "Üretim başlatılamadı");
    }

    setIsPrinting(true);
    setProgress(0);
    setActiveStoneIndex(null);
    setActiveCoord(null);
  }, []);

  const emergencyStop = useCallback(async (): Promise<void> => {
    const response = await fetch(`${API_BASE}/machine/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const data = await response.json() as { error?: string };
      throw new Error(data.error ?? "Acil durdurma başarısız");
    }

    setIsPrinting(false);
    setIsConnected(false);
    setProgress(0);
    setActiveStoneIndex(null);
  }, []);

  const goHome = useCallback(async (): Promise<void> => {
    const response = await fetch(`${API_BASE}/machine/home`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const data = await response.json() as { error?: string };
      throw new Error(data.error ?? "Home komutu başarısız");
    }
  }, []);

  return {
    activePattern,
    setActivePattern,
    loadPatternForProduction,
    isConnected,
    isPrinting,
    progress,
    activeStoneIndex,
    activeCoord,
    socketConnected,
    setIsConnected,
    startProduction,
    emergencyStop,
    goHome,
  };
}
