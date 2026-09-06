import type { RGB } from "./rhinestone-fill-engine";
import { useI18n } from "@/i18n";

interface Props {
  groups: { color: RGB; count: number }[];
}

export default function ColorLegend({ groups }: Props) {
  const { t } = useI18n();
  const total = groups.reduce((s, g) => s + g.count, 0);

  return (
    <div className="space-y-2">
      {groups.map((g, i) => {
        const pct = total ? ((g.count / total) * 100).toFixed(1) : "0";
        const hexColor = `#${g.color.r.toString(16).padStart(2, "0")}${g.color.g.toString(16).padStart(2, "0")}${g.color.b.toString(16).padStart(2, "0")}`;
        return (
          <div key={i} className="flex items-center gap-2.5">
            <div
              className="w-5 h-5 rounded-full shrink-0 border border-black/10 shadow-sm"
              style={{ backgroundColor: hexColor }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-white/60 font-mono">{hexColor.toUpperCase()}</span>
                <span className="text-white/40">{pct}%</span>
              </div>
              <div className="mt-1 h-1 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: hexColor,
                  }}
                />
              </div>
              <p className="text-[10px] text-white/30 mt-0.5">
                {g.count.toLocaleString()} {t("fill_stats_stones")}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
