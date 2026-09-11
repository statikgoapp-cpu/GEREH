import { db } from "./db";
import { analyticsEvents } from "@shared/schema";

export const ANALYTICS_EVENTS = [
  "REGISTER", "LOGIN", "LOGOUT", "APP_OPEN", "PAGE_VIEW",
  "WHATSAPP_CLICK",
  "PATTERN_UPLOAD", "PATTERN_PROCESS_START", "PATTERN_PROCESS_COMPLETE", "PATTERN_PROCESS_ERROR",
  "SVG_EXPORT", "DXF_EXPORT", "PDF_EXPORT", "PDF_DOWNLOAD", "FEEDBACK_SUBMIT",
  "MACHINE_PAGE_VIEW", "MACHINE_CONNECT", "MACHINE_START", "MACHINE_STOP",
] as const;

const eventSet = new Set<string>(ANALYTICS_EVENTS);
const metadataKeys = new Set(["format", "fileType", "page", "source"]);

export async function trackEvent(input: {
  userId: number;
  event: string;
  page?: string | null;
  sessionId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    if (!Number.isInteger(input.userId) || input.userId <= 0 || !eventSet.has(input.event)) return;
    const safeMetadata = input.metadata
      ? Object.fromEntries(
          Object.entries(input.metadata)
            .filter(([key, value]) => metadataKeys.has(key) && ["string", "number", "boolean"].includes(typeof value))
            .map(([key, value]) => [key, String(value).slice(0, 100)]),
        )
      : null;
    const metadata = safeMetadata && Object.keys(safeMetadata).length > 0 ? JSON.stringify(safeMetadata) : null;
    await db.insert(analyticsEvents).values({
      userId: input.userId,
      event: input.event,
      page: input.page ? input.page.slice(0, 200) : null,
      sessionId: input.sessionId ? input.sessionId.slice(0, 128) : null,
      metadata,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Analytics event failed", error instanceof Error ? error.message : String(error));
  }
}