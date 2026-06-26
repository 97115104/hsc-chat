import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ?? "postgres://hsc:hsc@localhost:5432/hsc_chat";

export const pool = new Pool({ connectionString });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'error')),
  content TEXT NOT NULL DEFAULT '',
  refs JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, created_at);
`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function initDb(maxRetries = 30, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      try {
        await client.query(SCHEMA);
      } finally {
        client.release();
      }
      console.log("[hsc-chat] database ready");
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === maxRetries) {
        throw new Error(`Database unavailable after ${maxRetries} attempts: ${message}`);
      }
      console.log(`[hsc-chat] waiting for database (${attempt}/${maxRetries})…`);
      await sleep(delayMs);
    }
  }
}

export async function checkDb() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export type ChatRow = {
  id: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
};

export type MessageRow = {
  id: string;
  chat_id: string;
  role: "user" | "assistant" | "error";
  content: string;
  refs: unknown[] | null;
  created_at: Date;
};

export type ChatListRow = ChatRow & {
  message_count: number;
};

export async function listChats(limit = 100) {
  const { rows } = await pool.query<ChatListRow>(
    `SELECT c.id, c.title, c.created_at, c.updated_at,
            COUNT(m.id)::int AS message_count
     FROM chats c
     LEFT JOIN messages m ON m.chat_id = c.id
     GROUP BY c.id
     ORDER BY c.updated_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function createChat(title?: string) {
  const { rows } = await pool.query<ChatRow>(
    `INSERT INTO chats (title) VALUES ($1)
     RETURNING id, title, created_at, updated_at`,
    [title ?? null],
  );
  return rows[0];
}

export async function getChat(id: string) {
  const { rows } = await pool.query<ChatRow>(
    `SELECT id, title, created_at, updated_at FROM chats WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getChatMessages(chatId: string) {
  const { rows } = await pool.query<MessageRow>(
    `SELECT id, chat_id, role, content, refs, created_at
     FROM messages
     WHERE chat_id = $1
     ORDER BY created_at ASC`,
    [chatId],
  );
  return rows;
}

export async function addMessage(
  chatId: string,
  role: MessageRow["role"],
  content: string,
  refs?: unknown[] | null,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<MessageRow>(
      `INSERT INTO messages (chat_id, role, content, refs)
       VALUES ($1, $2, $3, $4)
       RETURNING id, chat_id, role, content, refs, created_at`,
      [chatId, role, content, refs ? JSON.stringify(refs) : null],
    );
    await client.query(
      `UPDATE chats SET updated_at = NOW() WHERE id = $1`,
      [chatId],
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function clearChatMessages(chatId: string) {
  await pool.query(`DELETE FROM messages WHERE chat_id = $1`, [chatId]);
  await pool.query(`UPDATE chats SET updated_at = NOW() WHERE id = $1`, [chatId]);
}

export async function updateChatTitle(chatId: string, title: string) {
  const { rows } = await pool.query<ChatRow>(
    `UPDATE chats SET title = $2, updated_at = NOW()
     WHERE id = $1 AND (title IS NULL OR title = '')
     RETURNING id, title, created_at, updated_at`,
    [chatId, title],
  );
  return rows[0] ?? null;
}
