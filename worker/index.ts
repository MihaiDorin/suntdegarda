import { GET, POST } from "./api";
import { ensureSchema } from "./schema";
import { closeExpiredEnrollments, flushPush } from "./push";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AUTH_SECRET: string;
  BOOTSTRAP_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/garda") {
      if (request.method !== "GET" && request.method !== "POST") {
        return Response.json(
          { error: "Metodă nepermisă." },
          { status: 405, headers: { Allow: "GET, POST", "Cache-Control": "no-store" } },
        );
      }
      try {
        await ensureSchema();
        const response = await (request.method === "GET" ? GET(request) : POST(request));
        if (request.method === "POST" && response.ok) ctx.waitUntil(flushPush().catch(() => console.error("Push delivery will be retried.")));
        return response;
      } catch (error) {
        console.error("Database initialization failed", error);
        return Response.json(
          { error: "Aplicația nu este încă disponibilă. Contactează administratorul." },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    if (pathname.startsWith("/api/")) {
      return Response.json({ error: "Adresă inexistentă." }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller: ScheduledController, _env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => { await ensureSchema(); await closeExpiredEnrollments(); await flushPush(); })());
  },
} satisfies ExportedHandler<Env>;
