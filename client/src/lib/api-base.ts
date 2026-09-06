export const getApiBase = () => {
  if (typeof window === "undefined") return "";
  const runtimeOverride = (window as any).__NP_API_BASE;
  if (typeof runtimeOverride === "string" && runtimeOverride.trim().length > 0) {
    return runtimeOverride.trim().replace(/\/+$/, "");
  }

  const envBase = (import.meta as any)?.env?.VITE_API_BASE;
  if (typeof envBase === "string" && envBase.trim().length > 0) {
    return envBase.trim().replace(/\/+$/, "");
  }

  if (window.location.protocol === "file:") {
    return "http://127.0.0.1:8100";
  }

  const isCapacitor = Boolean((window as any).Capacitor);
  if (isCapacitor && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    return "http://127.0.0.1:8100";
  }

  return "";
};

export const withApiBase = (path: string) => {
  const base = getApiBase();
  if (!base) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
};

let fetchPatched = false;

export const initApiBaseFetch = () => {
  if (typeof window === "undefined") return;
  if (fetchPatched) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const base = getApiBase();
    const requestUrl = new URL(
      typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(),
      window.location.origin,
    );
    const token = localStorage.getItem("token");
    let requestInit = init;

    if (token && requestUrl.origin === window.location.origin && requestUrl.pathname.startsWith("/api")) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      requestInit = { ...init, headers };
    }

    if (!base) return originalFetch(input as any, requestInit);

    if (typeof input === "string") {
      if (input.startsWith("/") || input.startsWith("./") || input.startsWith("../")) {
        return originalFetch(withApiBase(input), requestInit);
      }
      return originalFetch(input, requestInit);
    }

    if (input instanceof URL) {
      return originalFetch(input, requestInit);
    }

    if (input instanceof Request) {
      return originalFetch(input, requestInit);
    }

    return originalFetch(input as any, requestInit);
  }) as typeof window.fetch;

  fetchPatched = true;
};
