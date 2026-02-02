import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const patterns = pgTable("patterns", {
  id: serial("id").primaryKey(),
  imageUrl: text("image_url").notNull(),
  svgUrl: text("svg_url"),
  dxfUrl: text("dxf_url"),
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPatternSchema = createInsertSchema(patterns).omit({ 
  id: true, 
  svgUrl: true, 
  dxfUrl: true, 
  status: true, 
  createdAt: true 
});

export type Pattern = typeof patterns.$inferSelect;
export type InsertPattern = z.infer<typeof insertPatternSchema>;
