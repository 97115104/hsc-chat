import { Hono } from "hono";
import { checkSearch, searchWeb } from "../search.js";

const app = new Hono();

app.get("/search/health", async (c) => {
  const ok = await checkSearch();
  return c.json({ ok });
});

app.get("/search", async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q) return c.json({ error: "Query parameter q is required" }, 400);

  try {
    const data = await searchWeb(q);
    return c.json({ ok: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message, ok: false }, 502);
  }
});

export const searchRoutes = app;
