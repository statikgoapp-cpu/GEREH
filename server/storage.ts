import { patterns, type Pattern, type InsertPattern } from "@shared/schema";
import { db } from "./db";
import { desc, eq, and, or } from "drizzle-orm";

export interface IStorage {
  createPattern(pattern: InsertPattern): Promise<Pattern>;
  getPattern(id: number, userId?: number): Promise<Pattern | undefined>;
  getPatternByFileUrl(fileUrl: string, userId: number): Promise<Pattern | undefined>;
  listPatterns(userId: number): Promise<Pattern[]>;
  updatePatternStatus(
    id: number,
    status: string,
    svgUrl?: string,
    dxfUrl?: string,
    userId?: number
  ): Promise<Pattern>;
  updatePatternArchive(id: number, archived: boolean, userId?: number): Promise<Pattern>;
  createArchivedCopy(pattern: Pattern): Promise<Pattern>;
  deletePattern(id: number, userId?: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async createPattern(pattern: InsertPattern): Promise<Pattern> {
    const [newPattern] = await db
      .insert(patterns)
      .values({ ...pattern, createdAt: new Date().toISOString() })
      .returning();

    return newPattern;
  }

  async getPattern(id: number, userId?: number): Promise<Pattern | undefined> {
    const conditions = userId === undefined
      ? eq(patterns.id, id)
      : and(eq(patterns.id, id), eq(patterns.userId, userId));

    const [pattern] = await db
      .select()
      .from(patterns)
      .where(conditions);

    return pattern;
  }

  async getPatternByFileUrl(fileUrl: string, userId: number): Promise<Pattern | undefined> {
    const [pattern] = await db
      .select()
      .from(patterns)
      .where(
        and(
          eq(patterns.userId, userId),
          or(
            eq(patterns.imageUrl, fileUrl),
            eq(patterns.svgUrl, fileUrl),
            eq(patterns.dxfUrl, fileUrl),
          ),
        ),
      );

    return pattern;
  }

  async listPatterns(userId: number): Promise<Pattern[]> {
    return await db
      .select()
      .from(patterns)
      .where(eq(patterns.userId, userId))
      .orderBy(desc(patterns.createdAt));
  }

  async updatePatternStatus(
    id: number,
    status: string,
    svgUrl?: string,
    dxfUrl?: string,
    userId?: number
  ): Promise<Pattern> {
    const conditions = userId === undefined
      ? eq(patterns.id, id)
      : and(eq(patterns.id, id), eq(patterns.userId, userId));

    const [updated] = await db
      .update(patterns)
      .set({
        status,
        ...(svgUrl !== undefined ? { svgUrl } : {}),
        ...(dxfUrl !== undefined ? { dxfUrl } : {}),
      })
      .where(conditions)
      .returning();

    if (!updated) {
      throw new Error("Pattern not found or access denied");
    }

    return updated;
  }

  async updatePatternArchive(
    id: number,
    archived: boolean,
    userId?: number
  ): Promise<Pattern> {
    const conditions = userId === undefined
      ? eq(patterns.id, id)
      : and(eq(patterns.id, id), eq(patterns.userId, userId));

    const [updated] = await db
      .update(patterns)
      .set({ archived })
      .where(conditions)
      .returning();

    if (!updated) {
      throw new Error("Pattern not found or access denied");
    }

    return updated;
  }

  async createArchivedCopy(pattern: Pattern): Promise<Pattern> {
    const [created] = await db
      .insert(patterns)
      .values({
        userId: pattern.userId,
        name: pattern.name ?? "",
        imageUrl: pattern.imageUrl,
        svgUrl: pattern.svgUrl ?? null,
        dxfUrl: pattern.dxfUrl ?? null,
        category: pattern.category ?? "pattern",
        sizeCode: pattern.sizeCode ?? null,
        realDiameterMm: pattern.realDiameterMm ?? null,
        vectorDiameterMm: pattern.vectorDiameterMm ?? null,
        holeDiameterMm: pattern.holeDiameterMm ?? null,
        status: pattern.status,
        archived: true,
        createdAt: new Date().toISOString(),
      })
      .returning();

    return created;
  }

  async deletePattern(id: number, userId?: number): Promise<boolean> {
    const existing = await this.getPattern(id, userId);

    if (!existing) {
      return false;
    }

    const conditions = userId === undefined
      ? eq(patterns.id, id)
      : and(eq(patterns.id, id), eq(patterns.userId, userId));

    await db.delete(patterns).where(conditions);

    return true;
  }
}

export const storage = new DatabaseStorage();
