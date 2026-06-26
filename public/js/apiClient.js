const ApiClient = (() => {
  const PROVIDERS = {
    puter: { label: "Puter GPT-OSS", defaultModel: "openai/gpt-oss-20b" },
    openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "anthropic/claude-sonnet-4" },
    anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4-5-20250929" },
    openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
    google: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-2.0-flash" },
    ollama: { label: "Ollama (Local)", baseUrl: "http://localhost:11434", defaultModel: "gpt-oss:20b" },
    custom: { label: "Custom Endpoint", baseUrl: "", defaultModel: "default" },
  };

  function usesProxy(apiMode) {
    return apiMode === "custom" || apiMode === "ollama";
  }

  function resolveBase(config) {
    const provider = PROVIDERS[config.apiMode] || PROVIDERS.custom;
    if (config.apiMode === "ollama") {
      return (config.ollamaUrl || provider.baseUrl).replace(/\/+$/, "");
    }
    if (config.apiMode === "custom") {
      return (config.baseUrl || "").replace(/\/+$/, "");
    }
    return (config.baseUrl || provider.baseUrl || "").replace(/\/+$/, "");
  }

  function resolveModel(config) {
    const provider = PROVIDERS[config.apiMode] || PROVIDERS.custom;
    if (config.apiMode === "puter") return config.puterModel || provider.defaultModel;
    if (config.apiMode === "ollama") return config.ollamaModel || provider.defaultModel;
    return config.model || provider.defaultModel;
  }

  async function checkConnection(config) {
    if (config.apiMode === "puter") {
      return typeof puter !== "undefined" && puter.ai ? { ok: true } : { ok: false, error: "Puter SDK not loaded" };
    }

    const base = resolveBase(config);
    const model = resolveModel(config);

    if (config.apiMode === "ollama") {
      try {
        const url = usesProxy(config.apiMode)
          ? `/proxy/api/tags`
          : `${base}/api/tags`;
        const headers = usesProxy(config.apiMode) ? { "X-API-Base-URL": base } : {};
        const r = await fetch(url, { headers });
        if (!r.ok) return { ok: false, error: `Ollama returned HTTP ${r.status}` };
        const data = await r.json();
        const names = (data.models || []).map((m) => m.name);
        const has = names.some((n) => n === model || n.startsWith(model.split(":")[0]));
        if (!has && names.length) {
          return { ok: false, error: `Model "${model}" not found. Installed: ${names.join(", ")}` };
        }
        return { ok: true };
      } catch {
        return { ok: false, error: "Cannot connect to Ollama. Run: OLLAMA_ORIGINS=* ollama serve" };
      }
    }

    if (config.apiMode === "anthropic") {
      if (!config.apiKey) return { ok: false, error: "API key required" };
      return { ok: true };
    }

    if (config.apiMode === "google") {
      if (!config.apiKey) return { ok: false, error: "API key required" };
      return { ok: true };
    }

    if (!base) return { ok: false, error: "Base URL required" };

    try {
      const path = "/models";
      const url = usesProxy(config.apiMode) ? `/proxy/models` : `${base}/models`;
      const headers = { ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) };
      if (usesProxy(config.apiMode)) headers["X-API-Base-URL"] = base;
      if (config.apiMode === "openrouter") {
        headers["HTTP-Referer"] = window.location.origin;
        headers["X-Title"] = "HSC Chat";
      }
      const r = await fetch(url, { headers });
      if (r.status === 401) return { ok: false, error: "Invalid API key" };
      if (!r.ok && r.status !== 404) return { ok: false, error: `HTTP ${r.status}` };
      return { ok: true };
    } catch {
      return { ok: false, error: "Cannot reach endpoint" };
    }
  }

  async function runWebSearch(query, signal, onReferences) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data.error || `Search failed (HTTP ${res.status})`;
        return { used: false, systemExtra: "", searchError: msg };
      }

      if (!data.results?.length) {
        return { used: false, systemExtra: "", searchError: "No search results found" };
      }

      const refs = data.results.map((r) => ({ title: r.title, url: r.url }));
      onReferences?.(refs);

      const block = data.results
        .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content || ""}`.trim())
        .join("\n\n");

      const systemExtra =
        "\n\n---\nWeb search results (use these to inform your answer; cite sources when relevant):\n\n" +
        block;

      return {
        used: true,
        systemExtra,
        searchSourceCount: data.results.length,
        searchCached: !!data.cached,
      };
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      const msg = err instanceof Error ? err.message : "Web search unavailable";
      return { used: false, systemExtra: "", searchError: msg };
    }
  }

  async function streamChat(config, messages, callbacks) {
    const { onDelta, onReferences, signal } = callbacks;
    let usedWebSearch = false;
    let systemExtra = "";
    let searchError = null;
    let searchSourceCount = 0;
    let searchCached = false;

    if (config.webSearch) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (lastUser?.content) {
        const search = await runWebSearch(lastUser.content, signal, onReferences);
        usedWebSearch = search.used;
        systemExtra = search.systemExtra;
        searchError = search.searchError ?? null;
        searchSourceCount = search.searchSourceCount ?? 0;
        searchCached = !!search.searchCached;
      }
    }

    const searchMeta = { usedWebSearch, searchError, searchSourceCount, searchCached };

    const system = (config.systemPrompt || "You are a helpful assistant.") + systemExtra;
    const model = resolveModel(config);

    if (config.apiMode === "puter") {
      const result = await streamPuter(config, system, messages, onDelta, signal);
      return { ...result, ...searchMeta };
    }
    if (config.apiMode === "anthropic") {
      const result = await streamAnthropic(config, system, messages, onDelta, signal);
      return { ...result, ...searchMeta };
    }
    if (config.apiMode === "google") {
      const result = await streamGoogle(config, system, messages, onDelta, signal);
      return { ...result, ...searchMeta };
    }

    const base = resolveBase(config);
    const chatMessages = [
      { role: "system", content: system },
      ...messages.filter((m) => m.role !== "system"),
    ];

    const body = {
      model,
      messages: chatMessages,
      stream: true,
      max_tokens: config.maxTokens || 2048,
    };

    const headers = { "Content-Type": "application/json" };
    let url;

    if (usesProxy(config.apiMode)) {
      url = `/proxy/chat/completions`;
      headers["X-API-Base-URL"] = base;
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    } else if (config.apiMode === "openrouter") {
      url = `${base}/chat/completions`;
      headers.Authorization = `Bearer ${config.apiKey}`;
      headers["HTTP-Referer"] = window.location.origin;
      headers["X-Title"] = "HSC Chat";
    } else {
      url = `${base}/chat/completions`;
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.error?.message || err.error || `HTTP ${res.status}`;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }

    if (!usedWebSearch && res.headers.get("x-429-web-search") === "1") {
      usedWebSearch = true;
    }
    await parseOpenAiSse(res, onDelta, onReferences);
    return searchMeta;
  }

  async function streamPuter(config, system, messages, onDelta, signal) {
    if (typeof puter === "undefined" || !puter.ai) {
      throw new Error("Puter SDK not loaded");
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const model = resolveModel(config);
    const chatMessages = [
      { role: "system", content: system },
      ...messages.filter((m) => m.role !== "system"),
    ];

    const response = await puter.ai.chat(chatMessages, { model, stream: true });
    if (response && typeof response[Symbol.asyncIterator] === "function") {
      for await (const part of response) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const text = part?.text || part?.delta || part?.message?.content || "";
        if (text) onDelta(text);
      }
      return {};
    }

    const content = response?.message?.content || response?.text || String(response || "");
    if (content) onDelta(content);
    return {};
  }

  async function streamAnthropic(config, system, messages, onDelta, signal) {
    const base = resolveBase(config);
    const model = resolveModel(config);
    const res = await fetch(`${base}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: config.maxTokens || 2048,
        system,
        messages: messages.filter((m) => m.role !== "system").map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
        stream: true,
      }),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    await parseAnthropicSse(res, onDelta);
    return {};
  }

  async function streamGoogle(config, system, messages, onDelta, signal) {
    const base = resolveBase(config);
    const model = resolveModel(config);
    const url = `${base}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(config.apiKey)}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
        generationConfig: { maxOutputTokens: config.maxTokens || 2048 },
      }),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    await parseGoogleSse(res, onDelta);
    return {};
  }

  async function parseOpenAiSse(res, onDelta, onReferences) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
          continue;
        }
        if (!line.startsWith("data: ")) {
          currentEvent = null;
          continue;
        }
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") return;

        try {
          const chunk = JSON.parse(payload);
          if (currentEvent === "x-429-references" && onReferences) {
            const refs = chunk.references || chunk.x_429?.references;
            if (refs?.length) onReferences(refs);
            currentEvent = null;
            continue;
          }
          if (!("choices" in chunk)) continue;
          const delta = chunk.choices?.[0]?.delta ?? {};
          const text = delta.content ?? delta.reasoning ?? delta.reasoning_content ?? "";
          if (text) onDelta(text);
        } catch { /* malformed chunk */ }
        currentEvent = null;
      }
    }
  }

  async function parseAnthropicSse(res, onDelta) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        try {
          const chunk = JSON.parse(payload);
          if (chunk.type === "content_block_delta") {
            const text = chunk.delta?.text ?? "";
            if (text) onDelta(text);
          }
        } catch { /* skip */ }
      }
    }
  }

  async function parseGoogleSse(res, onDelta) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        try {
          const chunk = JSON.parse(payload);
          const parts = chunk.candidates?.[0]?.content?.parts ?? [];
          for (const p of parts) {
            if (p.text) onDelta(p.text);
          }
        } catch { /* skip */ }
      }
    }
  }

  function voiceBaseUrl(config) {
    return (config.voiceBaseUrl || "").replace(/\/+$/, "");
  }

  function hasVoiceApi(config) {
    return Boolean(config.voiceApiKey && voiceBaseUrl(config));
  }

  function ttsHeaders(config) {
    const headers = { "Content-Type": "application/json" };
    if (config.voiceApiKey) headers.Authorization = `Bearer ${config.voiceApiKey}`;
    const base = voiceBaseUrl(config);
    if (base) headers["X-API-Base-URL"] = base;
    return headers;
  }

  function voiceProxyUrl(config, path) {
    if (!voiceBaseUrl(config)) return null;
    return `/proxy${path}`;
  }

  function normalizeVoiceItem(v) {
    const id = v.id || v.voice_id || v.name;
    const name = v.name || v.id || id;
    return {
      name,
      voiceId: id,
      source: v.source === "preset" ? "preset" : "api",
    };
  }

  async function checkTtsHealth(config) {
    if (!config.voiceApiKey || !voiceBaseUrl(config)) return { available: false };
    const urls = [voiceProxyUrl(config, "/voices"), voiceProxyUrl(config, "/models")];
    for (const url of urls) {
      if (!url) continue;
      try {
        const res = await fetch(url, { headers: ttsHeaders(config) });
        if (res.ok) return { available: true };
      } catch { /* try next */ }
    }
    return { available: false };
  }

  async function listTtsVoices(config) {
    if (!config.voiceApiKey || !voiceBaseUrl(config)) return [];
    const urls = [voiceProxyUrl(config, "/voices"), voiceProxyUrl(config, "/models")];
    for (const url of urls) {
      if (!url) continue;
      try {
        const res = await fetch(url, { headers: ttsHeaders(config) });
        if (!res.ok) continue;
        const data = await res.json();
        const items = data.data || data.voices || [];
        if (!items.length) continue;
        const seen = new Set();
        return items
          .map(normalizeVoiceItem)
          .filter((v) => {
            if (!v.voiceId || seen.has(v.voiceId)) return false;
            seen.add(v.voiceId);
            return true;
          });
      } catch { /* try next */ }
    }
    return [];
  }

  async function uploadTtsVoice(config, name, voiceDataUrl) {
    const url = voiceProxyUrl(config, "/voices");
    if (!url || !config.voiceApiKey) return null;
    const res = await fetch(url, {
      method: "POST",
      headers: ttsHeaders(config),
      body: JSON.stringify({ name, voice: voiceDataUrl }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || err.error || err.detail || `Upload failed (${res.status})`);
    }
    const data = await res.json();
    const voiceId = data.id || data.voice_id || data.name || name;
    return { name: data.name || name, voiceId, source: "api" };
  }

  async function streamTtsApi(config, body, signal) {
    const url = voiceProxyUrl(config, "/audio/speech");
    if (!url) throw new Error("Voice API URL not configured");
    return fetch(url, {
      method: "POST",
      headers: ttsHeaders(config),
      body: JSON.stringify(body),
      signal,
    });
  }

  return {
    PROVIDERS,
    resolveBase,
    resolveModel,
    usesProxy,
    checkConnection,
    streamChat,
    checkTtsHealth,
    listTtsVoices,
    uploadTtsVoice,
    streamTtsApi,
    voiceProxyUrl,
    hasVoiceApi,
    voiceBaseUrl,
  };
})();

window.ApiClient = ApiClient;
