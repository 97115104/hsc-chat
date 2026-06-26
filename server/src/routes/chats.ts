import { Hono } from "hono";
import {
  addMessage,
  clearChatMessages,
  createChat,
  getChat,
  getChatMessages,
  listChats,
  updateChatTitle,
} from "../db.js";

const app = new Hono();

app.get("/chats", async (c) => {
  const chats = await listChats();
  return c.json({
    chats: chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      createdAt: chat.created_at,
      updatedAt: chat.updated_at,
    })),
  });
});

app.post("/chats", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : undefined;
  const chat = await createChat(title || undefined);
  return c.json({
    id: chat.id,
    title: chat.title,
    createdAt: chat.created_at,
    updatedAt: chat.updated_at,
  }, 201);
});

app.get("/chats/:id", async (c) => {
  const id = c.req.param("id");
  const chat = await getChat(id);
  if (!chat) return c.json({ error: "Chat not found" }, 404);

  const messages = await getChatMessages(id);
  return c.json({
    id: chat.id,
    title: chat.title,
    createdAt: chat.created_at,
    updatedAt: chat.updated_at,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      refs: m.refs ?? undefined,
      createdAt: m.created_at,
    })),
  });
});

app.post("/chats/:id/messages", async (c) => {
  const id = c.req.param("id");
  const chat = await getChat(id);
  if (!chat) return c.json({ error: "Chat not found" }, 404);

  const body = await c.req.json();
  const role = body.role;
  const content = typeof body.content === "string" ? body.content : "";
  const refs = Array.isArray(body.refs) ? body.refs : null;

  if (!["user", "assistant", "error"].includes(role)) {
    return c.json({ error: "Invalid role" }, 400);
  }

  const message = await addMessage(id, role, content, refs);

  if (role === "user" && content && !chat.title) {
    const title = content.replace(/\s+/g, " ").trim().slice(0, 80);
    await updateChatTitle(id, title);
  }

  return c.json({
    id: message.id,
    role: message.role,
    content: message.content,
    refs: message.refs ?? undefined,
    createdAt: message.created_at,
  }, 201);
});

app.delete("/chats/:id/messages", async (c) => {
  const id = c.req.param("id");
  const chat = await getChat(id);
  if (!chat) return c.json({ error: "Chat not found" }, 404);
  await clearChatMessages(id);
  return c.json({ ok: true });
});

export const chatRoutes = app;
