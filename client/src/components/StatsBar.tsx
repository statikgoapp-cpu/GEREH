import { useI18n } from "@/i18n";
import type { StonePattern } from "./rhinestone-fill-engine";

interface Props {
  pattern: StonePattern;
}

export default function StatsBar({ pattern }: Props) {
  const { t } = useI18n();

  const ssBreakdown = pattern.stones.reduce<Record<string, number>>((acc, s) => {
    acc[s.ssSize] = (acc[s.ssSize] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-wrap gap-3">
      <Stat label={t("fill_stats_total_stones")} value={pattern.totalStones.toLocaleString()} accent />
      <Stat label={t("fill_stats_canvas")} value={`${pattern.width} x ${pattern.height}px`} />
      <Stat label={t("fill_stats_colors")} value={pattern.colorGroups.length.toString()} />
      {Object.entries(ssBreakdown)
        .sort()
        .map(([ss, count]) => (
          <Stat key={ss} label={ss} value={count.toLocaleString()} />
        ))}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`flex flex-col px-4 py-2.5 rounded-xl border ${accent ? "bg-violet-500/10 border-violet-500/20" : "bg-[#1a1a22] border-white/8"}`}>
      <span className={`text-[10px] font-semibold uppercase tracking-wider ${accent ? "text-violet-400" : "text-white/40"}`}>
        {label}
      </span>
      <span className={`text-lg font-bold tabular-nums mt-0.5 ${accent ? "text-violet-300" : "text-white"}`}>
        {value}
      </span>
    </div>
  );
}
