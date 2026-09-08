import { Link, useLocation, useParams } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  Cpu,
  Download,
  FileCode,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Share2,
  Trash2,
} from "lucide-react";
import { useDeletePattern, usePattern } from "@/hooks/use-patterns";
import { useI18n } from "@/i18n";
import { trackEvent } from "@/lib/analytics";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export default function PatternDetails() {
  const { id } = useParams();
  const patternId = Number(id);
  const { t } = useI18n();
  const { data: pattern, isLoading, error } = usePattern(patternId);
  const deletePattern = useDeletePattern();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground font-medium">{t("loading_pattern")}</p>
        </div>
      </main>
    );
  }

  if (error || !pattern) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold">{t("pattern_not_found")}</h2>
          <Link href="/" className="text-primary hover:underline mt-4 block">
            {t("return_home")}
          </Link>
        </div>
      </main>
    );
  }

  const isProcessing = pattern.status === "processing" || pattern.status === "pending";
  const isFailed = pattern.status === "failed";
  const isCompleted = pattern.status === "completed";
  const statusDotClass = isCompleted ? "bg-green-500" : isProcessing ? "bg-blue-500" : "bg-red-500";
  const svgDownloadUrl = pattern.svgUrl ?? null;
  const dxfDownloadUrl = pattern.dxfUrl ?? null;
  const pdfDownloadUrl =
    pattern.svgUrl && pattern.svgUrl.toLowerCase().endsWith(".svg")
      ? pattern.svgUrl.replace(/\.svg$/i, ".pdf")
      : null;

  const createdAt = pattern.createdAt ? new Date(pattern.createdAt) : null;
  const displayName = pattern.name?.trim() || `Pattern #${pattern.id}`;
  const absoluteUrl = (url: string) => `${window.location.origin}${url}`;

  const handleShare = async () => {
    const lines: string[] = [
      `GEREH - ${displayName}`,
      `${window.location.origin}/pattern/${pattern.id}`,
    ];
    if (svgDownloadUrl) lines.push(`SVG: ${absoluteUrl(svgDownloadUrl)}`);
    if (dxfDownloadUrl) lines.push(`DXF: ${absoluteUrl(dxfDownloadUrl)}`);
    if (pdfDownloadUrl) lines.push(`PDF: ${absoluteUrl(pdfDownloadUrl)}`);
    const text = lines.join("\n");
    try {
      if (navigator.share) {
        await navigator.share({
          title: displayName,
          text,
          url: `${window.location.origin}/pattern/${pattern.id}`,
        });
        return;
      }
      await navigator.clipboard.writeText(text);
      window.alert("Paylaşım bağlantıları kopyalandı.");
    } catch {
      window.alert("Paylaşım bu cihazda kullanılamadı.");
    }
  };

  return (
    <main className="bg-grid-pattern min-h-screen">
        <header className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8 border-b border-border pb-6">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors mb-4 text-sm font-medium group"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              {t("back_to_dashboard")}
            </Link>
            <div className="flex items-center gap-4">
              <h1 className="text-3xl font-display font-bold text-foreground">
                {displayName}
              </h1>
              <span
                className={`px-3 py-1 rounded-full text-xs font-semibold border flex items-center gap-2
                ${isCompleted ? "bg-green-50 text-green-700 border-green-200" :
                  isProcessing ? "bg-blue-50 text-blue-700 border-blue-200" :
                  "bg-red-50 text-red-700 border-red-200"}`}
              >
                {isProcessing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${statusDotClass}`} aria-hidden />
                )}
                <span>{pattern.status.toUpperCase()}</span>
              </span>
            </div>
            <p className="text-muted-foreground mt-2 font-mono text-sm">
              {createdAt
                ? `${t("created_on")} ${createdAt.toLocaleDateString()} ${t("created_at")} ${createdAt.toLocaleTimeString()}`
                : t("just_now")}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  disabled={deletePattern.isPending}
                  className="p-2.5 rounded-lg border border-border bg-white text-muted-foreground hover:text-destructive hover:border-destructive/30 hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
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
                      setLocation("/");
                    }}
                  >
                    {t("delete_action")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <button
              onClick={handleShare}
              className="p-2.5 rounded-lg border border-border bg-white text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
            >
              <Share2 className="w-5 h-5" />
            </button>
            {isCompleted && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="
                      flex items-center gap-2 px-4 py-2 rounded-lg
                      bg-primary text-primary-foreground font-medium
                      shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 hover:bg-primary/90
                      active:translate-y-0 active:shadow-md
                      transition-all duration-200
                    "
                  >
                    <Download className="w-4 h-4" />
                    {t("download")}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {dxfDownloadUrl && (
                    <DropdownMenuItem asChild>
                      <a href={dxfDownloadUrl} download={`pattern-${pattern.id}.dxf`} onClick={() => trackEvent("DXF_EXPORT", "/pattern-details", { format: "dxf" })}>
                        DXF
                      </a>
                    </DropdownMenuItem>
                  )}
                  {svgDownloadUrl && (
                    <DropdownMenuItem asChild>
                      <a href={svgDownloadUrl} download={`pattern-${pattern.id}.svg`} onClick={() => trackEvent("SVG_EXPORT", "/pattern-details", { format: "svg" })}>
                        SVG
                      </a>
                    </DropdownMenuItem>
                  )}
                  {pdfDownloadUrl && (
                    <DropdownMenuItem asChild>
                      <a href={pdfDownloadUrl} download={`pattern-${pattern.id}.pdf`} onClick={() => trackEvent("PDF_DOWNLOAD", "/pattern-details", { format: "pdf" })}>
                        PDF
                      </a>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-250px)]">
          <div className="flex flex-col h-full bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ImageIcon className="w-4 h-4 text-muted-foreground" />
                {t("original_raster")}
              </div>
              <div className="text-xs text-muted-foreground font-mono">JPG/PNG/PDF</div>
            </div>
            <div className="flex-1 relative bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] bg-gray-50 flex items-center justify-center p-8 overflow-auto">
              {pattern.imageUrl.toLowerCase().endsWith(".pdf") ? (
                <iframe
                  src={`${pattern.imageUrl}#toolbar=0`}
                  title="Original PDF"
                  className="w-full h-full rounded-lg border border-black/5 bg-white"
                />
              ) : (
                <img
                  src={pattern.imageUrl}
                  alt="Original"
                  className="max-w-full max-h-full object-contain shadow-xl rounded-lg border border-black/5"
                />
              )}
            </div>
          </div>

          <div className="flex flex-col h-full bg-white rounded-2xl border border-border shadow-sm overflow-hidden relative">
            <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileCode className="w-4 h-4 text-accent" />
                {t("processed_vector")}
              </div>
              <div className="text-xs text-muted-foreground font-mono">SVG/DXF</div>
            </div>

            <div className="flex-1 relative flex items-center justify-center p-8 bg-white overflow-hidden">
              {isProcessing ? (
                <div className="text-center">
                  <div className="relative w-24 h-24 mx-auto mb-6">
                    <div className="absolute inset-0 border-4 border-muted rounded-full" />
                    <div className="absolute inset-0 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                    <Cpu className="absolute inset-0 m-auto w-8 h-8 text-accent animate-pulse" />
                  </div>
                  <h3 className="text-lg font-medium text-foreground">{t("neural_processing_title")}</h3>
                  <p className="text-muted-foreground mt-2 max-w-xs mx-auto">{t("neural_processing_desc")}</p>
                </div>
              ) : isFailed ? (
                <div className="text-center p-8 bg-red-50 rounded-xl border border-red-100 max-w-md">
                  <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-red-900">{t("processing_failed_title")}</h3>
                  <p className="text-red-700 mt-2 text-sm">{t("processing_failed_desc")}</p>
                  <button className="mt-4 px-4 py-2 bg-white border border-red-200 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors flex items-center gap-2 mx-auto">
                    <RefreshCw className="w-4 h-4" /> {t("retry")}
                  </button>
                </div>
              ) : pattern.svgUrl ? (
                <div className="w-full h-full flex items-center justify-center bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]">
                  <object
                    data={pattern.svgUrl}
                    type="image/svg+xml"
                    aria-label="Vector Result"
                    className="w-full h-full max-w-full max-h-full object-contain drop-shadow-2xl"
                  />
                </div>
              ) : (
                <div className="text-muted-foreground">{t("no_preview")}</div>
              )}
            </div>

            {isProcessing && (
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-accent/5 to-transparent mix-blend-overlay" />
            )}
          </div>
        </div>
    </main>
  );
}
