import { Router } from "express";
import { count, countDistinct, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { analyticsEvents, users } from "@shared/schema";
import { authenticateToken } from "./auth";
import { ANALYTICS_EVENTS, trackEvent } from "./analytics";

const router = Router();

const requireAdmin = async (req: any, res: any, next: any) => {
  try {
    const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, Number(req.user.userId))).limit(1);
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
    next();
  } catch {
    res.status(500).json({ error: "Authorization check failed" });
  }
};

router.post("/events", authenticateToken, async (req: any, res) => {
  const { event, page, sessionId, metadata } = req.body ?? {};
  if (typeof event !== "string" || !(ANALYTICS_EVENTS as readonly string[]).includes(event)) {
    return res.status(400).json({ error: "Unsupported analytics event" });
  }
  if (metadata !== undefined && (metadata === null || typeof metadata !== "object" || Array.isArray(metadata))) {
    return res.status(400).json({ error: "Invalid metadata" });
  }
  await trackEvent({
    userId: Number(req.user.userId),
    event,
    page: typeof page === "string" ? page : null,
    sessionId: typeof sessionId === "string" ? sessionId : null,
    metadata,
  });
  return res.status(202).json({ ok: true });
});

router.get("/summary", authenticateToken, requireAdmin, async (_req, res) => {
  const now = new Date();
  const iso = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  const day = iso(24);
  const week = iso(24 * 7);
  const month = iso(24 * 30);

  const [totalUsers, dau, wau, mau, newToday, newWeek, newMonth] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: countDistinct(analyticsEvents.userId) }).from(analyticsEvents).where(gte(analyticsEvents.createdAt, day)),
    db.select({ value: countDistinct(analyticsEvents.userId) }).from(analyticsEvents).where(gte(analyticsEvents.createdAt, week)),
    db.select({ value: countDistinct(analyticsEvents.userId) }).from(analyticsEvents).where(gte(analyticsEvents.createdAt, month)),
    db.select({ value: count() }).from(users).where(gte(users.createdAt, day)),
    db.select({ value: count() }).from(users).where(gte(users.createdAt, week)),
    db.select({ value: count() }).from(users).where(gte(users.createdAt, month)),
  ]);

  const usageRows = await db.select({
    event: analyticsEvents.event,
    total: count(),
    uniqueUsers: countDistinct(analyticsEvents.userId),
    uniqueSessions: countDistinct(analyticsEvents.sessionId),
  }).from(analyticsEvents).groupBy(analyticsEvents.event);
  const usage = Object.fromEntries(usageRows.map((row) => [row.event, row]));
  const funnelEvents = ["REGISTER", "LOGIN", "PATTERN_UPLOAD", "PATTERN_PROCESS_COMPLETE", "PDF_EXPORT", "SVG_EXPORT", "DXF_EXPORT", "PDF_DOWNLOAD", "FEEDBACK_SUBMIT"];
  const funnel = Object.fromEntries(funnelEvents.map((event) => [event, usage[event]?.uniqueUsers ?? 0]));

  const returningRows = await db.all<{ period: string; value: number }>(sql`
    SELECT 'week' AS period, COUNT(*) AS value FROM (
      SELECT user_id FROM analytics_events
      GROUP BY user_id HAVING MIN(created_at) < ${week} AND MAX(created_at) >= ${week}
    )
    UNION ALL
    SELECT 'month' AS period, COUNT(*) AS value FROM (
      SELECT user_id FROM analytics_events
      GROUP BY user_id HAVING MIN(created_at) < ${month} AND MAX(created_at) >= ${month}
    )
  `);
  const returning = Object.fromEntries(returningRows.map((row) => [row.period, row.value]));

  return res.json({
    users: {
      total: totalUsers[0]?.value ?? 0,
      dau: dau[0]?.value ?? 0,
      wau: wau[0]?.value ?? 0,
      mau: mau[0]?.value ?? 0,
      newToday: newToday[0]?.value ?? 0,
      newWeek: newWeek[0]?.value ?? 0,
      newMonth: newMonth[0]?.value ?? 0,
    },
    usage,
    funnel,
    retention: { returningWeek: returning.week ?? 0, returningMonth: returning.month ?? 0 },
  });
});

export default router;
