import { z } from "zod";

export const PatternSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  imageUrl: z.string(),
  svgUrl: z.string().nullable().optional(),
  dxfUrl: z.string().nullable().optional(),
  category: z.string().optional(),
  sizeCode: z.string().nullable().optional(),
  realDiameterMm: z.number().nullable().optional(),
  vectorDiameterMm: z.number().nullable().optional(),
  holeDiameterMm: z.number().nullable().optional(),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  archived: z.boolean().optional(),
  createdAt: z.string(),
});

export type Pattern = z.infer<typeof PatternSchema>;

export const api = {
  patterns: {
    list: {
      path: "/api/patterns" as const,
      method: "GET" as const,
      responses: {
        200: z.array(PatternSchema),
      },
    },
    get: {
      path: "/api/patterns/:id" as const,
      method: "GET" as const,
      responses: {
        200: PatternSchema,
        404: z.object({ message: z.string() }),
      },
    },
    create: {
      path: "/api/patterns" as const,
      method: "POST" as const,
      responses: {
        201: PatternSchema,
        400: z.object({ message: z.string() }),
      },
    },
    delete: {
      path: "/api/patterns/:id" as const,
      method: "DELETE" as const,
      responses: {
        200: z.object({ success: z.literal(true) }),
        404: z.object({ message: z.string() }),
      },
    },
    archive: {
      path: "/api/patterns/:id/archive" as const,
      method: "PATCH" as const,
      body: z.object({ archived: z.boolean() }),
      responses: {
        200: PatternSchema,
        404: z.object({ message: z.string() }),
      },
    },
  },
};

export const buildUrl = (path: string, params: Record<string, string | number>) => {
  let url = path;
  Object.entries(params).forEach(([key, value]) => {
    url = url.replace(`:${key}`, String(value));
  });
  return url;
};
