/// <reference types="@cloudflare/workers-types" />

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function cacheControlFor(pathname: string): string {
  return pathname.endsWith("/stellar.toml")
    ? "public, max-age=3600, stale-while-revalidate=86400"
    : "public, max-age=300, stale-while-revalidate=3600";
}

interface RequestMetrics {
  method: string;
  pathname: string;
  cacheStatus: "HIT" | "MISS" | "BYPASS";
  statusCode: number;
  latencyMs: number;
  responseBytes: number;
  timestamp: string;
  userAgent: string;
}

function logMetrics(metrics: RequestMetrics): void {
  console.log(
    JSON.stringify({
      level: "info",
      type: "edge_request_metrics",
      ...metrics,
    })
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    const start = Date.now();
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const cache = caches.default;

    const cached = await cache.match(request);
    if (cached) {
      const res = new Response(cached.body, cached);
      res.headers.set("cf-cache-status", "HIT");
      for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);

      logMetrics({
        method: request.method,
        pathname: url.pathname,
        cacheStatus: "HIT",
        statusCode: res.status,
        latencyMs: Date.now() - start,
        responseBytes: Number(res.headers.get("content-length")) || 0,
        timestamp: new Date().toISOString(),
        userAgent: request.headers.get("user-agent") || "",
      });

      return res;
    }

    const origin = await fetch(request);
    if (!origin.ok) {
      logMetrics({
        method: request.method,
        pathname: url.pathname,
        cacheStatus: "BYPASS",
        statusCode: origin.status,
        latencyMs: Date.now() - start,
        responseBytes: Number(origin.headers.get("content-length")) || 0,
        timestamp: new Date().toISOString(),
        userAgent: request.headers.get("user-agent") || "",
      });
      return origin;
    }

    const res = new Response(origin.body, origin);
    res.headers.set("Cache-Control", cacheControlFor(url.pathname));
    res.headers.set("cf-cache-status", "MISS");
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);

    await cache.put(request, res.clone());

    logMetrics({
      method: request.method,
      pathname: url.pathname,
      cacheStatus: "MISS",
      statusCode: res.status,
      latencyMs: Date.now() - start,
      responseBytes: Number(res.headers.get("content-length")) || 0,
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get("user-agent") || "",
    });

    return res;
  },
} satisfies ExportedHandler;
