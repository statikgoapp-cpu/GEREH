import { useMemo, useState } from "react";
import { useDeletePatternsBulk, usePatterns } from "@/hooks/use-patterns";
import { PatternCard } from "@/components/PatternCard";
import { InfoHint } from "@/components/InfoHint";
import { Filter, Search, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
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

export default function Archive() {
  const { data: patterns, isLoading, error } = usePatterns();
  const deletePatternsBulk = useDeletePatternsBulk();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const archivedPatterns = useMemo(() => {
    if (!patterns) return [];
    const normalizedQuery = query.trim().toLowerCase();

    return patterns.filter((pattern) => {
      const isArchived = pattern.archived === true;
      if (!isArchived) return false;
      const derivedName = (pattern.name?.trim()
        || decodeURIComponent((pattern.imageUrl.split("/").pop() || "").replace(/^\d+-\d+-/, "")).trim()
        || `pattern-${pattern.id}`).toLowerCase();

      const matchesQuery =
        !normalizedQuery ||
        derivedName.includes(normalizedQuery);

      const matchesStatus = statusFilter === "all" || pattern.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [patterns, query, statusFilter]);

  const toggleSelect = (id: number, nextSelected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (nextSelected) next.add(id);
      else next.delete(id);
      return Array.from(next);
    });
  };

  const allVisibleIds = archivedPatterns.map((p) => p.id);
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

  return (
    <>
      <main className="bg-grid-pattern min-h-screen">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-display font-bold text-foreground">{t("archive_title")}</h1>
              <InfoHint text={t("archive_desc")} />
            </div>
            <p className="text-muted-foreground mt-2 max-w-2xl">{t("archive_desc")}</p>
          </div>
          {selectedVisibleCount > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectAllVisible}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-white text-foreground text-sm font-medium"
              >
                {allVisibleSelected ? "Seçimi Kaldır" : `Tümünü Seç (${allVisibleIds.length})`}
              </button>
              <button
                onClick={() => setBulkDeleteOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium"
              >
                <Trash2 className="w-4 h-4" />
                Çoklu Sil ({selectedVisibleCount})
              </button>
            </div>
          )}
        </header>

        <div className="flex flex-wrap items-center gap-4 mb-8 p-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t("archive_search")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg bg-white border border-border focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary transition-all shadow-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <InfoHint text="Search and filter archived jobs by name and processing status." side="bottom" />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-border text-sm font-medium text-foreground shadow-sm"
            >
              <option value="all">{t("archive_filter_all")}</option>
              <option value="completed">{t("archive_filter_completed")}</option>
              <option value="failed">{t("archive_filter_failed")}</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-7 gap-3">
            {[1, 2, 3].map((i) => (
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
            <p className="text-muted-foreground mt-2 max-w-sm">{t("archive_failed_desc")}</p>
          </div>
        ) : archivedPatterns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[60vh] text-center">
            <h2 className="text-2xl font-display font-bold text-foreground">{t("archive_empty")}</h2>
            <p className="text-muted-foreground mt-2 max-w-md">{t("archive_empty_desc")}</p>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, staggerChildren: 0.1 }}
            className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-7 gap-3"
          >
            {archivedPatterns.map((pattern) => (
              <PatternCard
                key={pattern.id}
                pattern={pattern}
                selected={selectedIds.includes(pattern.id)}
                onToggleSelect={toggleSelect}
                size="compact"
              />
            ))}
          </motion.div>
        )}
      </main>
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desenleri Sil</AlertDialogTitle>
            <AlertDialogDescription>
              Seçili {selectedVisibleCount} deseni silmek istediğine emin misin? Bu işlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={deleteSelected}>Sil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
