import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "../hooks/use-auth";
import { getAnalyticsSessionId } from "@/lib/analytics";

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState(""); // Sadece kayıt olurken kullanılacak
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  
  const [, setLocation] = useLocation();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";
    const payload = isLogin ? { email, password } : { email, password, name };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Analytics-Session": getAnalyticsSessionId() },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "İşlem sırasında bir hata oluştu.");
      }

      // Başarılı olursa context'i güncelle ve ana sayfaya yönlendir
      login(data.token, data.user);
      setLocation("/");
      
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Başlık ve Sekmeler */}
        <div className="flex border-b text-center text-sm font-medium">
          <button
            type="button"
            className={`flex-1 py-4 transition-colors duration-200 ${
              isLogin ? "border-b-2 border-indigo-600 text-indigo-600" : "text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setIsLogin(true)}
          >
            Giriş Yap
          </button>
          <button
            type="button"
            className={`flex-1 py-4 transition-colors duration-200 ${
              !isLogin ? "border-b-2 border-indigo-600 text-indigo-600" : "text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setIsLogin(false)}
          >
            Kayıt Ol
          </button>
        </div>

        {/* Form Alanı */}
        <div className="p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-800">
              {isLogin ? "Tekrar Hoş Geldiniz!" : "Aramıza Katılın"}
            </h2>
            <p className="text-gray-500 text-sm mt-2">
              {isLogin
                ? "Hesabınıza giriş yaparak desenlerinizi yönetmeye devam edin."
                : "Yeni bir hesap oluşturarak sistemin tüm özelliklerini kullanmaya başlayın."}
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm border border-red-200">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ad Soyad</label>
                <input
                  type="text"
                  name="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 outline-none transition-all"
                  placeholder="Ahmet Yılmaz"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-posta Adresi</label>
              <input
                type="email"
                  name="email"
                  autoComplete={isLogin ? "username" : "email"}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 outline-none transition-all"
                placeholder="ornek@mail.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Şifre</label>
              <input
                type="password"
                  name="password"
                  autoComplete={isLogin ? "current-password" : "new-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 outline-none transition-all"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-indigo-600 text-white font-medium py-2.5 rounded-lg hover:bg-indigo-700 focus:ring-4 focus:ring-indigo-200 transition-all disabled:opacity-70"
            >
              {isLoading ? "Bekleniyor..." : isLogin ? "Giriş Yap" : "Kayıt Ol"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
