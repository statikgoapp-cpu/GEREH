import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Download, ImagePlus, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import PatternCanvas from "@/components/PatternCanvas";
import ControlPanel from "@/components/ControlPanel";
import StatsBar from "@/components/StatsBar";
import ColorLegend from "@/components/ColorLegend";
import {
  DEFAULT_OPTIONS,
  generateDXF,
  generatePLT,
  generateRhinestonePattern,
  generateSVG,
  type FillOptions,
  type StonePattern,
} from "@/components/rhinestone-fill-engine";
import { api } from "@shared/routes";
import { InfoHint } from "@/components/InfoHint";
import { useI18n } from "@/i18n";
import { useToast } from "@/hooks/use-toast";
import { withApiBase } from "@/lib/api-base";

function prepareImageData(img: HTMLImageElement): ImageData {
  const maxDim = 600;
  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;
  const scaleFactor = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
  const w = Math.round(sourceWidth * scaleFactor);
  const h = Math.round(sourceHeight * scaleFactor);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas context is not available.");
  }

  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image could not be loaded."));
    img.src = src;
  });
}

export default function RhinestoneFill() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [options, setOptions] = useState<FillOptions>({ ...DEFAULT_OPTIONS });
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pattern, setPattern] = useState<StonePattern | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tx = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const saveGeneratedPattern = async (generatedPattern: StonePattern) => {
    const svg = generateSVG(generatedPattern, options.stoneStyle);
    const dxf = generateDXF(generatedPattern);
    const plt = generatePLT(generatedPattern);
    const baseName = (sourceFile?.name ?? "rhinestone-fill")
      .replace(/\.[^/.]+$/g, "")
      .trim();

    const formData = new FormData();
    formData.append("mode", "rhinestone");
    formData.append("name", baseName || "rhinestone-fill");
    formData.append("svg", svg);
    formData.append("dxf", dxf);
    formData.append("plt", plt);

    const res = await fetch(withApiBase("/api/production-saves"), {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Auto save failed (${res.status})`);
    }

    await queryClient.invalidateQueries({ queryKey: [api.patterns.list.path] });

    toast({
      title: t("pattern_uploaded"),
      description: tx("fill_saved_to_dashboard", "Generated pattern was added to Dashboard automatically."),
    });
  };

  const handleFileChange = (file: File | null) => {
    setPattern(null);
    setError(null);

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    if (!file) {
      setSourceFile(null);
      setPreviewUrl(null);
      return;
    }

    setSourceFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleGenerate = async () => {
    if (!previewUrl) {
      setError(tx("fill_error_select_image_first", "Please select an image first."));
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const image = await loadImage(previewUrl);
      const imageData = prepareImageData(image);
      const result = await generateRhinestonePattern(imageData, options);
      setPattern(result);
      await saveGeneratedPattern(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("fill_error_generation_failed", "Pattern generation failed."));
    } finally {
      setIsGenerating(false);
    }
  };

  const exportSvg = () => {
    if (!pattern) return;
    downloadTextFile("rhinestone-fill.svg", generateSVG(pattern, options.stoneStyle), "image/svg+xml");
  };

  const exportDxf = () => {
    if (!pattern) return;
    downloadTextFile("rhinestone-fill.dxf", generateDXF(pattern), "application/dxf");
  };

  const exportPlt = () => {
    if (!pattern) return;
    downloadTextFile("rhinestone-fill.plt", generatePLT(pattern), "text/plain");
  };

  return (
    <main className="bg-grid-pattern min-h-screen">
        <header className="flex flex-col gap-3 mb-8 border-b border-border pb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-sm font-medium group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            {t("back_to_dashboard")}
          </Link>
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-display font-bold text-foreground">{t("rhinestone_fill")}</h1>
                <InfoHint text={tx("fill_page_hint", "Upload an image, fill enclosed areas with stones, then export SVG, DXF, or PLT.")} />
              </div>
              <p className="text-muted-foreground mt-2 max-w-3xl">
                {tx("fill_page_desc", "This screen automatically fills the inner areas of your image with stones and creates production-ready outputs.")}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-white text-foreground text-sm font-medium shadow-sm cursor-pointer hover:bg-muted/40 transition-colors">
                <ImagePlus className="w-4 h-4" />
                {tx("fill_select_image", "Select Image")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/bmp"
                  className="hidden"
                  onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!sourceFile || isGenerating}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 hover:bg-primary/90 active:translate-y-0 active:shadow-md transition-all duration-200 disabled:opacity-60 disabled:pointer-events-none"
              >
                <Sparkles className="w-4 h-4" />
                {isGenerating ? tx("fill_generating", "Generating...") : tx("fill_generate_cta", "Fill With Stones")}
              </button>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-8">
          <aside className="space-y-6">
            <section className="bg-[#11131a] text-white rounded-2xl border border-white/10 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold">{tx("fill_controls_title", "Controls")}</h2>
                  <p className="text-xs text-white/45 mt-1">{tx("fill_controls_desc", "Adjust fill density and stone behavior.")}</p>
                </div>
              </div>
              <ControlPanel options={options} onChange={setOptions} />
            </section>

            <section className="bg-[#11131a] text-white rounded-2xl border border-white/10 shadow-sm p-5">
              <h2 className="text-lg font-semibold">{tx("fill_color_distribution_title", "Color Distribution")}</h2>
              <p className="text-xs text-white/45 mt-1 mb-4">{tx("fill_color_distribution_desc", "The color groups of the generated stones are listed here.")}</p>
              {pattern ? (
                <ColorLegend groups={pattern.colorGroups} />
              ) : (
                <p className="text-sm text-white/45">{tx("fill_color_distribution_empty", "Upload an image and generate the stone layout first.")}</p>
              )}
            </section>
          </aside>

          <section className="space-y-6 min-w-0">
            <div className="bg-white rounded-2xl border border-border shadow-sm p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{tx("fill_preview_title", "Preview")}</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {tx("fill_preview_desc", "The source image appears on the left and the stone-filled output appears on the right.")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={exportSvg}
                    disabled={!pattern}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-white text-sm font-medium text-foreground disabled:opacity-50 disabled:pointer-events-none"
                  >
                    <Download className="w-4 h-4" />
                    SVG
                  </button>
                  <button
                    type="button"
                    onClick={exportDxf}
                    disabled={!pattern}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-white text-sm font-medium text-foreground disabled:opacity-50 disabled:pointer-events-none"
                  >
                    <Download className="w-4 h-4" />
                    DXF
                  </button>
                  <button
                    type="button"
                    onClick={exportPlt}
                    disabled={!pattern}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-white text-sm font-medium text-foreground disabled:opacity-50 disabled:pointer-events-none"
                  >
                    <Download className="w-4 h-4" />
                    PLT
                  </button>
                </div>
              </div>

              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
                <div className="rounded-2xl border border-border bg-muted/20 p-4">
                  <p className="text-sm font-medium text-foreground mb-3">{tx("fill_source_image_title", "Source Image")}</p>
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={tx("fill_source_image_alt", "Uploaded source")}
                      className="w-full h-auto max-h-[640px] object-contain rounded-xl bg-white"
                    />
                  ) : (
                    <div className="flex items-center justify-center min-h-[320px] rounded-xl border border-dashed border-border text-sm text-muted-foreground bg-white">
                      {tx("fill_source_image_empty", "The selected image will appear here.")}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-border bg-muted/20 p-4">
                  <p className="text-sm font-medium text-foreground mb-3">{tx("fill_output_title", "Stone-Filled Output")}</p>
                  {pattern ? (
                    <PatternCanvas pattern={pattern} stoneStyle={options.stoneStyle} />
                  ) : (
                    <div className="flex items-center justify-center min-h-[320px] rounded-xl border border-dashed border-border text-sm text-muted-foreground bg-white">
                      {tx("fill_output_empty", "Upload an image and click \"Fill With Stones\" to see the output.")}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {pattern ? (
              <div className="bg-white rounded-2xl border border-border shadow-sm p-5">
                <h2 className="text-lg font-semibold text-foreground mb-4">{tx("fill_production_summary", "Production Summary")}</h2>
                <StatsBar pattern={pattern} />
              </div>
            ) : null}
          </section>
        </div>

    </main>
  );
}
