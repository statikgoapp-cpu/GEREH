import { useMemo, useState } from "react";
import { UploadZone } from "@/components/UploadZone";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/InfoHint";

const RHINESTONE_SPECS = [
  { code: "SS4", realDiameter: 1.5, vectorDiameter: 1.6, holeDiameter: 1.8 },
  { code: "SS6", realDiameter: 2.0, vectorDiameter: 2.1, holeDiameter: 2.3 },
  { code: "SS10", realDiameter: 2.8, vectorDiameter: 2.9, holeDiameter: 3.1 },
  { code: "SS12", realDiameter: 3.1, vectorDiameter: 3.2, holeDiameter: 3.4 },
  { code: "SS16", realDiameter: 3.9, vectorDiameter: 4.0, holeDiameter: 4.2 },
  { code: "SS20", realDiameter: 4.7, vectorDiameter: 4.8, holeDiameter: 5.0 },
];

const RHINESTONE_ACCEPTED_IMAGE_MIME_MAP: Record<string, string[]> = {
  "image/jpeg": [".jpeg", ".jpg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/bmp": [".bmp"],
  "image/tiff": [".tiff", ".tif"],
  "image/avif": [".avif"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
};

const formatMm = (value: number) => `${value.toFixed(2)} mm`;

export default function RhinestoneTransfer() {
  const [selectedCode] = useState("SS10");
  const [targetCode, setTargetCode] = useState("SS10");
  const [pdfDpi, setPdfDpi] = useState(248);
  const { t } = useI18n();

  const tx = (key: string, fallback: string) => {
    const v = t(key);
    return v === key ? fallback : v;
  };

  const selectedSpec = useMemo(
    () => RHINESTONE_SPECS.find((row) => row.code === selectedCode) ?? RHINESTONE_SPECS[0],
    [selectedCode]
  );

  const targetSpec = useMemo(
    () => RHINESTONE_SPECS.find((row) => row.code === targetCode) ?? selectedSpec,
    [targetCode, selectedSpec]
  );

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
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-display font-bold text-foreground">{t("rhinestone_transfer")}</h1>
              <InfoHint
                text={tx(
                  "rhinestone_transfer_hint",
                  "Upload rhinestone artwork, select a size profile, and generate vector-ready output."
                )}
              />
            </div>
            <p className="text-muted-foreground mt-2 max-w-3xl">{t("rhinestone_desc")}</p>
          </div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1.2fr] gap-8">
          <section className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="p-5 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">{t("rhinestone_size_guide")}</h2>
                <InfoHint
                  text={tx(
                    "rhinestone_size_guide_hint",
                    "Click a row to set source stone dimensions. Output size can be changed separately."
                  )}
                />
              </div>
              <p className="text-sm text-muted-foreground mt-1">{t("rhinestone_size_guide_desc")}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-muted-foreground">
                  <tr>
                    <th className="text-left font-semibold py-3 px-5">{t("size_code")}</th>
                    <th className="text-left font-semibold py-3 px-5">{t("real_diameter")}</th>
                    <th className="text-left font-semibold py-3 px-5">{t("vector_diameter")}</th>
                    <th className="text-left font-semibold py-3 px-5">{t("hole_diameter")}</th>
                  </tr>
                </thead>
                <tbody>
                  {RHINESTONE_SPECS.map((row) => (
                    <tr
                      key={row.code}
                      className={cn("border-t border-border")}
                    >
                      <td className="py-3 px-5 font-medium text-foreground">{row.code}</td>
                      <td className="py-3 px-5 text-foreground">{formatMm(row.realDiameter)}</td>
                      <td className="py-3 px-5 text-foreground">{formatMm(row.vectorDiameter)}</td>
                      <td className="py-3 px-5 text-foreground">{formatMm(row.holeDiameter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-col gap-6">
            <div className="bg-white rounded-2xl border border-border shadow-sm p-6">
              <h3 className="text-lg font-semibold text-foreground">{t("selected_size")}</h3>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div className="rounded-xl border border-border bg-muted/20 p-4">
                  <p className="text-muted-foreground">{t("size_code")}</p>
                  <p className="text-lg font-semibold text-foreground mt-1">{selectedSpec.code}</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 p-4">
                  <p className="text-muted-foreground">{t("real_diameter")}</p>
                  <p className="text-lg font-semibold text-foreground mt-1">{formatMm(selectedSpec.realDiameter)}</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 p-4">
                  <p className="text-muted-foreground">{t("vector_diameter")}</p>
                  <p className="text-lg font-semibold text-foreground mt-1">{formatMm(selectedSpec.vectorDiameter)}</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 p-4">
                  <p className="text-muted-foreground">{t("hole_diameter")}</p>
                  <p className="text-lg font-semibold text-foreground mt-1">{formatMm(selectedSpec.holeDiameter)}</p>
                </div>
              </div>
              <div className="mt-6">
                <label className="text-sm font-medium text-foreground">{t("output_size_label")}</label>
                <div className="mt-2 flex items-center gap-3">
                  <select
                    value={targetCode}
                    onChange={(event) => setTargetCode(event.target.value)}
                    className="px-3 py-2 rounded-lg bg-white border border-border text-sm font-medium text-foreground shadow-sm"
                  >
                    {RHINESTONE_SPECS.map((row) => (
                      <option key={row.code} value={row.code}>
                        {row.code} ({formatMm(row.vectorDiameter)})
                      </option>
                    ))}
                  </select>
                  <span className="text-sm text-muted-foreground">
                    {t("desired_stone_diameter")}: {formatMm(targetSpec.vectorDiameter)}
                  </span>
                </div>
              </div>
              <div className="mt-6">
                <label className="text-sm font-medium text-foreground">
                  {tx("pdf_processing_dpi", "PDF Processing DPI")}
                </label>
                <div className="mt-3 rounded-xl border border-border bg-muted/20 p-4">
                  <input
                    type="range"
                    min={72}
                    max={1152}
                    step={8}
                    value={pdfDpi}
                    onChange={(event) => setPdfDpi(Number(event.target.value))}
                    className="w-full accent-primary"
                  />
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>72 DPI</span>
                    <span className="font-semibold text-foreground">{pdfDpi} DPI</span>
                    <span>1152 DPI</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {tx(
                      "pdf_processing_dpi_desc",
                      "The PDF is first converted into a sharp PNG using the selected DPI value, then rhinestone analysis is applied."
                    )}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-border shadow-sm p-6">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-lg font-semibold text-foreground">{t("upload_rhinestone_title")}</h3>
                <InfoHint
                  text={tx(
                    "upload_rhinestone_hint",
                    "Supports JPG, JPEG, PNG, WEBP, BMP, TIFF, AVIF, HEIC, HEIF and PDF. The engine preserves stone centers and exports production formats."
                  )}
                />
              </div>
              <p className="text-sm text-muted-foreground mb-6">
                {tx(
                  "upload_rhinestone_panel_desc",
                  "After upload, the recommended vector and punch hole diameters are saved to the system."
                )}
              </p>
              <UploadZone
                className="max-w-none"
                title={t("upload_rhinestone_title")}
                description={t("upload_rhinestone_desc")}
                dragActiveLabel={t("upload_drag_design")}
                ctaLabel={tx("upload_rhinestone_cta", "Start Rhinestone Transfer")}
                acceptedImageMimeMap={RHINESTONE_ACCEPTED_IMAGE_MIME_MAP}
                extraFormFields={{
                  category: "rhinestone",
                  sizeCode: targetSpec.code,
                  realDiameterMm: targetSpec.realDiameter,
                  vectorDiameterMm: targetSpec.vectorDiameter,
                  holeDiameterMm: targetSpec.holeDiameter,
                  targetVectorDiameterMm: targetSpec.vectorDiameter,
                  pdfDpi,
                }}
              />
            </div>
          </section>
        </div>
    </main>
  );
}
