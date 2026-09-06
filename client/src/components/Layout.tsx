import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { LogOut, UserCircle } from "lucide-react";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen w-full bg-slate-50 overflow-x-hidden">
      <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />

      <main
        className={cn(
          "relative min-h-screen min-w-0 transition-[margin-left] duration-300 ease-in-out",
          isCollapsed ? "ml-20" : "ml-64"
        )}
      >
        {user && (
          <div className="flex justify-end px-6 pt-4 md:px-8">
            <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-white/90 px-3 py-2 shadow-sm">
              <UserCircle className="h-5 w-5 text-muted-foreground" />

              <div className="hidden sm:block text-right">
                <p className="text-sm font-medium leading-none">
                  {user.name || user.email}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {user.plan}
                </p>
              </div>

              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden md:inline">Logout</span>
              </button>
            </div>
          </div>
        )}

        <div className="w-full p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}
