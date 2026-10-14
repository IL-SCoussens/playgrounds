import { file, serve } from "bun";
import { createQuoteCache } from "./quotes";

const page = file(`${import.meta.dir}/index.html`);

export function createHandler(cache = createQuoteCache()) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const headers = { "Cache-Control": "no-store" };
    if (path !== "/" && path !== "/api/quotes" && path !== "/healthz") {
      return new Response("Not found", { status: 404, headers });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { ...headers, Allow: "GET, HEAD" },
      });
    }
    if (path === "/healthz") {
      const health = cache.getHealth();
      return new Response(request.method === "HEAD" ? null : JSON.stringify(health), {
        status: health.ok ? 200 : 503,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    if (path === "/api/quotes") {
      if (request.method === "HEAD") {
        return new Response(null, {
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }
      return Response.json({ quotes: await cache.getQuotes() }, { headers });
    }
    if (!(await page.exists())) {
      return new Response("Page not found", { status: 404, headers });
    }
    return new Response(request.method === "HEAD" ? null : page, {
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    });
  };
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  serve({ port, fetch: createHandler() });
}
