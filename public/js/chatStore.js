const ChatStore = (() => {
  const CURRENT_KEY = "hsc_current_chat_id";

  async function request(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function getCurrentChatId() {
    return localStorage.getItem(CURRENT_KEY);
  }

  function setCurrentChatId(id) {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  }

  async function createChat(title) {
    const data = await request("/api/chats", {
      method: "POST",
      body: JSON.stringify(title ? { title } : {}),
    });
    setCurrentChatId(data.id);
    return data;
  }

  async function loadChat(id) {
    return request(`/api/chats/${id}`);
  }

  async function saveMessage(chatId, role, content, refs) {
    return request(`/api/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content, refs: refs?.length ? refs : undefined }),
    });
  }

  async function clearMessages(chatId) {
    return request(`/api/chats/${chatId}/messages`, { method: "DELETE" });
  }

  async function ensureChat() {
    const existingId = getCurrentChatId();
    if (existingId) {
      try {
        const chat = await loadChat(existingId);
        return chat;
      } catch {
        setCurrentChatId(null);
      }
    }
    const chat = await createChat();
    return { ...chat, messages: [] };
  }

  return {
    getCurrentChatId,
    setCurrentChatId,
    createChat,
    loadChat,
    saveMessage,
    clearMessages,
    ensureChat,
  };
})();

window.ChatStore = ChatStore;
