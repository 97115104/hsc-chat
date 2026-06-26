import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = process.env.PUBLIC_DIR ?? path.resolve(__dirname, "../../public");
const port = Number(process.env.PORT ?? 8080);

const app = new Hono();

app.use("*", cors({ origin: "*", allowHeaders: ["*"], allowMethods: ["GET", "POST", "OPTIONS"] }));

app.get("/health", (c) => c.json({ ok: true, service: "hsc-chat" }));

app.all("/proxy/*", async (c) => {
  const baseUrl = c.req.header("X-API-Base-URL")?.trim();
  if (!baseUrl) return c.json({ error: "X-API-Base-URL header is required" }, 400);

  const suffix = c.req.path.replace(/^\/proxy/, "");
  const base = baseUrl.replace(/\/+$/, "");
  // Base URL usually includes /v1; avoid .../v1/v1/... when the proxy path also has /v1
  const path =
    base.endsWith("/v1") && (suffix === "/v1" || suffix.startsWith("/v1/"))
      ? suffix.replace(/^\/v1/, "") || "/"
      : suffix;
  const target = `${base}${path}`;

  const headers = new Headers();
  const auth = c.req.header("Authorization");
  if (auth) headers.set("Authorization", auth);
  const ct = c.req.header("Content-Type");
  if (ct) headers.set("Content-Type", ct);

  const method = c.req.method;
  const body = method === "GET" || method === "HEAD" ? undefined : await c.req.raw.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, { method, headers, body });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Proxy request failed: ${message}` }, 502);
  }

  const outHeaders = new Headers();
  const upstreamType = upstream.headers.get("Content-Type");
  if (upstreamType) outHeaders.set("Content-Type", upstreamType);
  outHeaders.set("Cache-Control", "no-cache");

  const webSearch = upstream.headers.get("x-429-web-search");
  if (webSearch) outHeaders.set("x-429-web-search", webSearch);

  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
});

app.use("/*", serveStatic({ root: publicDir }));

app.get("/", (c) => {
  const html = readFileSync(path.join(publicDir, "index.html"), "utf8");
  return c.html(html);
});

console.log(`[hsc-chat] listening on http://0.0.0.0:${port}`);
serve({ fetch: app.fetch, port });
