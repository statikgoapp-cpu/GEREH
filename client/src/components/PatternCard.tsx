import { useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  Trash2,
  FileCheck,
  Loader2,
  AlertCircle,
  Image as ImageIcon,
  Send,
  PackageOpen,
  Share2,
} from "lucide-react";
import { motion } from "framer-motion";
import { useDeletePattern } from "@/hooks/use-patterns";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PatternCardProps {
  pattern: {
    id: number;
    imageUrl: string;
    svgUrl?: string | null;
    dxfUrl?: string | null;
    status: "pending" | "processing" | "completed" | "failed";
    createdAt: string | null;
    name?: string;
    category?: string;
    archived?: boolean;
  };
  selected?: boolean;
  onToggleSelect?: (id: number, selected: boolean) => void;
  onArchive?: (id: number) => void | Promise<void>;
  size?: "default" | "compact";
}

export function PatternCard({ pattern, selected = false, onToggleSelect, onArchive, size = "default" }: PatternCardProps) {
  const deletePattern = useDeletePattern();
  const [, setLocation] = useLocation();
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);

  const formatRelativeTime = (value: string | null) => {
    if (!value) return t("just_now");

    const date = new Date(value);
    const diffMs = date.getTime() - Date.now();
    const diffSeconds = Math.round(diffMs / 1000);
    const absSeconds = Math.abs(diffSeconds);

    if (absSeconds < 10) return t("just_now");

    const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto" });

    if (absSeconds < 60) return rtf.format(diffSeconds, "second");
    const diffMinutes = Math.round(diffSeconds / 60);
    if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, "minute");
    const diffHours = Math.round(diffSeconds / 3600);
    if (Math.abs(diffHours) < 24) return rtf.format(diffHours, "hour");
    const diffDays = Math.round(diffSeconds / 86400);
    if (Math.abs(diffDays) < 30) return rtf.format(diffDays, "day");
    const diffMonths = Math.round(diffSeconds / 2592000);
    if (Math.abs(diffMonths) < 12) return rtf.format(diffMonths, "month");
    const diffYears = Math.round(diffSeconds / 31536000);
    return rtf.format(diffYears, "year");
  };

  const isPdf = pattern.imageUrl.toLowerCase().endsWith(".pdf");
  const previewUrl = isPdf && pattern.svgUrl ? pattern.svgUrl : pattern.imageUrl;
  const sourceFormatLabel = isPdf ? "PDF" : "IMG";
  const shareUrl = `${window.location.origin}/pattern/${pattern.id}`;
  const extractedFromUrl = decodeURIComponent(
    (pattern.imageUrl.split("/").pop() || "").replace(/^\d+-\d+-/, ""),
  ).trim();
  const displayName = pattern.name?.trim() || extractedFromUrl || `${t("pattern_label")} #${pattern.id}`;

  const handleShare = async () => {
    const text = `GEREH - ${displayName}\n${shareUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: displayName, text, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(text);
      window.alert(t("share_copy_success"));
    } catch {
      const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(wa, "_blank", "noopener,noreferrer");
    }
  };

  const statusColor = {
    pending: "text-yellow-600 bg-yellow-50 border-yellow-200",
    processing: "text-blue-600 bg-blue-50 border-blue-200",
    completed: "text-green-600 bg-green-50 border-green-200",
    failed: "text-red-600 bg-red-50 border-red-200",
  }[pattern.status] || "text-gray-600 bg-gray-50 border-gray-200";

  const StatusIcon = {
    pending: Loader2,
    processing: Loader2,
    completed: FileCheck,
    failed: AlertCircle,
  }[pattern.status] || Loader2;

  const statusLabel = {
    pending: t("status_pending"),
    processing: t("status_processing"),
    completed: t("status_completed"),
    failed: t("status_failed"),
  }[pattern.status];

  const isCompact = size === "compact";

  return (
    <>
      <motion.div
        whileHover={{ y: -4, transition: { duration: 0.2 } }}
        onClick={() => setOpen(true)}
        className={`group relative bg-white ${isCompact ? "rounded-lg" : "rounded-xl"} border border-border shadow-sm hover:shadow-xl hover:border-primary/20 transition-all duration-300 cursor-pointer overflow-hidden flex flex-col h-full`}
      >
        <div className={`relative ${isCompact ? "aspect-[4/3]" : "aspect-[16/9]"} bg-muted/30 overflow-hidden border-b border-border/50`}>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={displayName}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
              {t("no_preview")}
            </div>
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />

          <div className={`absolute ${isCompact ? "top-2 right-2" : "top-3 right-3"} flex items-center gap-2`}>
            <span className={`inline-flex items-center gap-1.5 ${isCompact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"} rounded-full font-medium border ${statusColor}`}>
              <StatusIcon
                className={`${isCompact ? "w-3 h-3" : "w-3.5 h-3.5"} ${pattern.status === "processing" || pattern.status === "pending" ? "animate-spin" : ""}`}
              />
              {statusLabel}
            </span>
          </div>
        </div>

        <div className={`${isCompact ? "p-2" : "p-3"} flex flex-col flex-1`}>
          <div className={`flex items-start justify-between ${isCompact ? "mb-1" : "mb-1.5"}`}>
            <div>
              <h3 className={`font-display font-semibold ${isCompact ? "text-sm" : "text-base"} leading-tight text-foreground group-hover:text-primary transition-colors line-clamp-2`}>
                {displayName}
              </h3>
              <p className={`${isCompact ? "text-[11px] mt-0.5" : "text-xs mt-1"} text-muted-foreground font-mono`}>
                {formatRelativeTime(pattern.createdAt)}
              </p>
            </div>
          </div>

          <div className={`mt-auto ${isCompact ? "pt-1.5" : "pt-2"}`}>
            <div className={`${isCompact ? "mb-1" : "mb-1.5"} flex items-center gap-2`}>
              {pattern.status === "completed" && (
                <button
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setLocation(`/production-edit?patternId=${pattern.id}`);
                  }}
                  className={`${isCompact ? "p-1.5" : "p-2"} rounded-full bg-white border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors shadow-sm`}
                  aria-label={t("send_to_production")}
                >
                  <Send className={isCompact ? "w-3.5 h-3.5" : "w-4 h-4"} />
                </button>
              )}
              {!pattern.archived && (
                <button
                  onClick={async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (onArchive) await onArchive(pattern.id);
                  }}
                  className={`${isCompact ? "p-1.5" : "p-2"} rounded-full bg-white border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors shadow-sm`}
                  aria-label={t("archive_add")}
                >
                  <PackageOpen className={isCompact ? "w-3.5 h-3.5" : "w-4 h-4"} />
                </button>
              )}
              <button
                onClick={async (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  await handleShare();
                }}
                className={`${isCompact ? "p-1.5" : "p-2"} rounded-full bg-white border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors shadow-sm`}
                aria-label={t("share_pattern")}
              >
                <Share2 className={isCompact ? "w-3.5 h-3.5" : "w-4 h-4"} />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    className={`${isCompact ? "p-1.5" : "p-2"} rounded-full bg-white border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors shadow-sm`}
                    aria-label={t("delete_options")}
                  >
                    <Trash2 className={isCompact ? "w-3.5 h-3.5" : "w-4 h-4"} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                        }}
                      >
                        {t("delete_this_pattern")}
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("delete_title")}</AlertDialogTitle>
                        <AlertDialogDescription>{t("delete_desc")}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("cancel_action")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            await deletePattern.mutateAsync(pattern.id);
                          }}
                        >
                          {t("delete_action")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  {onToggleSelect && (
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        onToggleSelect(pattern.id, !selected);
                      }}
                    >
                      {selected ? t("remove_from_multi_select") : t("add_to_multi_select")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className={`flex items-center justify-between ${isCompact ? "text-xs" : "text-sm"}`}>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <ImageIcon className={isCompact ? "w-3.5 h-3.5" : "w-4 h-4"} />
                <span>
                  {t("source_label")}: {sourceFormatLabel}
                </span>
              </span>
              <div className="flex items-center gap-1 text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity transform translate-x-2 group-hover:translate-x-0 duration-300">
                {t("preview_action")} <ArrowRight className={isCompact ? "w-3.5 h-3.5" : "w-4 h-4"} />
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {open && (
        <div
          className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-5xl max-h-[90vh] bg-white rounded-2xl border border-border shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="text-sm font-semibold text-foreground">{displayName}</div>
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 rounded border border-border text-sm hover:bg-slate-50"
                  onClick={() => setLocation(`/pattern/${pattern.id}`)}
                >
                  {t("view_details")}
                </button>
                <button
                  className="px-3 py-1.5 rounded border border-border text-sm hover:bg-slate-50"
                  onClick={() => setOpen(false)}
                >
                  {t("close")}
                </button>
              </div>
            </div>
            <div className="h-[75vh] bg-black flex items-center justify-center">
              {pattern.svgUrl ? (
                <object
                  data={pattern.svgUrl}
                  type="image/svg+xml"
                  className="w-full h-full"
                  aria-label={t("processed_vector")}
                />
              ) : (
                <img src={previewUrl} alt={displayName} className="max-w-full max-h-full object-contain" />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
