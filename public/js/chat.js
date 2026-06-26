const Chat = (() => {
  const history = [];
  let streaming = false;
  let abortCtrl = null;
  let activeBodyEl = null;
  let currentChatId = null;
  let _getConfig = () => ({});
  let _historyChats = [];

  const els = {};

  function cacheElements() {
    els.messages = document.getElementById("messages");
    els.status = document.getElementById("status");
    els.form = document.getElementById("chat-form");
    els.prompt = document.getElementById("prompt");
    els.sendBtn = document.getElementById("send-btn");
    els.stopBtn = document.getElementById("stop-btn");
    els.clearBtn = document.getElementById("clear-btn");
    els.newChatBtn = document.getElementById("new-chat-btn");
    els.historyBtn = document.getElementById("history-btn");
    els.conn = document.getElementById("conn-status");
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function setConn(ok, label) {
    els.conn.className = `conn-dot ${ok === true ? "ok" : ok === false ? "err" : ""}`;
    els.conn.querySelector(".label").textContent = label;
  }

  function scrollBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function renderEmpty() {
    if (history.length) return;
    els.messages.innerHTML = `
      <div class="empty-state">
        <div class="icon">◈</div>
        <div>Start a conversation</div>
        <div style="font-size:12px;margin-top:8px;color:#444">Configure API Settings above, then send a message</div>
      </div>`;
  }

  function addMessage(role, text, refs, config) {
    const empty = els.messages.querySelector(".empty-state");
    if (empty) empty.remove();

    const wrap = document.createElement("div");
    wrap.className = `msg ${role}`;
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = role;
    const body = document.createElement("div");
    body.className = "body";
    if (role === "assistant") {
      Markdown.setBody(body, text);
    } else {
      body.textContent = text;
    }
    wrap.append(label, body);

    if (refs?.length) {
      const list = document.createElement("div");
      list.className = "refs";
      refs.forEach((r, i) => {
        const a = document.createElement("a");
        a.href = r.url;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.textContent = `[${i + 1}] ${r.title || r.url}`;
        list.appendChild(a);
      });
      wrap.appendChild(list);
    }

    els.messages.appendChild(wrap);
    scrollBottom();
    if (role === "assistant" && text) {
      wrap.dataset.text = text;
      Voice.attachSpeakButton(wrap, text);
    }
    return body;
  }

  async function persistMessage(role, content, refs) {
    if (!currentChatId) return;
    try {
      await ChatStore.saveMessage(currentChatId, role, content, refs);
    } catch (err) {
      console.error("Failed to save message:", err);
      setStatus("save error");
    }
  }

  function setStreamingUi(active) {
    streaming = active;
    els.prompt.disabled = active;
    els.sendBtn.classList.toggle("hidden", active);
    els.stopBtn.classList.toggle("hidden", !active);
  }

  function appendCursor(body) {
    const cursor = document.createElement("span");
    cursor.className = "stream-cursor";
    cursor.textContent = "▋";
    body.appendChild(cursor);
    return cursor;
  }

  async function checkConn(config) {
    if (config.apiMode === "puter") {
      setConn(typeof puter !== "undefined", typeof puter !== "undefined" ? "puter ready" : "puter unavailable");
      return;
    }
    if (config.apiMode !== "custom" && config.apiMode !== "ollama" && !config.apiKey) {
      setConn(null, "no key");
      return;
    }
    setConn(null, "checking…");
    const r = await ApiClient.checkConnection(config);
    setConn(r.ok, r.ok ? "connected" : (r.error || "error").slice(0, 40));
  }

  async function send(config) {
    const text = els.prompt.value.trim();
    if (!text || streaming) return;

    if (config.apiMode !== "puter" && config.apiMode !== "ollama" && !config.apiKey) {
      addMessage("error", "Set an API key in API Settings.");
      setStatus("error");
      return;
    }
    if (config.apiMode === "custom" && !config.baseUrl) {
      addMessage("error", "Set a Base URL in API Settings.");
      setStatus("error");
      return;
    }

    els.prompt.value = "";
    history.push({ role: "user", content: text });
    addMessage("user", text, null, config);
    await persistMessage("user", text);

    const assistantBody = addMessage("assistant", "", null, config);
    const assistantWrap = assistantBody.closest(".msg");
    activeBodyEl = assistantBody;
    const cursor = appendCursor(assistantBody);

    setStreamingUi(true);
    setStatus("running");
    abortCtrl = new AbortController();

    let answer = "";
    let refs = [];

    try {
      if (document.getElementById("web-search")?.checked) setStatus("searching…");
      const result = await ApiClient.streamChat(
        { ...config, webSearch: document.getElementById("web-search")?.checked },
        history,
        {
          signal: abortCtrl.signal,
          onDelta(delta) {
            if (cursor.parentNode) cursor.remove();
            answer += delta;
            Markdown.setBody(assistantBody, answer, { streaming: true });
            appendCursor(assistantBody);
            scrollBottom();
          },
          onReferences(r) {
            refs = r;
          },
        },
      );

      if (cursor.parentNode) cursor.remove();
      Markdown.setBody(assistantBody, answer);
      history.push({ role: "assistant", content: answer });
      if (assistantWrap) {
        assistantWrap.dataset.text = answer;
        if (!assistantWrap.querySelector(".speak-btn")) {
          Voice.attachSpeakButton(assistantWrap, answer);
        }
      }
      await persistMessage("assistant", answer, refs);

      if (refs.length) {
        const wrap = assistantBody.closest(".msg");
        const list = document.createElement("div");
        list.className = "refs";
        refs.forEach((r, i) => {
          const a = document.createElement("a");
          a.href = r.url;
          a.target = "_blank";
          a.rel = "noreferrer";
          a.textContent = `[${i + 1}] ${r.title || r.url}`;
          list.appendChild(a);
        });
        wrap.appendChild(list);
      }

      setStatus(result?.usedWebSearch ? "search used" : "done");

      if (Voice.isVoiceEnabled() && assistantWrap && answer) {
        Voice.speakMessage(assistantWrap);
      }
    } catch (err) {
      if (cursor.parentNode) cursor.remove();
      if (err.name === "AbortError") {
        if (answer) {
          history.push({ role: "assistant", content: answer });
          await persistMessage("assistant", answer, refs);
        }
        Markdown.setBody(assistantBody, answer || "(stopped)");
        setStatus("idle");
      } else {
        assistantBody.closest(".msg")?.remove();
        const errText = err.message || String(err);
        addMessage("error", errText);
        await persistMessage("error", errText);
        setStatus("error");
      }
    } finally {
      activeBodyEl = null;
      abortCtrl = null;
      setStreamingUi(false);
      scrollBottom();
    }
  }

  function stop() {
    abortCtrl?.abort();
  }

  async function newChat() {
    if (streaming) stop();
    Voice.stopSpeaking();
    try {
      const chat = await ChatStore.createChat();
      currentChatId = chat.id;
      history.length = 0;
      els.messages.innerHTML = "";
      renderEmpty();
      setStatus("idle");
      els.prompt.focus();
    } catch (err) {
      setStatus("error");
      addMessage("error", `Could not start new chat: ${err.message}`);
    }
  }

  async function clear() {
    if (streaming) stop();
    Voice.stopSpeaking();
    history.length = 0;
    els.messages.innerHTML = "";
    renderEmpty();
    setStatus("idle");
    if (currentChatId) {
      try {
        await ChatStore.clearMessages(currentChatId);
      } catch (err) {
        console.error("Failed to clear messages:", err);
      }
    }
  }

  function formatHistoryDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }

  function displayChat(chat, getConfig) {
    currentChatId = chat.id;
    ChatStore.setCurrentChatId(chat.id);
    history.length = 0;
    els.messages.innerHTML = "";

    for (const m of chat.messages || []) {
      if (m.role === "user" || m.role === "assistant") {
        history.push({ role: m.role, content: m.content });
      }
      addMessage(m.role, m.content, m.refs, getConfig());
    }

    if (!chat.messages?.length) renderEmpty();
    scrollBottom();
  }

  function renderHistoryList(filter = "") {
    const list = document.getElementById("history-list");
    if (!list) return;

    const q = filter.trim().toLowerCase();
    const chats = q
      ? _historyChats.filter((c) => {
          const title = (c.title || "untitled chat").toLowerCase();
          return title.includes(q) || c.id.toLowerCase().includes(q);
        })
      : _historyChats;

    list.innerHTML = "";
    if (!chats.length) {
      list.innerHTML = '<p class="history-empty">No saved chats yet.</p>';
      return;
    }

    chats.forEach((chat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "history-item" + (chat.id === currentChatId ? " active" : "");
      const title = document.createElement("span");
      title.className = "history-item-title";
      title.textContent = chat.title?.trim() || "Untitled chat";
      const meta = document.createElement("span");
      meta.className = "history-item-meta";
      const count = chat.messageCount ?? 0;
      meta.textContent = `${count} message${count === 1 ? "" : "s"} · ${formatHistoryDate(chat.updatedAt)}`;
      btn.append(title, meta);
      btn.onclick = () => switchToChat(chat.id);
      list.appendChild(btn);
    });
  }

  async function openHistory() {
    const modal = document.getElementById("history-modal");
    const search = document.getElementById("history-search");
    if (!modal) return;

    try {
      const data = await ChatStore.listChats();
      _historyChats = data.chats || [];
      if (search) search.value = "";
      renderHistoryList();
      modal.classList.add("open");
      search?.focus();
    } catch (err) {
      setStatus("error");
      addMessage("error", `Could not load history: ${err.message}`);
    }
  }

  function closeHistory() {
    document.getElementById("history-modal")?.classList.remove("open");
  }

  async function switchToChat(id) {
    if (!id || id === currentChatId) {
      closeHistory();
      return;
    }
    if (streaming) stop();
    Voice.stopSpeaking();

    try {
      const chat = await ChatStore.loadChat(id);
      displayChat(chat, _getConfig);
      setStatus("idle");
      closeHistory();
      els.prompt.focus();
    } catch (err) {
      setStatus("error");
      addMessage("error", `Could not load chat: ${err.message}`);
    }
  }

  async function loadCurrentChat(getConfig) {
    try {
      const chat = await ChatStore.ensureChat();
      displayChat(chat, getConfig);
    } catch (err) {
      renderEmpty();
      setStatus("db error");
      addMessage("error", `Chat history unavailable: ${err.message}`);
    }
  }

  function bind(getConfig) {
    els.form.addEventListener("submit", (e) => {
      e.preventDefault();
      send(getConfig());
    });

    els.prompt.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send(getConfig());
      }
    });

    els.stopBtn.addEventListener("click", stop);
    els.clearBtn.addEventListener("click", clear);
    els.newChatBtn?.addEventListener("click", newChat);
    els.historyBtn?.addEventListener("click", openHistory);

    document.getElementById("history-modal-close")?.addEventListener("click", closeHistory);
    document.getElementById("history-modal")?.addEventListener("click", (e) => {
      if (e.target?.id === "history-modal") closeHistory();
    });
    document.getElementById("history-search")?.addEventListener("input", (e) => {
      renderHistoryList(e.target.value);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeHistory();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newChat();
      }
    });
  }

  async function init(getConfig, initialConfig) {
    _getConfig = getConfig || (() => ({}));
    cacheElements();
    bind(getConfig);
    await loadCurrentChat(getConfig);
    checkConn(initialConfig);
  }

  return { init, checkConn, newChat, openHistory };
})();

window.Chat = Chat;
