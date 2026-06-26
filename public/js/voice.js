const Voice = (() => {
  const VOICE_MAX_BYTES = 10 * 1024 * 1024;
  const SELECTION_KEY = "hsc_voice_selection";

  let _getConfig = () => ({});
  let _voices = [];
  let _selected = null;
  let ttsMode = "none"; // "api" | "system" | "none"
  let ttsAvailable = false;
  let ttsLoading = false;
  let speakingMsgEl = null;
  let systemUtterance = null;
  let ttsAbortController = null;
  let ttsAudioSources = [];
  let _ttsAudioCtx = null;
  let _recMediaStream = null;
  let _recRecorder = null;
  let _recChunks = [];
  let _recTimerInterval = null;
  let _recSeconds = 0;

  function isVoiceEnabled() {
    return localStorage.getItem("hsc_voice_enabled") === "true";
  }

  function setVoiceEnabled(on) {
    localStorage.setItem("hsc_voice_enabled", on ? "true" : "false");
    const cfgBox = document.getElementById("cfg-voice");
    const toolbar = document.getElementById("speak-auto-toggle");
    if (cfgBox) cfgBox.checked = on;
    if (toolbar) toolbar.checked = on;
    updateSpeakVisibility();
  }

  function _loadSelection() {
    try {
      const raw = localStorage.getItem(SELECTION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function _saveSelection(sel) {
    _selected = sel;
    if (sel) localStorage.setItem(SELECTION_KEY, JSON.stringify(sel));
    else localStorage.removeItem(SELECTION_KEY);
    updateVoiceStatus();
    renderVoicePills();
  }

  function _blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function updateVoiceStatus() {
    const el = document.getElementById("cfg-voice-status");
    if (!el) return;
    if (ttsLoading) {
      el.textContent = "checking voice…";
      return;
    }
    if (!ttsAvailable && !ttsLoading) {
      const config = _getConfig();
      if (ApiClient.hasVoiceApi(config)) {
        el.textContent = "voice API unavailable — check voice key and base URL";
      } else {
        el.textContent = "voice unavailable in this browser";
      }
      return;
    }
    if (ttsMode === "system") {
      el.textContent = "voice: system default (no voice API key)";
      return;
    }
    if (_selected?.name) {
      el.textContent = `voice: ${_selected.name}`;
    } else {
      el.textContent = "none — choose a voice";
    }
  }

  function updateSpeakVisibility() {
    const ready = ttsAvailable;
    const speakOn = isVoiceEnabled();
    document.querySelectorAll(".voice-api-only").forEach((el) => {
      el.classList.toggle("hidden", ttsMode !== "api");
    });
    document.querySelectorAll(".voice-system-only").forEach((el) => {
      el.classList.toggle("hidden", ttsMode !== "system" || !speakOn);
    });
    document.querySelectorAll(".voice-unavailable").forEach((el) => {
      el.classList.toggle("hidden", ready || ttsLoading);
    });
    const showSpeak = ready && speakOn;
    document.getElementById("speak-auto-label")?.classList.toggle("hidden", !showSpeak);
    document.querySelectorAll(".speak-btn").forEach((btn) => {
      btn.style.display = showSpeak ? "" : "none";
    });
    updateVoiceStatus();
  }

  async function checkTTS() {
    const config = _getConfig();
    ttsLoading = true;
    updateSpeakVisibility();

    if (ApiClient.hasVoiceApi(config)) {
      const health = await ApiClient.checkTtsHealth(config);
      if (health.available) {
        ttsMode = "api";
        ttsAvailable = true;
        ttsLoading = false;
        _selected = _loadSelection();
        updateSpeakVisibility();
        await refreshVoices();
        return;
      }
      ttsMode = "none";
      ttsAvailable = false;
      ttsLoading = false;
      updateSpeakVisibility();
      return;
    }

    if ("speechSynthesis" in window) {
      ttsMode = "system";
      ttsAvailable = true;
      ttsLoading = false;
      _selected = { name: "system", source: "system" };
      updateSpeakVisibility();
      return;
    }

    ttsMode = "none";
    ttsAvailable = false;
    ttsLoading = false;
    updateSpeakVisibility();
  }

  async function refreshVoices() {
    if (ttsMode !== "api") return;
    const config = _getConfig();
    const apiVoices = await ApiClient.listTtsVoices(config);
    _voices = apiVoices.map((v) => ({ ...v, source: "api" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const saved = _loadSelection();
    if (saved?.voiceId && _voices.some((v) => v.voiceId === saved.voiceId)) {
      _selected = _voices.find((v) => v.voiceId === saved.voiceId) || saved;
    } else if (saved?.name && _voices.some((v) => v.name === saved.name)) {
      _selected = _voices.find((v) => v.name === saved.name) || saved;
    } else if (_voices.length && !_selected?.voiceId) {
      const first = _voices[0];
      _saveSelection({ name: first.name, voiceId: first.voiceId, source: "api" });
    }

    renderVoiceGrid();
    renderVoicePills();
    updateVoiceStatus();
  }

  function renderVoicePills() {
    const row = document.getElementById("voice-quick-pills");
    if (!row) return;
    row.innerHTML = "";
    if (ttsMode !== "api" || !_selected?.name) return;

    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "voice-pill active";
    pill.textContent = _selected.name;
    pill.onclick = openVoiceModal;
    row.appendChild(pill);
  }

  function renderVoiceGrid(filter = "") {
    const grid = document.getElementById("voice-grid");
    if (!grid) return;
    const q = filter.trim().toLowerCase();
    const list = q ? _voices.filter((v) => v.name.toLowerCase().includes(q)) : _voices;

    grid.innerHTML = "";
    if (!list.length) {
      grid.innerHTML = '<p class="voice-grid-empty">No saved voices yet. Upload or record one.</p>';
      return;
    }

    list.forEach((v) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "voice-grid-item" + (_selected?.voiceId === v.voiceId ? " active" : "");
      btn.innerHTML = `<span class="voice-grid-name">${v.name}</span>`;
      btn.onclick = () => selectVoice(v);
      grid.appendChild(btn);
    });

    const title = document.getElementById("voice-modal-title");
    if (title) title.textContent = `Voices (${_voices.length})`;
  }

  function selectVoice(v) {
    _saveSelection({ name: v.name, voiceId: v.voiceId, source: "api" });
    closeVoiceModal();
  }

  function openVoiceModal() {
    if (ttsMode !== "api") return;
    setModalTab("browse");
    const search = document.getElementById("voice-search");
    if (search) search.value = "";
    renderVoiceGrid();
    document.getElementById("voice-modal")?.classList.add("open");
  }

  function closeVoiceModal() {
    document.getElementById("voice-modal")?.classList.remove("open");
    stopVoiceRecord();
  }

  function setModalTab(tab) {
    document.querySelectorAll(".voice-modal-tab").forEach((el) => {
      el.classList.toggle("active", el.dataset.tab === tab);
    });
    document.querySelectorAll(".voice-modal-panel").forEach((el) => {
      el.classList.toggle("hidden", el.dataset.panel !== tab);
    });
  }

  function clearVoice() {
    if (ttsMode === "system") return;
    _saveSelection(null);
  }

  async function saveUploadedVoice(name, dataUrl) {
    const config = _getConfig();
    if (ttsMode !== "api") {
      throw new Error("Voice API key and base URL required to save cloned voices");
    }
    const apiResult = await ApiClient.uploadTtsVoice(config, name, dataUrl);
    await refreshVoices();
    _saveSelection({ name: apiResult.name, voiceId: apiResult.voiceId, source: "api" });
    return apiResult.name;
  }

  async function loadVoiceRef(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const status = document.getElementById("voice-upload-status");
    if (file.size > VOICE_MAX_BYTES) {
      if (status) status.textContent = "file too large — max 10 MB";
      return;
    }
    const nameInput = document.getElementById("upload-voice-name");
    let name = nameInput?.value.trim() || file.name.replace(/\.[^.]+$/, "");
    if (!name) {
      if (status) status.textContent = "enter a voice name";
      return;
    }
    if (status) status.textContent = "uploading to API…";
    try {
      const dataUrl = await _blobToDataUrl(file);
      name = await saveUploadedVoice(name, dataUrl);
      if (status) status.textContent = `saved "${name}"`;
      if (nameInput) nameInput.value = "";
      setModalTab("browse");
    } catch (err) {
      if (status) status.textContent = err.message || String(err);
    }
    event.target.value = "";
  }

  async function startVoiceRecord() {
    const name = document.getElementById("rec-voice-name")?.value.trim();
    const status = document.getElementById("rec-status");
    if (!name) {
      if (status) status.textContent = "enter a name for this voice first";
      return;
    }
    try {
      _recMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (status) status.textContent = "microphone access denied: " + err.message;
      return;
    }
    _recChunks = [];
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
      .find((t) => MediaRecorder.isTypeSupported(t)) || "";
    _recRecorder = new MediaRecorder(_recMediaStream, mimeType ? { mimeType } : undefined);
    _recRecorder.ondataavailable = (e) => { if (e.data.size > 0) _recChunks.push(e.data); };
    _recRecorder.onstop = () => _finishRecordedVoice(name);
    _recRecorder.start(100);
    _recSeconds = 0;
    document.getElementById("rec-dot")?.classList.add("recording");
    document.getElementById("rec-start-btn")?.classList.add("hidden");
    document.getElementById("rec-stop-btn")?.classList.remove("hidden");
    if (status) status.textContent = "recording — speak naturally for 5–30 seconds, then stop";
    _recTimerInterval = setInterval(() => {
      _recSeconds++;
      const t = document.getElementById("rec-timer");
      if (t) t.textContent = `${_recSeconds}s`;
    }, 1000);
  }

  function stopVoiceRecord() {
    if (_recRecorder?.state === "recording") _recRecorder.stop();
    _recMediaStream?.getTracks().forEach((t) => t.stop());
    clearInterval(_recTimerInterval);
    document.getElementById("rec-dot")?.classList.remove("recording");
    document.getElementById("rec-stop-btn")?.classList.add("hidden");
    document.getElementById("rec-start-btn")?.classList.remove("hidden");
    const t = document.getElementById("rec-timer");
    if (t) t.textContent = "";
  }

  async function _finishRecordedVoice(name) {
    const status = document.getElementById("rec-status");
    if (status) status.textContent = "uploading…";
    try {
      const blob = new Blob(_recChunks, { type: _recRecorder?.mimeType || "audio/webm" });
      const dataUrl = await _blobToDataUrl(blob);
      name = await saveUploadedVoice(name, dataUrl);
      if (status) status.textContent = `saved "${name}"`;
      document.getElementById("rec-voice-name").value = "";
      setModalTab("browse");
      closeVoiceModal();
    } catch (err) {
      if (status) status.textContent = err.message || String(err);
    }
  }

  async function testVoice() {
    const status = document.getElementById("rec-status");
    if (status) status.textContent = "testing voice…";
    await speakText("Hello, this is a test of your voice.");
    if (status) status.textContent = "voice test complete";
  }

  function stripMarkdown(text) {
    return text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]+`/g, "")
      .replace(/#{1,6}\s+/g, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function stopSpeaking() {
    if (ttsAbortController) { ttsAbortController.abort(); ttsAbortController = null; }
    for (const src of ttsAudioSources) { try { src.stop(); } catch {} }
    ttsAudioSources = [];
    if (_ttsAudioCtx) { _ttsAudioCtx.close().catch(() => {}); _ttsAudioCtx = null; }
    if (systemUtterance) {
      speechSynthesis.cancel();
      systemUtterance = null;
    }
    speakingMsgEl = null;
    document.querySelectorAll(".speak-btn").forEach((btn) => {
      btn.textContent = "speak";
      btn.classList.remove("speak-active", "speak-loading");
    });
  }

  function systemSpeak(text, msgEl) {
    const btn = msgEl?.querySelector(".speak-btn");
    if (btn) { btn.textContent = "stop"; btn.classList.add("speak-active"); }

    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      systemUtterance = u;
      u.onend = () => {
        systemUtterance = null;
        speakingMsgEl = null;
        if (btn) { btn.textContent = "speak"; btn.classList.remove("speak-active"); }
        resolve(true);
      };
      u.onerror = () => {
        systemUtterance = null;
        if (btn) { btn.textContent = "speak"; btn.classList.remove("speak-active"); }
        resolve(false);
      };
      speechSynthesis.speak(u);
    });
  }

  async function _playSseStream(res, msgEl) {
    const btn = msgEl?.querySelector(".speak-btn");
    const audioCtx = new AudioContext();
    _ttsAudioCtx = audioCtx;
    let nextStart = audioCtx.currentTime + 0.1;
    ttsAudioSources = [];
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";

    try {
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nlnl;
        while ((nlnl = buf.indexOf("\n\n")) !== -1) {
          const evtLine = buf.slice(0, nlnl).trim();
          buf = buf.slice(nlnl + 2);
          if (!evtLine.startsWith("data:")) continue;
          let evt;
          try { evt = JSON.parse(evtLine.slice(5).trim()); } catch { continue; }
          if (evt.done) break outer;
          const wavBuf = Uint8Array.from(atob(evt.audio), (ch) => ch.charCodeAt(0)).buffer;
          const audioBuf = await audioCtx.decodeAudioData(wavBuf);
          const src = audioCtx.createBufferSource();
          src.buffer = audioBuf;
          src.connect(audioCtx.destination);
          if (nextStart < audioCtx.currentTime + 0.05) nextStart = audioCtx.currentTime + 0.05;
          src.start(nextStart);
          nextStart += audioBuf.duration;
          ttsAudioSources.push(src);
          if (ttsAudioSources.length === 1 && btn) {
            btn.textContent = "stop";
            btn.classList.remove("speak-loading");
            btn.classList.add("speak-active");
          }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError" && btn) {
        btn.textContent = "speak";
        btn.classList.remove("speak-loading", "speak-active");
      }
      audioCtx.close().catch(() => {});
      return false;
    }

    const lastSrc = ttsAudioSources[ttsAudioSources.length - 1];
    if (lastSrc) {
      lastSrc.onended = () => {
        speakingMsgEl = null;
        if (btn) { btn.textContent = "speak"; btn.classList.remove("speak-active"); }
        audioCtx.close().catch(() => {});
      };
      return true;
    }

    audioCtx.close().catch(() => {});
    if (btn) { btn.textContent = "speak"; btn.classList.remove("speak-loading"); }
    return false;
  }

  async function streamApiTTS(text, msgEl) {
    if (!_selected?.voiceId) return false;

    const abortCtrl = new AbortController();
    ttsAbortController = abortCtrl;
    const btn = msgEl?.querySelector(".speak-btn");
    if (btn) { btn.textContent = "loading…"; btn.classList.add("speak-loading"); }

    const config = _getConfig();
    let res;
    try {
      res = await ApiClient.streamTtsApi(
        config,
        { text, voice_id: _selected.voiceId },
        abortCtrl.signal,
      );
    } catch (err) {
      if (err.name !== "AbortError" && btn) {
        btn.textContent = "speak";
        btn.classList.remove("speak-loading");
      }
      return false;
    }

    if (!res.ok) {
      if (btn) { btn.textContent = "speak"; btn.classList.remove("speak-loading"); }
      return false;
    }

    return _playSseStream(res, msgEl);
  }

  async function speakText(text, msgEl) {
    if (!isVoiceEnabled() || !ttsAvailable) return;
    const snippet = stripMarkdown(text);
    if (!snippet.trim()) return;

    if (msgEl === speakingMsgEl && (systemUtterance || ttsAudioSources.length)) {
      stopSpeaking();
      return;
    }
    stopSpeaking();
    speakingMsgEl = msgEl;

    if (ttsMode === "system") {
      await systemSpeak(snippet, msgEl);
      return;
    }
    if (ttsMode === "api") {
      await streamApiTTS(snippet, msgEl);
    }
  }

  function speakMessage(msgEl) {
    const text = msgEl?.dataset?.text || msgEl?.querySelector(".body")?.textContent || "";
    return speakText(text, msgEl);
  }

  function attachSpeakButton(msgEl, text) {
    if (!msgEl || !ttsAvailable || !isVoiceEnabled()) return;
    msgEl.dataset.text = text;
    const bar = document.createElement("div");
    bar.className = "msg-actions";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "speak-btn";
    btn.textContent = "speak";
    btn.title = ttsMode === "api" ? "Read aloud via API voice clone" : "Read aloud (system voice)";
    btn.onclick = () => speakMessage(msgEl);
    bar.appendChild(btn);
    msgEl.appendChild(bar);
  }

  function bindModal() {
    document.getElementById("voice-choose-btn")?.addEventListener("click", openVoiceModal);
    document.getElementById("voice-clear-btn")?.addEventListener("click", clearVoice);
    document.getElementById("voice-test-btn")?.addEventListener("click", testVoice);
    document.getElementById("voice-modal-close")?.addEventListener("click", closeVoiceModal);
    document.getElementById("voice-modal")?.addEventListener("click", (e) => {
      if (e.target?.id === "voice-modal") closeVoiceModal();
    });
    document.getElementById("voice-search")?.addEventListener("input", (e) => {
      renderVoiceGrid(e.target.value);
    });
    document.querySelectorAll(".voice-modal-tab").forEach((tab) => {
      tab.addEventListener("click", () => setModalTab(tab.dataset.tab));
    });
  }

  function initUI(getConfig) {
    _getConfig = getConfig || (() => ({}));
    _selected = _loadSelection();
    const enabled = isVoiceEnabled();
    document.getElementById("cfg-voice").checked = enabled;
    document.getElementById("speak-auto-toggle").checked = enabled;
    bindModal();
    checkTTS();
    setInterval(checkTTS, 30000);
  }

  function onSettingsChange() {
    checkTTS();
  }

  return {
    initUI,
    onSettingsChange,
    checkTTS,
    isVoiceEnabled,
    setVoiceEnabled,
    speakMessage,
    speakText,
    attachSpeakButton,
    stopSpeaking,
    openVoiceModal,
    clearVoice,
    testVoice,
    loadVoiceRef,
    startVoiceRecord,
    stopVoiceRecord,
    updateVoiceStatus,
    get ttsAvailable() { return ttsAvailable; },
    get ttsMode() { return ttsMode; },
  };
})();

window.Voice = Voice;
