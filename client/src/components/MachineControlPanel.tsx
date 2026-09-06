import React, { useEffect, useState } from "react";
import { Workflow, Power, Activity, RotateCcw, Play, RefreshCw, AlertOctagon, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

import { useI18n } from "@/i18n";
import { useMachineControl } from "../hooks/useMachineControl";

interface Port {
  path: string;
  manufacturer?: string;
}

const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

export function MachineControlPanel(): React.ReactElement {
  const { t } = useI18n();
  const {
    isPrinting,
    progress,
    activeCoord,
    socketConnected,
    setIsConnected,
    startProduction,
    emergencyStop,
    goHome,
    activePattern,
  } = useMachineControl();

  const [ports, setPorts] = useState<Port[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>("");
  const [baudRate, setBaudRate] = useState<number>(9600);
  const [localConnected, setLocalConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const showStatus = (msg: string): void => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 3000);
  };

  const fetchPorts = async (): Promise<void> => {
    try {
      const res = await fetch("/api/machine/ports");
      const data = (await res.json()) as { success: boolean; ports: Port[] };
      if (data.success) {
        setPorts(data.ports);
        if (data.ports.length > 0 && !selectedPort) {
          setSelectedPort(data.ports[0].path);
        }
      }
    } catch {
      setError(t("mc_port_list_failed"));
    }
  };

  useEffect(() => {
    void fetchPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      if (localConnected) {
        const res = await fetch("/api/machine/disconnect", { method: "POST" });
        const data = (await res.json()) as { success: boolean; error?: string };
        if (!data.success) throw new Error(data.error ?? t("mc_disconnect_failed"));

        setLocalConnected(false);
        setIsConnected(false);
        showStatus(t("mc_disconnected"));
      } else {
        if (!selectedPort) throw new Error(t("mc_select_port_first"));

        const res = await fetch("/api/machine/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: selectedPort, baudRate }),
        });
        const data = (await res.json()) as { success: boolean; error?: string; message?: string };
        if (!data.success) throw new Error(data.error ?? t("mc_connect_failed"));

        setLocalConnected(true);
        setIsConnected(true);
        showStatus(data.message ?? t("mc_connected"));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between border-b border-gray-800 pb-6">
          <div>
            <h1 className="text-3xl font-black tracking-tighter text-white flex items-center gap-3">
              <Workflow className="text-blue-500 w-8 h-8" />
              {t("mc_panel_title")}
            </h1>
            <p className="text-gray-400 text-sm mt-1">{t("mc_panel_subtitle")}</p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-700 bg-gray-800 hover:bg-gray-700 transition-colors text-xs font-bold uppercase tracking-widest"
            >
              <ArrowLeft size={14} />
              {t("back_to_dashboard")}
            </Link>

            <div
              className={`flex items-center gap-3 px-4 py-2 rounded-xl border ${
                socketConnected ? "border-green-500/50 bg-green-500/10" : "border-gray-700 bg-gray-800"
              }`}
            >
              <div className={`w-3 h-3 rounded-full ${socketConnected ? "bg-green-400 animate-pulse" : "bg-gray-600"}`} />
              <span className="text-xs font-bold uppercase tracking-widest">
                {socketConnected ? t("mc_system_active") : t("mc_waiting_connection")}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 text-red-400 p-4 rounded-xl text-sm animate-bounce">
            {error}
          </div>
        )}
        {statusMsg && <div className="bg-green-900/20 border border-green-800 text-green-400 p-4 rounded-xl text-sm">{statusMsg}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
              <h2 className="text-sm font-black text-gray-500 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                <Power size={16} className="text-blue-500" /> {t("mc_connection_config")}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase mb-2 block">{t("mc_serial_port")}</label>
                  <div className="flex gap-2">
                    <select
                      value={selectedPort}
                      onChange={(e) => setSelectedPort(e.target.value)}
                      disabled={localConnected}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
                    >
                      {ports.length === 0 ? (
                        <option value="">{t("mc_searching_ports")}</option>
                      ) : (
                        ports.map((p) => (
                          <option key={p.path} value={p.path}>
                            {p.path}
                          </option>
                        ))
                      )}
                    </select>
                    <button
                      onClick={() => void fetchPorts()}
                      disabled={localConnected}
                      className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition-colors"
                    >
                      <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase mb-2 block">{t("mc_baud_rate")}</label>
                  <select
                    value={baudRate}
                    onChange={(e) => setBaudRate(Number(e.target.value))}
                    disabled={localConnected}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none"
                  >
                    {BAUD_RATES.map((rate) => (
                      <option key={rate} value={rate}>
                        {rate}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={() => void handleConnect()}
                  className={`w-full py-4 rounded-xl font-bold text-sm tracking-widest transition-all ${
                    localConnected ? "bg-orange-600 hover:bg-orange-700 shadow-orange-900/20" : "bg-blue-600 hover:bg-blue-700 shadow-blue-900/20"
                  } shadow-lg`}
                >
                  {localConnected ? t("mc_disconnect") : t("mc_connect_machine")}
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-8 space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl h-full flex flex-col justify-between">
              <div>
                <h2 className="text-sm font-black text-gray-500 uppercase tracking-[0.2em] mb-8 flex items-center gap-2">
                  <Activity size={16} className="text-green-500" /> {t("mc_production_tracking")}
                </h2>

                <div className="bg-gray-800/30 border border-gray-700 rounded-2xl p-4 mb-6">
                  <span className="text-[10px] font-bold text-gray-500 uppercase block mb-3 text-center tracking-widest">
                    {t("mc_loaded_pattern_preview")}
                  </span>

                  <div className="relative w-full h-64 bg-gray-950 rounded-lg border border-gray-800 overflow-hidden flex items-center justify-center shadow-inner">
                    {activePattern && activePattern.length > 0 ? (
                      <svg viewBox="0 0 500 500" className="w-full h-full p-6 transform scale-y-[-1]">
                        {activePattern.map((stone, index) => (
                          <circle key={index} cx={stone.x} cy={stone.y} r="2.5" className="fill-blue-500/60" />
                        ))}
                      </svg>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 border-2 border-dashed border-gray-700 rounded-full flex items-center justify-center">
                          <span className="text-gray-700 text-xl font-bold">?</span>
                        </div>
                        <div className="text-gray-600 text-[10px] uppercase font-bold tracking-widest">{t("mc_waiting_pattern")}</div>
                      </div>
                    )}
                  </div>

                  {activePattern && (
                    <div className="mt-3 text-center">
                      <span className="text-[10px] bg-blue-500/10 text-blue-400 px-3 py-1 rounded-full border border-blue-500/20 font-bold uppercase tracking-wider">
                        {activePattern.length} {t("mc_stones_transferred")}
                      </span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-6 mb-8">
                  <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-6 text-center">
                    <span className="text-[10px] font-bold text-gray-500 uppercase block mb-2">{t("mc_completed_stones")}</span>
                    <span className="text-4xl font-black text-white font-mono">{progress}%</span>
                  </div>
                  <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-6 text-center">
                    <span className="text-[10px] font-bold text-gray-500 uppercase block mb-2">{t("mc_active_coordinate")}</span>
                    <span className="text-xl font-bold text-blue-400 font-mono italic">
                      {activeCoord ? `X:${activeCoord.x} Y:${activeCoord.y}` : t("mc_idle")}
                    </span>
                  </div>
                </div>

                <div className="space-y-3 mb-10">
                  <div className="h-4 w-full bg-gray-800 rounded-full overflow-hidden border border-gray-700">
                    <div
                      className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-500 shadow-[0_0_15px_rgba(37,99,235,0.5)]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-500 text-right font-bold uppercase tracking-widest">{t("mc_system_progress")}</p>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  onClick={() => {
                    if (activePattern) {
                      void startProduction(activePattern);
                    } else {
                      alert(t("mc_send_pattern_first"));
                    }
                  }}
                  disabled={!localConnected || isPrinting || !activePattern}
                  className="flex-[4] bg-green-600 hover:bg-green-700 disabled:opacity-30 disabled:cursor-not-allowed py-6 rounded-2xl font-black text-sm tracking-[0.2em] transition-all flex items-center justify-center gap-3 shadow-xl shadow-green-900/20"
                >
                  <Play size={24} />
                  {isPrinting ? t("mc_processing") : t("mc_start_production")}
                </button>

                <button
                  onClick={() => void goHome()}
                  disabled={!localConnected || isPrinting}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 py-6 rounded-2xl transition-all border border-gray-700 flex items-center justify-center shadow-lg"
                  title={t("mc_home_reset_title")}
                >
                  <RotateCcw size={24} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4">
          <button
            onClick={() => void emergencyStop()}
            className="w-full bg-red-600 hover:bg-red-700 group transition-all py-4 rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-red-900/40 border-b-4 border-red-800 active:border-b-0 active:translate-y-1"
          >
            <AlertOctagon size={24} className="group-hover:scale-110 transition-transform" />
            <span className="text-lg font-bold tracking-tight uppercase">{t("mc_emergency_stop")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
