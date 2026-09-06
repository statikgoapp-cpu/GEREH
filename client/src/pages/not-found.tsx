import { Link } from "wouter";
import { AlertCircle } from "lucide-react";
import { useI18n } from "@/i18n";

export default function NotFound() {
  const { t } = useI18n();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <div className="bg-white p-12 rounded-2xl shadow-xl text-center max-w-md border border-gray-100">
        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="h-10 w-10 text-red-500" />
        </div>

        <h1 className="text-4xl font-display font-bold text-gray-900 mb-2">404</h1>
        <h2 className="text-xl font-medium text-gray-700 mb-4">Page Not Found</h2>
        <p className="text-gray-500 mb-8 leading-relaxed">
          The page you are looking for does not exist or may have been moved.
        </p>

        <Link href="/">
          <button className="w-full py-3 px-6 bg-primary text-primary-foreground rounded-xl font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200">
            {t("back_to_dashboard")}
          </button>
        </Link>
      </div>
    </div>
  );
}
