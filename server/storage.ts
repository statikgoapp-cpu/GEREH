import { patterns, type Pattern, type InsertPattern } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  createPattern(pattern: InsertPattern): Promise<Pattern>;
  getPattern(id: number): Promise<Pattern | undefined>;
  listPatterns(): Promise<Pattern[]>;
  updatePatternStatus(id: number, status: string, svgUrl?: string, dxfUrl?: string): Promise<Pattern>;
}

export class DatabaseStorage implements IStorage {
  async createPattern(pattern: InsertPattern): Promise<Pattern> {
    const [newPattern] = await db.insert(patterns).values(pattern).returning();
    return newPattern;
  }

  async getPattern(id: number): Promise<Pattern | undefined> {
    const [pattern] = await db.select().from(patterns).where(eq(patterns.id, id));
    return pattern;
  }

  async listPatterns(): Promise<Pattern[]> {
    return await db.select().from(patterns).orderBy(patterns.createdAt);
  }

  async updatePatternStatus(id: number, status: string, svgUrl?: string, dxfUrl?: string): Promise<Pattern> {
    const [updated] = await db
      .update(patterns)
      .set({ status, svgUrl, dxfUrl })
      .where(eq(patterns.id, id))
      .returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
