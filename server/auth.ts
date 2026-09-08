import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { loginUserSchema, registerUserSchema, users } from "../shared/schema";
import { trackEvent } from "./analytics";

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET must be set in production");
}
const JWT_SECRET_VALUE = JWT_SECRET ?? "development-only-secret";
const configuredAdminEmail = () => process.env.ADMIN_EMAIL?.trim().toLowerCase();
const isConfiguredAdmin = (email: string) => configuredAdminEmail() === email.trim().toLowerCase();

const setAuthCookie = (res: any, token: string) => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `gereh_token=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax${secure}`,
  );
};

const clearAuthCookie = (res: any) => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `gereh_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`,
  );
};

const getCookieToken = (cookieHeader: string | undefined) => {
  const match = cookieHeader?.match(/(?:^|;\s*)gereh_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
};

// ==========================================
// 1. KAYIT OL (REGISTER)
// ==========================================
authRouter.post("/register", async (req, res) => {
  try {
    const parsed = registerUserSchema.safeParse({
      email: typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : req.body?.email,
      password: req.body?.password,
      name: typeof req.body?.name === "string" ? req.body.name.trim() : req.body?.name,
    });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz kayıt bilgileri." });
    }
    const { email, password, name } = parsed.data;

    // Email kullanımda mı kontrol et
    const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingUser.length > 0) {
      return res.status(400).json({ error: "Bu e-posta adresi zaten kullanımda." });
    }

    // Şifreyi Hash'le (Güvenli hale getir)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Kullanıcıyı veritabanına kaydet
    const newUserResult = await db.insert(users).values({
      email,
      passwordHash,
      name,
      role: isConfiguredAdmin(email) ? "admin" : "user",
    }).returning();

    const user = newUserResult[0];

    // JWT Token oluştur
    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET_VALUE, { expiresIn: "7d" });
    setAuthCookie(res, token);

    // Şifre hash'ini frontend'e göndermemek için ayırıyoruz
    const { passwordHash: _, ...safeUser } = user;
    void trackEvent({ userId: user.id, event: "REGISTER", sessionId: typeof req.headers["x-analytics-session"] === "string" ? req.headers["x-analytics-session"] : null });

    res.status(201).json({ user: safeUser, token });
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed: users.email")) {
      return res.status(409).json({ error: "Bu e-posta adresi zaten kullanımda." });
    }
    console.error("Register Error:", error);
    res.status(500).json({ error: "Kayıt işlemi sırasında bir hata oluştu." });
  }
});

// ==========================================
// 2. GİRİŞ YAP (LOGIN)
// ==========================================
authRouter.post("/login", async (req, res) => {
  try {
    const parsed = loginUserSchema.safeParse({
      email: typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : req.body?.email,
      password: req.body?.password,
    });
    if (!parsed.success) {
      return res.status(401).json({ error: "Geçersiz e-posta veya şifre." });
    }
    const { email, password } = parsed.data;

    // Kullanıcıyı veritabanında bul
    const userResult = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = userResult[0];

    if (!user) {
      return res.status(401).json({ error: "Geçersiz e-posta veya şifre." });
    }

    // Şifre doğrulaması yap
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: "Geçersiz e-posta veya şifre." });
    }

    // JWT Token oluştur
    const effectiveUser = isConfiguredAdmin(user.email) && user.role !== "admin"
      ? { ...user, role: "admin" }
      : user;
    if (effectiveUser.role !== user.role) {
      await db.update(users).set({ role: "admin", updatedAt: new Date().toISOString() }).where(eq(users.id, user.id));
    }

    const token = jwt.sign({ userId: effectiveUser.id, role: effectiveUser.role }, JWT_SECRET_VALUE, { expiresIn: "7d" });
    setAuthCookie(res, token);

    const { passwordHash: _, ...safeUser } = effectiveUser;
    void trackEvent({ userId: effectiveUser.id, event: "LOGIN", sessionId: typeof req.headers["x-analytics-session"] === "string" ? req.headers["x-analytics-session"] : null });
    res.json({ user: safeUser, token });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ error: "Giriş işlemi sırasında bir hata oluştu." });
  }
});

authRouter.post("/logout", authenticateToken, (req: any, res) => {
  void trackEvent({ userId: Number(req.user.userId), event: "LOGOUT" });
  clearAuthCookie(res);
  res.status(204).send();
});

// ==========================================
// 3. TOKEN DOĞRULAMA MIDDLEWARE'İ
// ==========================================
// Bu fonksiyonu şifreli rotalarda (örn: pattern ekleme) kullanacağız
export function authenticateToken(req: any, res: any, next: any) {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : getCookieToken(req.headers.cookie);

  if (!token) {
    return res.status(401).json({ error: "Yetkisiz erişim, token bulunamadı." });
  }

  jwt.verify(token, JWT_SECRET_VALUE, (err: any, decoded: any) => {
    if (err) return res.status(403).json({ error: "Geçersiz veya süresi dolmuş token." });
    req.user = decoded; // req.user içine { userId, role } bilgilerini ekledik
    next();
  });
}

// ==========================================
// 4. MEVCUT KULLANICI BİLGİSİNİ GETİR (ME)
// ==========================================
authRouter.get("/me", authenticateToken, async (req: any, res: any) => {
  try {
    const userResult = await db.select().from(users).where(eq(users.id, req.user.userId)).limit(1);
    const user = userResult[0];

    if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

    if (isConfiguredAdmin(user.email) && user.role !== "admin") {
      await db.update(users).set({ role: "admin", updatedAt: new Date().toISOString() }).where(eq(users.id, user.id));
      user.role = "admin";
    }

    const { passwordHash: _, ...safeUser } = user;
    res.json(safeUser);
  } catch (error) {
    res.status(500).json({ error: "Kullanıcı bilgileri alınırken hata oluştu." });
  }
});
