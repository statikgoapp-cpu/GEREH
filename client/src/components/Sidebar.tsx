import { useState } from "react"; // State ekledik
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  PlusCircle, 
  Settings, 
  Workflow,
  PackageOpen,
  Gem,
  SlidersHorizontal,
  Sparkles,
  Menu, // İkon eklendi
    BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import FeedbackDialog from "./FeedbackDialog";
import { useAuth } from "@/hooks/use-auth";

// Sidebar propları
interface SidebarProps {
  isCollapsed?: boolean;
  setIsCollapsed?: (value: boolean) => void;
}

const NAV_ITEMS = [
  { key: "dashboard", icon: LayoutDashboard, href: "/" },
  { key: "new_pattern", icon: PlusCircle, href: "/new" },
  { key: "rhinestone_transfer", icon: Gem, href: "/rhinestone-transfer" },
  { key: "rhinestone_fill", icon: Sparkles, href: "/rhinestone-fill" },
  { key: "production_edit", icon: SlidersHorizontal, href: "/production-edit" },
  { key: "archive", icon: PackageOpen, href: "/archive" },
  { key: "settings", icon: Settings, href: "/settings" },
];

export function Sidebar({ 
  isCollapsed: controlledCollapsed, 
  setIsCollapsed: controlledSetCollapsed 
}: SidebarProps) {
  const [location] = useLocation();
  const { t } = useI18n();
  const { user } = useAuth();

  // --- Hata Önleyici Hibrit Mantık ---
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;
  const setIsCollapsed = controlledSetCollapsed || setInternalCollapsed;

  return (
    <aside className={cn(
      "h-screen bg-white border-r border-border flex flex-col shadow-sm fixed left-0 top-0 z-50 transition-all duration-300",
      isCollapsed ? "w-20" : "w-64"
    )}>
      <div className={cn(
        "p-4 border-b border-border/50 flex items-center h-20",
        isCollapsed ? "justify-center" : "justify-between"
      )}>
        {/* Logo - Sadece açıkken gösterilir */}
        {!isCollapsed && (
          <Link href="/" className="flex items-center gap-2 group cursor-pointer overflow-hidden">
            <div className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-primary via-primary to-accent text-primary-foreground flex items-center justify-center shadow-md shadow-primary/30 group-hover:from-accent group-hover:to-primary transition-colors duration-300">
              <img src="/favicon.png" alt="Logo" className="w-full h-full object-cover" />
            </div>
            <div className="whitespace-nowrap">
              <div className="flex items-center gap-1.5">
                <h1 className="font-display font-bold text-lg leading-tight text-primary">GEREH</h1>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                  Beta
                </span>
              </div>
            </div>
          </Link>
        )}

        {/* Hamburger Butonu - Hata vermez */}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-2 rounded-lg text-muted-foreground hover:bg-muted"
        >
          <Menu size={20} />
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href}>
            <div
              className={cn(
                "flex items-center rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer group",
                isCollapsed ? "justify-center p-3" : "gap-3 px-3 py-3",
                location === item.href 
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" 
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              title={isCollapsed ? t(item.key) : undefined}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {!isCollapsed && <span>{t(item.key)}</span>}
            </div>
          </Link>
        ))}
        {user?.role === "admin" && (
          <Link href="/analytics">
            <div
              className={cn(
                "flex items-center rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer group",
                isCollapsed ? "justify-center p-3" : "gap-3 px-3 py-3",
                location === "/analytics" ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              title={isCollapsed ? "Analytics" : undefined}
            >
              <BarChart3 className="w-5 h-5 shrink-0" />
              {!isCollapsed && <span>Analytics</span>}
            </div>
          </Link>
        )}
      </nav>

      {/* Machine Control */}
      <div className="px-3 pb-2">
        <Link 
          href="/machine-control" 
          className={cn(
            "flex items-center rounded-lg hover:bg-slate-800 hover:text-white transition-colors text-muted-foreground group",
            isCollapsed ? "justify-center p-3" : "gap-3 px-3 py-3"
          )}
        >
          <Workflow size={20} className="shrink-0" />
          {!isCollapsed && <span className="font-medium">{t("sidebar_machine_control")}</span>}
        </Link>
      </div>

      <div className="border-t border-border/50 px-3 py-3">
        <FeedbackDialog compact={isCollapsed} />
      </div>

      {/* Status Box */}
      <div className="p-4 border-t border-border/50">
        {!isCollapsed ? (
          <div className="bg-muted/50 rounded-xl p-4">
            <p className="text-xs font-mono text-muted-foreground mb-2">{t("sidebar_status_title")}</p>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-medium text-foreground">{t("sidebar_status_line1")}</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
          </div>
        )}
      </div>
    </aside>
  );
}
