import { useMemo, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Filter, Layers, Plus, Search, Trash2 } from "lucide-react";
import { PatternCard } from "@/components/PatternCard";
import { InfoHint } from "@/components/InfoHint";
import { useArchivePattern, useDeletePatternsBulk, usePatterns } from "@/hooks/use-patterns";
import { useI18n } from "@/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Home() {
  const { data: patterns, isLoading, error } = usePatterns();
  const deletePatternsBulk = useDeletePatternsBulk();
  const archivePattern = useArchivePattern();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const filteredPatterns = useMemo(() => {
    if (!patterns) return [];
    const normalizedQuery = query.trim().toLowerCase();

    return patterns.filter((pattern) => {
      if (pattern.archived) return false;
      const derivedName = (
        pattern.name?.trim() ||
        decodeURIComponent((pattern.imageUrl.split("/").pop() || "").replace(/^\d+-\d+-/, "")).trim() ||
        `pattern-${pattern.id}`
      ).toLowerCase();

      const matchesQuery = !normalizedQuery || derivedName.includes(normalizedQuery);
      const matchesStatus = statusFilter === "all" || pattern.status === statusFilter;
      const matchesCategory = categoryFilter === "all" || pattern.category === categoryFilter;

      return matchesQuery && matchesStatus && matchesCategory;
    });
  }, [patterns, query, statusFilter, categoryFilter]);

  const toggleSelect = (id: number, nextSelected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (nextSelected) next.add(id);
      else next.delete(id);
      return Array.from(next);
    });
  };

  const allVisibleIds = filteredPatterns.map((p) => p.id);
  const selectedVisibleCount = selectedIds.filter((id) => allVisibleIds.includes(id)).length;
  const allVisibleSelected = allVisibleIds.length > 0 && selectedVisibleCount === allVisibleIds.length;

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        allVisibleIds.forEach((id) => next.delete(id));
      } else {
        allVisibleIds.forEach((id) => next.add(id));
      }
      return Array.from(next);
    });
  };

  const deleteSelected = async () => {
    const ids = selectedIds.filter((id) => allVisibleIds.includes(id));
    if (ids.length === 0) return;
    await deletePatternsBulk.mutateAsync(ids);
    setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    setBulkDeleteOpen(false);
  };

  const addToArchive = async (id: number) => {
    await archivePattern.mutateAsync({ id, archived: true });
  };

  const hasFilters = query || statusFilter !== "all" || categoryFilter !== "all";

  return (
    <>
      <main className="bg-grid-pattern min-h-screen">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-display font-bold text-foreground">{t("pattern_dashboard")}</h1>
              <InfoHint text={t("manage_patterns")} />
            </div>
            <p className="text-muted-foreground mt-2 max-w-2xl">{t("manage_patterns")}</p>
          </div>

          <div className="flex items-center gap-3">
            {selectedVisibleCount > 0 && (
              <>
                <button
                  onClick={toggleSelectAllVisible}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-white text-foreground text-sm font-medium"
                >
                  {allVisibleSelected ? t("clear_selection") : `${t("select_all")} (${allVisibleIds.length})`}
                </button>
                <button
                  onClick={() => setBulkDeleteOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium"
                >
                  <Trash2 className="w-4 h-4" />
                  {t("bulk_delete")} ({selectedVisibleCount})
                </button>
              </>
            )}
            <Link href="/new">
              <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 hover:bg-primary/90 active:translate-y-0 active:shadow-md transition-all duration-200">
                <Plus className="w-5 h-5" />
                {t("new_pattern")}
              </span>
            </Link>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-4 mb-8 p-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t("search_placeholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg bg-white border border-border focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary transition-all shadow-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <InfoHint text="Filter by status/type to find completed or failed jobs faster." side="bottom" />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-border text-sm font-medium text-foreground shadow-sm"
            >
              <option value="all">{t("filters_all_status")}</option>
              <option value="completed">{t("status_completed")}</option>
              <option value="failed">{t("status_failed")}</option>
            </select>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-border text-sm font-medium text-foreground shadow-sm"
            >
              <option value="all">{t("filters_all_types")}</option>
              <option value="pattern">{t("category_pattern")}</option>
              <option value="rhinestone">{t("category_rhinestone")}</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-7 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-lg border border-border p-2 h-48 animate-pulse">
                <div className="w-full h-24 bg-muted rounded-md mb-2" />
                <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 bg-white rounded-2xl border border-red-100 shadow-sm p-8 text-center">
            <h3 className="text-lg font-semibold text-foreground">{t("failed_load")}</h3>
            <p className="text-muted-foreground mt-2 max-w-sm">{t("failed_load_desc")}</p>
          </div>
        ) : filteredPatterns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-center">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-6">
              <Layers className="w-10 h-10 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-display font-bold text-foreground">
              {hasFilters ? t("no_matches") : t("no_patterns")}
            </h2>
            <p className="text-muted-foreground mt-2 max-w-md mb-8">
              {hasFilters ? t("no_matches_desc") : t("no_patterns_long")}
            </p>
            {hasFilters ? (
              <button
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                  setCategoryFilter("all");
                }}
                className="px-8 py-3 bg-primary text-primary-foreground rounded-xl font-medium shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-1 transition-all"
              >
                {t("clear_filters")}
              </button>
            ) : (
              <Link
                href="/new"
                className="px-8 py-3 bg-primary text-primary-foreground rounded-xl font-medium shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-1 transition-all inline-flex"
              >
                {t("create_first_pattern")}
              </Link>
            )}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, staggerChildren: 0.1 }}
            className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-7 gap-3"
          >
            {filteredPatterns.map((pattern) => (
              <PatternCard
                key={pattern.id}
                pattern={pattern}
                selected={selectedIds.includes(pattern.id)}
                onToggleSelect={toggleSelect}
                onArchive={addToArchive}
                size="compact"
              />
            ))}
          </motion.div>
        )}
      </main>
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete_patterns_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete_patterns_desc").replace("{count}", String(selectedVisibleCount))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel_action")}</AlertDialogCancel>
            <AlertDialogAction onClick={deleteSelected}>{t("delete_action")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
