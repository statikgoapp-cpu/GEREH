import { useEffect, useMemo, useState } from "react";
import { Check, Languages, Moon, Save, Sun } from "lucide-react";
import { useI18n, languageOptions, type LanguageCode } from "@/i18n";
import { useTheme } from "next-themes";
import { InfoHint } from "@/components/InfoHint";

const PREFS_KEY = "np_settings_v2";

type UserPrefs = {
  stoneNormalization: boolean;
  pdfPreview: boolean;
};

const defaultPrefs: UserPrefs = {
  stoneNormalization: true,
  pdfPreview: true,
};

export default function Settings() {
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [prefs, setPrefs] = useState<UserPrefs>(defaultPrefs);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<UserPrefs>;
      setPrefs({
        stoneNormalization:
          typeof parsed.stoneNormalization === "boolean"
            ? parsed.stoneNormalization
            : defaultPrefs.stoneNormalization,
        pdfPreview:
          typeof parsed.pdfPreview === "boolean" ? parsed.pdfPreview : defaultPrefs.pdfPreview,
      });
    } catch {
      setPrefs(defaultPrefs);
    }
  }, []);

  const savePrefs = () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    setSavedAt(new Date().toLocaleTimeString());
  };

  const languageLabel = useMemo(
    () => languageOptions.find((opt) => opt.code === language)?.label ?? language,
    [language]
  );

  return (
    <main className="bg-grid-pattern min-h-screen">
        <header className="mb-8 border-b border-border pb-6">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-display font-bold text-foreground">{t("settings_title")}</h1>
            <InfoHint text={t("settings_desc")} />
          </div>
          <p className="text-muted-foreground mt-2 max-w-2xl">{t("settings_desc")}</p>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                {mounted && theme === "dark" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-foreground">{t("theme")}</h2>
                  <InfoHint text={t("theme_desc")} />
                </div>
                <p className="text-sm text-muted-foreground">{t("theme_desc")}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  mounted && theme === "light"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-foreground hover:bg-muted"
                }`}
              >
                {t("light")}
              </button>
              <button
                type="button"
                onClick={() => setTheme("dark")}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  mounted && theme === "dark"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-foreground hover:bg-muted"
                }`}
              >
                {t("dark")}
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
                <Languages className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-foreground">{t("language")}</h2>
                  <InfoHint text={t("language_desc")} />
                </div>
                <p className="text-sm text-muted-foreground">{t("language_desc")}</p>
              </div>
            </div>

            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as LanguageCode)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground text-sm"
            >
              {languageOptions.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>

            <p className="text-xs text-muted-foreground mt-3">{languageLabel}</p>
          </section>

          <section className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm p-6 xl:col-span-2">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-lg font-semibold text-foreground">{t("processing_defaults")}</h2>
              <InfoHint text={t("processing_defaults_desc")} />
            </div>
            <p className="text-sm text-muted-foreground mb-5">{t("processing_defaults_desc")}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{t("stone_normalization")}</p>
                  <p className="text-xs text-muted-foreground">{t("stone_normalization_hint")}</p>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.stoneNormalization}
                  onChange={(event) =>
                    setPrefs((prev) => ({ ...prev, stoneNormalization: event.target.checked }))
                  }
                  className="h-4 w-4 accent-primary"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{t("pdf_preview")}</p>
                  <p className="text-xs text-muted-foreground">{t("pdf_preview_hint")}</p>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.pdfPreview}
                  onChange={(event) =>
                    setPrefs((prev) => ({ ...prev, pdfPreview: event.target.checked }))
                  }
                  className="h-4 w-4 accent-primary"
                />
              </label>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={savePrefs}
                className="inline-flex items-center gap-2 rounded-lg border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-95"
              >
                <Save className="w-4 h-4" />
                {t("saved_preferences")}
              </button>

              {savedAt && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="w-3.5 h-3.5" />
                  {savedAt}
                </span>
              )}
            </div>
          </section>
        </div>
    </main>
  );
}
