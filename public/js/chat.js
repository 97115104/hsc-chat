const Chat = (() => {
  const history = [];
  let streaming = false;
  let abortCtrl = null;
  let activeBodyEl = null;

  const els = {};

  function cacheElements() {
    els.messages = document.getElementById("messages");
    els.status = document.getElementById("status");
    els.form = document.getElementById("chat-form");
    els.prompt = document.getElementById("prompt");
    els.sendBtn = document.getElementById("send-btn");
    els.stopBtn = document.getElementById("stop-btn");
    els.clearBtn = document.getElementById("clear-btn");
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
      Voice.attachSpeakButton(wrap, text);
    }
    return body;
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
        if (answer) history.push({ role: "assistant", content: answer });
        Markdown.setBody(assistantBody, answer || "(stopped)");
        setStatus("idle");
      } else {
        assistantBody.closest(".msg")?.remove();
        addMessage("error", err.message || String(err));
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

  function clear() {
    if (streaming) stop();
    Voice.stopSpeaking();
    history.length = 0;
    els.messages.innerHTML = "";
    renderEmpty();
    setStatus("idle");
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
  }

  function init(getConfig, initialConfig) {
    cacheElements();
    renderEmpty();
    bind(getConfig);
    checkConn(initialConfig);
  }

  return { init, checkConn };
})();

window.Chat = Chat;
