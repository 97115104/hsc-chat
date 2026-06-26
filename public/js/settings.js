const Settings = (() => {
  const STORAGE_KEY = "hsc_chat_settings";

  const HINTS = {
    openrouter: "Get a key at openrouter.ai/keys. Supports hundreds of models.",
    anthropic: "Get a key at console.anthropic.com. Uses Claude models.",
    openai: "Get a key at platform.openai.com. Uses GPT models.",
    google: "Get a key at aistudio.google.com. Uses Gemini models.",
    custom: "Enter any OpenAI-compatible endpoint URL.",
  };

  const DEFAULTS = {
    apiMode: "custom",
    apiKey: "",
    baseUrl: "",
    model: "default",
    voiceApiKey: "",
    voiceBaseUrl: "",
    puterModel: "openai/gpt-oss-20b",
    ollamaUrl: "http://localhost:11434",
    ollamaModel: "gpt-oss:20b",
    systemPrompt: "You are a helpful assistant.",
    saveSettings: true,
    webSearch: false,
  };

  const els = {};

  function cacheElements() {
    els.toggle = document.getElementById("settings-toggle");
    els.panel = document.getElementById("settings-panel");
    els.apiMode = document.getElementById("api-mode");
    els.puterSettings = document.getElementById("puter-settings");
    els.ollamaSettings = document.getElementById("ollama-settings");
    els.keyedSettings = document.getElementById("keyed-settings");
    els.puterModel = document.getElementById("puter-model");
    els.ollamaUrl = document.getElementById("ollama-url");
    els.ollamaModel = document.getElementById("ollama-model");
    els.apiKey = document.getElementById("api-key");
    els.voiceApiKey = document.getElementById("voice-api-key");
    els.voiceBaseUrl = document.getElementById("voice-base-url");
    els.baseUrlGroup = document.getElementById("base-url-group");
    els.baseUrl = document.getElementById("base-url");
    els.modelName = document.getElementById("model-name");
    els.systemPrompt = document.getElementById("system-prompt");
    els.saveKey = document.getElementById("save-key");
    els.providerHint = document.getElementById("provider-hint");
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function save(data) {
    if (data.saveSettings) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function readForm() {
    return {
      apiMode: els.apiMode.value,
      apiKey: els.apiKey.value.trim(),
      baseUrl: els.baseUrl.value.trim(),
      model: els.modelName.value.trim(),
      voiceApiKey: els.voiceApiKey.value.trim(),
      voiceBaseUrl: els.voiceBaseUrl.value.trim(),
      puterModel: els.puterModel.value,
      ollamaUrl: els.ollamaUrl.value.trim(),
      ollamaModel: els.ollamaModel.value.trim(),
      systemPrompt: els.systemPrompt.value,
      saveSettings: els.saveKey.checked,
      webSearch: document.getElementById("web-search")?.checked ?? false,
    };
  }

  function applyToForm(data) {
    els.apiMode.value = data.apiMode;
    els.apiKey.value = data.apiKey;
    els.voiceApiKey.value = data.voiceApiKey || "";
    els.voiceBaseUrl.value = data.voiceBaseUrl || "";
    els.baseUrl.value = data.baseUrl;
    els.modelName.value = data.model;
    els.puterModel.value = data.puterModel;
    els.ollamaUrl.value = data.ollamaUrl;
    els.ollamaModel.value = data.ollamaModel;
    els.systemPrompt.value = data.systemPrompt;
    els.saveKey.checked = data.saveSettings;
    const ws = document.getElementById("web-search");
    if (ws) ws.checked = data.webSearch;
    updateProviderPanels(data.apiMode);
  }

  function updateProviderPanels(mode) {
    els.puterSettings.classList.add("hidden");
    els.ollamaSettings.classList.add("hidden");
    els.keyedSettings.classList.add("hidden");
    els.baseUrlGroup.classList.add("hidden");

    if (mode === "puter") {
      els.puterSettings.classList.remove("hidden");
      els.providerHint.textContent = "Powered by Puter.com — free, no API key needed.";
    } else if (mode === "ollama") {
      els.ollamaSettings.classList.remove("hidden");
      els.providerHint.textContent = "Runs locally — no API key. Use OLLAMA_ORIGINS=* ollama serve for browser access.";
    } else {
      els.keyedSettings.classList.remove("hidden");
      if (mode === "custom") els.baseUrlGroup.classList.remove("hidden");
      els.providerHint.textContent = HINTS[mode] || "";

      const provider = ApiClient.PROVIDERS[mode];
      if (provider && !els.modelName.value) {
        els.modelName.value = provider.defaultModel;
        els.modelName.placeholder = provider.defaultModel;
      }
    }
  }

  function togglePanel() {
    const hidden = els.panel.classList.toggle("hidden");
    els.toggle.innerHTML = hidden ? "&#9654; API Settings" : "&#9660; API Settings";
  }

  function bind(onChange) {
    els.toggle.addEventListener("click", togglePanel);

    const persist = () => {
      const data = readForm();
      if (data.saveSettings) save(data);
      updateProviderPanels(data.apiMode);
      onChange?.(data);
    };

    els.apiMode.addEventListener("change", () => {
      const mode = els.apiMode.value;
      const provider = ApiClient.PROVIDERS[mode];
      if (provider?.defaultModel && mode !== "custom") {
        els.modelName.value = provider.defaultModel;
      }
      if (mode === "custom") {
        els.modelName.value = "default";
      }
      persist();
    });

    for (const el of [
      els.apiKey, els.baseUrl, els.modelName, els.voiceApiKey, els.voiceBaseUrl,
      els.puterModel, els.ollamaUrl, els.ollamaModel, els.systemPrompt, els.saveKey,
    ]) {
      el.addEventListener("input", persist);
      el.addEventListener("change", persist);
    }

    document.getElementById("web-search")?.addEventListener("change", persist);
  }

  function init(onChange) {
    cacheElements();
    const data = load();
    applyToForm(data);
    bind(onChange);
    return data;
  }

  return { init, readForm, load };
})();

window.Settings = Settings;
