import { usePatterns } from "@/hooks/use-patterns";
import { Sidebar } from "@/components/Sidebar";
import { PatternCard } from "@/components/PatternCard";
import { Link } from "wouter";
import { Plus, Search, Filter } from "lucide-react";
import { motion } from "framer-motion";

export default function Home() {
  const { data: patterns, isLoading, error } = usePatterns();

  return (
    <div className="flex min-h-screen bg-background font-sans">
      <Sidebar />
      
      <main className="flex-1 ml-64 p-8 bg-grid-pattern min-h-screen">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Pattern Dashboard</h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              Manage your digitized textile patterns. Upload raster images to convert them into high-precision vectors.
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <Link href="/new">
              <button className="
                flex items-center gap-2 px-5 py-2.5 rounded-lg
                bg-primary text-primary-foreground font-medium
                shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 hover:bg-primary/90
                active:translate-y-0 active:shadow-md
                transition-all duration-200
              ">
                <Plus className="w-5 h-5" />
                New Pattern
              </button>
            </Link>
          </div>
        </header>

        {/* Filters Bar */}
        <div className="flex items-center gap-4 mb-8 p-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search patterns..." 
              className="w-full pl-10 pr-4 py-2 rounded-lg bg-white border border-border focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary transition-all shadow-sm"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted/50 transition-colors shadow-sm">
            <Filter className="w-4 h-4 text-muted-foreground" />
            Filter
          </button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-border p-4 h-80 animate-pulse">
                <div className="w-full h-48 bg-muted rounded-lg mb-4" />
                <div className="h-6 bg-muted rounded w-3/4 mb-2" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 bg-white rounded-2xl border border-red-100 shadow-sm p-8 text-center">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-4">
              <Filter className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">Failed to load patterns</h3>
            <p className="text-muted-foreground mt-2 max-w-sm">
              We couldn't fetch your pattern library. Please check your connection and try again.
            </p>
          </div>
        ) : patterns?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-center">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-6">
              <Layers className="w-10 h-10 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-display font-bold text-foreground">No patterns yet</h2>
            <p className="text-muted-foreground mt-2 max-w-md mb-8">
              Start by uploading your first textile pattern image. We'll convert it to a clean vector format automatically.
            </p>
            <Link href="/new">
              <button className="px-8 py-3 bg-primary text-primary-foreground rounded-xl font-medium shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-1 transition-all">
                Create First Pattern
              </button>
            </Link>
          </div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, staggerChildren: 0.1 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
          >
            {patterns?.map((pattern) => (
              <PatternCard key={pattern.id} pattern={pattern} />
            ))}
          </motion.div>
        )}
      </main>
    </div>
  );
}

// Importing icon for empty state
import { Layers } from "lucide-react";
