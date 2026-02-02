import { z } from 'zod';
import { insertPatternSchema, patterns } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  patterns: {
    list: {
      method: 'GET' as const,
      path: '/api/patterns',
      responses: {
        200: z.array(z.custom<typeof patterns.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/patterns',
      input: z.any(), // FormData
      responses: {
        201: z.custom<typeof patterns.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/patterns/:id',
      responses: {
        200: z.custom<typeof patterns.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
