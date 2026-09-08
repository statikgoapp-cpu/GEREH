import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("user"),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export const patterns = sqliteTable("patterns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  name: text("name").notNull(),
  imageUrl: text("image_url").notNull(),
  svgUrl: text("svg_url"),
  dxfUrl: text("dxf_url"),
  category: text("category"),
  sizeCode: text("size_code"),
  realDiameterMm: integer("real_diameter_mm"),
  vectorDiameterMm: integer("vector_diameter_mm"),
  holeDiameterMm: integer("hole_diameter_mm"),
  status: text("status").notNull().default("pending"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const feedback = sqliteTable("feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  email: text("email").notNull(),
  category: text("category").notNull(),
  message: text("message").notNull(),
  page: text("page").notNull().default("/"),
  userAgent: text("user_agent"),
  status: text("status").notNull().default("NEW"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export const analyticsEvents = sqliteTable("analytics_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  event: text("event").notNull(),
  page: text("page"),
  sessionId: text("session_id"),
  metadata: text("metadata"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const registerUserSchema = z.object({
  email: z.string().email("Geçerli bir e-posta adresi giriniz"),
  password: z.string().min(6, "Şifre en az 6 karakter olmalıdır"),
  name: z.string().min(2, "İsim en az 2 karakter olmalıdır"),
});

export const loginUserSchema = z.object({
  email: z.string().email("Geçerli bir e-posta adresi giriniz"),
  password: z.string().min(1, "Şifre gereklidir"),
});

export const feedbackCategorySchema = z.enum([
  "Hata Bildir",
  "Öneri",
  "Beğendim",
  "Memnun Kalmadım",
  "Diğer",
]);

export const createFeedbackSchema = z.object({
  category: feedbackCategorySchema,
  message: z.string().trim().min(1, "Mesaj zorunludur.").max(2000, "Mesaj 2000 karakteri geçemez."),
  page: z.string().trim().max(200, "Sayfa bilgisi geçersiz.").optional().default("/"),
});

export const insertPatternSchema = createInsertSchema(patterns).omit({
  id: true,
  createdAt: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Pattern = typeof patterns.$inferSelect;
export type Feedback = typeof feedback.$inferSelect;
export type InsertPattern = z.infer<typeof insertPatternSchema>;
