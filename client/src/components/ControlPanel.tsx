import { useI18n } from "@/i18n";
import type { FillOptions } from "./rhinestone-fill-engine";
import { SS_SIZE_MAP } from "./rhinestone-fill-engine";

interface Props {
  options: FillOptions;
  onChange: (o: FillOptions) => void;
}

export default function ControlPanel({ options, onChange }: Props) {
  const { t } = useI18n();

  const update = <K extends keyof FillOptions>(key: K, value: FillOptions[K]) =>
    onChange({ ...options, [key]: value });

  const ssEntries = Object.entries(SS_SIZE_MAP);

  const toggleSS = (mm: number) => {
    const has = options.ssSizes.includes(mm);
    if (has && options.ssSizes.length === 1) return;
    const next = has ? options.ssSizes.filter((s) => s !== mm) : [...options.ssSizes, mm];
    update("ssSizes", next.sort((a, b) => b - a));
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
          {t("fill_stone_sizes")}
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {ssEntries.map(([label, mm]) => (
            <button
              key={label}
              onClick={() => toggleSS(mm)}
              className={`py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                options.ssSizes.includes(mm)
                  ? "bg-violet-500/20 border-violet-500/50 text-violet-300"
                  : "bg-white/4 border-white/8 text-white/40 hover:text-white/60"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            {t("fill_density")}
          </label>
          <span className="text-xs text-violet-400 font-semibold">{Math.round(options.density * 100)}%</span>
        </div>
        <input
          type="range"
          min={0.4}
          max={1.0}
          step={0.05}
          value={options.density}
          onChange={(e) => update("density", parseFloat(e.target.value))}
          className="w-full accent-violet-500 cursor-pointer h-1.5 rounded-full"
        />
        <div className="flex justify-between text-[10px] text-white/25 mt-1">
          <span>{t("fill_sparse")}</span>
          <span>{t("fill_dense")}</span>
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            {t("fill_stone_spacing")}
          </label>
          <span className="text-xs text-violet-400 font-semibold">{options.spacing.toFixed(1)} mm</span>
        </div>
        <input
          type="range"
          min={0.1}
          max={1.0}
          step={0.05}
          value={options.spacing}
          onChange={(e) => update("spacing", parseFloat(e.target.value))}
          className="w-full accent-violet-500 cursor-pointer h-1.5 rounded-full"
        />
      </div>

      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            {t("fill_color_regions")}
          </label>
          <span className="text-xs text-violet-400 font-semibold">{options.numColors}</span>
        </div>
        <input
          type="range"
          min={2}
          max={8}
          step={1}
          value={options.numColors}
          onChange={(e) => update("numColors", parseInt(e.target.value))}
          className="w-full accent-violet-500 cursor-pointer h-1.5 rounded-full"
        />
        <div className="flex justify-between text-[10px] text-white/25 mt-1">
          <span>{t("fill_two_colors")}</span>
          <span>{t("fill_eight_colors")}</span>
        </div>
      </div>

      <div>
        <label className="flex items-center justify-between cursor-pointer group">
          <div>
            <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">{t("fill_multi_size")}</p>
            <p className="text-[10px] text-white/30 mt-0.5">{t("fill_multi_size_desc")}</p>
          </div>
          <div
            onClick={() => update("multiSize", !options.multiSize)}
            className={`relative w-10 h-5 rounded-full transition-all cursor-pointer ${
              options.multiSize ? "bg-violet-600" : "bg-white/10"
            }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                options.multiSize ? "left-5" : "left-0.5"
              }`}
            />
          </div>
        </label>
      </div>

      <div>
        <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
          {t("fill_stone_style")}
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => update("stoneStyle", "filled")}
            className={`py-2 rounded-lg text-xs font-semibold border transition-all flex flex-col items-center gap-1 ${
              options.stoneStyle === "filled"
                ? "bg-violet-500/20 border-violet-500/50 text-violet-300"
                : "bg-white/4 border-white/8 text-white/40 hover:text-white/60"
            }`}
          >
            <span className="text-base leading-none">●</span>
            {t("fill_stone_style_filled")}
          </button>
          <button
            onClick={() => update("stoneStyle", "outline")}
            className={`py-2 rounded-lg text-xs font-semibold border transition-all flex flex-col items-center gap-1 ${
              options.stoneStyle === "outline"
                ? "bg-violet-500/20 border-violet-500/50 text-violet-300"
                : "bg-white/4 border-white/8 text-white/40 hover:text-white/60"
            }`}
          >
            <span className="text-base leading-none">○</span>
            {t("fill_stone_style_outline")}
          </button>
        </div>
      </div>
    </div>
  );
}
