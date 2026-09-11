import { FormEvent, useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

const categories = [
  { value: "Hata Bildir", key: "feedback_category_bug" },
  { value: "Öneri", key: "feedback_category_suggestion" },
  { value: "Beğendim", key: "feedback_category_liked" },
  { value: "Memnun Kalmadım", key: "feedback_category_disappointed" },
  { value: "Diğer", key: "feedback_category_other" },
] as const;

type FeedbackState = "idle" | "loading" | "success" | "error";

interface FeedbackDialogProps {
  compact?: boolean;
}

export default function FeedbackDialog({ compact = false }: FeedbackDialogProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof categories)[number]["value"]>(categories[0].value);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<FeedbackState>("idle");
  const [error, setError] = useState("");

  const reset = () => {
    setCategory(categories[0].value);
    setMessage("");
    setState("idle");
    setError("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) reset();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState("loading");
    setError("");

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          category,
          message,
          page: window.location.pathname,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Geri bildirim gönderilemedi.");
      }
      setState("success");
    } catch (submitError) {
      setState("error");
      setError(submitError instanceof Error ? submitError.message : "Geri bildirim gönderilemedi.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex w-full items-center rounded-lg border border-border/70 bg-white/90 py-2 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700",
            compact ? "justify-center px-2" : "justify-start gap-2 px-3",
          )}
          title={compact ? t("feedback_title") : undefined}
        >
          <MessageSquare className="h-4 w-4" />
          {!compact && <span>{t("feedback_button")}</span>}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        {state === "success" ? (
          <div className="py-5 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Send className="h-5 w-5" />
            </div>
            <DialogTitle>{t("feedback_success_title")}</DialogTitle>
            <DialogDescription className="mt-2">
              {t("feedback_success_desc")}
            </DialogDescription>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-6 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              {t("close")}
            </button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("feedback_title")}</DialogTitle>
              <DialogDescription>
                {t("feedback_desc")}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="feedback-category" className="mb-1.5 block text-sm font-medium">
                  {t("feedback_category")}
                </label>
                <select
                  id="feedback-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as (typeof categories)[number]["value"])}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {categories.map((item) => <option key={item.value} value={item.value}>{t(item.key)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="feedback-message" className="mb-1.5 block text-sm font-medium">
                  {t("feedback_message")}
                </label>
                <textarea
                  id="feedback-message"
                  required
                  maxLength={2000}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={t("feedback_placeholder")}
                  className="min-h-32 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-1 text-right text-xs text-muted-foreground">{message.length}/2000</p>
              </div>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <DialogFooter>
                <button
                  type="submit"
                  disabled={state === "loading" || !message.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  {state === "loading" ? t("feedback_sending") : t("feedback_submit")}
                </button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
