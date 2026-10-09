import { GET, POST } from "./api";
import { ensureSchema } from "./schema";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AUTH_SECRET: string;
  BOOTSTRAP_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
        return request.method === "GET" ? GET(request) : POST(request);
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
} satisfies ExportedHandler<Env>;
