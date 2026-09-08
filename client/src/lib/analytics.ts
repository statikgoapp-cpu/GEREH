const SESSION_KEY = "gereh_analytics_session_v1";

export const getAnalyticsSessionId = () => {
  const existing = sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  sessionStorage.setItem(SESSION_KEY, id);
  return id;
};

export const trackEvent = (event: string, page?: string, metadata?: Record<string, unknown>) => {
  void fetch("/api/analytics/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    keepalive: true,
    body: JSON.stringify({ event, page, metadata, sessionId: getAnalyticsSessionId() }),
  }).catch(() => undefined);
};