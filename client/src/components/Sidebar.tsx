import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  PlusCircle, 
  Settings, 
  Layers,
  Cpu
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/" },
  { label: "New Pattern", icon: PlusCircle, href: "/new" },
  { label: "Archive", icon: Layers, href: "/archive" }, // Placeholder for future feature
  { label: "Settings", icon: Settings, href: "/settings" }, // Placeholder for future feature
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="w-64 h-screen bg-white border-r border-border flex flex-col shadow-sm fixed left-0 top-0 z-50">
      <div className="p-6 border-b border-border/50">
        <Link href="/" className="flex items-center gap-2 group cursor-pointer">
          <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center group-hover:bg-accent transition-colors duration-300">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display font-bold text-lg leading-tight text-primary">Neural</h1>
            <p className="text-xs font-mono text-muted-foreground tracking-wider">PATTERNER</p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href}>
            <div
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer group",
                location === item.href 
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" 
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className={cn(
                "w-5 h-5 transition-colors",
                location === item.href ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
              )} />
              {item.label}
            </div>
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-border/50">
        <div className="bg-muted/50 rounded-xl p-4">
          <p className="text-xs font-mono text-muted-foreground mb-2">SYSTEM STATUS</p>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-medium text-foreground">Engine Online</span>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            v2.4.0 (Stable)
          </div>
        </div>
      </div>
    </aside>
  );
}
