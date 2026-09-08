import { useEffect, useState } from "react";
import { Activity, BarChart3, Download, MessageSquare, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

interface UsageRow {
  total: number;
  uniqueUsers: number;
  uniqueSessions: number;
}

interface AnalyticsSummary {
  users: { total: number; dau: number; wau: number; mau: number; newToday: number; newWeek: number; newMonth: number };
  usage: Record<string, UsageRow>;
  funnel: Record<string, number>;
  retention: { returningWeek: number; returningMonth: number };
}

const usageItems = [
  ["PATTERN_UPLOAD", "Pattern Upload"],
  ["PATTERN_PROCESS_COMPLETE", "Pattern Process"],
  ["SVG_EXPORT", "SVG Export"],
  ["DXF_EXPORT", "DXF Export"],
  ["PDF_EXPORT", "PDF Export"],
  ["PDF_DOWNLOAD", "PDF Download"],
  ["FEEDBACK_SUBMIT", "Feedback"],
] as const;

export default function Analytics() {
  const { token } = useAuth();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/analytics/summary", {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? "Admin access required" : "Analytics unavailable");
        return response.json() as Promise<AnalyticsSummary>;
      })
      .then(setData)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Analytics unavailable"));
  }, [token]);

  if (error) return <main className="p-8 text-sm text-muted-foreground">{error}</main>;
  if (!data) return <main className="p-8 text-sm text-muted-foreground">Loading analytics...</main>;

  const cards = [
    ["Total Users", data.users.total, Users],
    ["Active Today", data.users.dau, Activity],
    ["Active 7 Days", data.users.wau, BarChart3],
    ["Active 30 Days", data.users.mau, BarChart3],
    ["New Today", data.users.newToday, Users],
    ["New 7 Days", data.users.newWeek, Users],
  ] as const;

  return (
    <main className="space-y-8">
      <header className="border-b border-border pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">GEREH</p>
        <h1 className="mt-2 text-3xl font-display font-bold">Beta Analytics</h1>
      </header>

      <section className="grid grid-cols-2 gap-4 xl:grid-cols-6">
        {cards.map(([label, value, Icon]) => (
          <div key={label} className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <Icon className="mb-5 h-5 w-5 text-primary" />
            <p className="text-2xl font-bold">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-8 xl:grid-cols-[1.2fr_1fr]">
        <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold"><Download className="h-5 w-5 text-primary" /> Usage</h2>
          <div className="divide-y divide-border">
            {usageItems.map(([event, label]) => {
              const row = data.usage[event] ?? { total: 0, uniqueUsers: 0, uniqueSessions: 0 };
              return <div key={event} className="flex items-center justify-between gap-4 py-3 text-sm"><span>{label}</span><span className="text-right text-muted-foreground">{row.total} total <span className="mx-1">·</span> {row.uniqueUsers} users</span></div>;
            })}
          </div>
        </div>

        <div className="space-y-8">
          <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
            <h2 className="mb-5 text-lg font-semibold">Funnel</h2>
            <div className="space-y-3 text-sm">
              {Object.entries(data.funnel).map(([event, value]) => <div key={event} className="flex justify-between gap-4"><span>{event.replaceAll("_", " ")}</span><strong>{value}</strong></div>)}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
            <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold"><MessageSquare className="h-5 w-5 text-primary" /> Retention</h2>
            <div className="flex justify-between text-sm"><span>7 day returning</span><strong>{data.retention.returningWeek}</strong></div>
            <div className="mt-3 flex justify-between text-sm"><span>30 day returning</span><strong>{data.retention.returningMonth}</strong></div>
          </div>
        </div>
      </section>
    </main>
  );
}
