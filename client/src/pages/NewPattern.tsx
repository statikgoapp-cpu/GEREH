import { useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { UploadZone } from "@/components/UploadZone";
import { useI18n } from "@/i18n";
import { InfoHint } from "@/components/InfoHint";

export default function NewPattern() {
  const { t } = useI18n();
  const [pdfDpi, setPdfDpi] = useState(200);

  const tx = (key: string, fallback: string) => {
    const v = t(key);
    return v === key ? fallback : v;
  };

  return (
    <main className="bg-grid-pattern min-h-screen flex flex-col">
        <header className="mb-12">
          <Link
            href="/"
            className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors mb-6 text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" /> {t("back_to_dashboard")}
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-display font-bold text-foreground">{t("upload_title")}</h1>
            <InfoHint text={t("upload_desc")} />
          </div>
          <p className="text-muted-foreground mt-2">{t("upload_desc")}</p>
        </header>

        <div className="mb-6 max-w-2xl mx-auto w-full">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-foreground">
              {tx("pdf_processing_dpi", "PDF Processing DPI")}
            </label>
            
          </div>
          <div className="mt-3 rounded-xl border border-border bg-white p-4 shadow-sm">
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

        <div className="flex-1 flex items-center justify-center pb-20">
          <UploadZone
            title={t("upload_title")}
            description={t("upload_desc")}
            ctaLabel={t("upload_cta")}
            dragActiveLabel={t("upload_drag_active")}
            extraFormFields={{ pdfDpi }}
          />
        </div>
    </main>
  );
}
