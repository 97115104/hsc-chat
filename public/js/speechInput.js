const SpeechInput = (() => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  let promptEl = null;
  let buttonEl = null;
  let getDisabled = () => false;
  let onStatus = () => {};

  let recognition = null;
  let listening = false;
  let wantListen = false;
  let baseText = "";
  let sessionFinal = "";

  function isSupported() {
    return Boolean(SpeechRecognition);
  }

  function isListening() {
    return listening;
  }

  function _applyTranscript(liveInterim = "") {
    if (!promptEl) return;
    const spoken = (sessionFinal + liveInterim).trim();
    if (!spoken) {
      promptEl.value = baseText;
      return;
    }
    const sep = baseText && !baseText.endsWith(" ") && !baseText.endsWith("\n") ? " " : "";
    promptEl.value = baseText + sep + sessionFinal + liveInterim;
  }

  function _setListening(active) {
    listening = active;
    if (!buttonEl) return;
    buttonEl.classList.toggle("listening", active);
    buttonEl.setAttribute("aria-pressed", active ? "true" : "false");
    buttonEl.setAttribute("aria-label", active ? "Stop dictation" : "Dictate");
    buttonEl.title = active ? "Stop dictation" : "Dictate";
  }

  function _errorMessage(err) {
    const map = {
      "not-allowed": "microphone access denied",
      "no-speech": "no speech detected",
      "audio-capture": "microphone unavailable",
      network: "speech recognition network error",
      aborted: "dictation stopped",
    };
    return map[err] || `dictation error: ${err}`;
  }

  function _createRecognition() {
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";

    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) sessionFinal += text;
        else interim += text;
      }
      _applyTranscript(interim);
    };

    rec.onend = () => {
      _setListening(false);
      _applyTranscript();
      if (wantListen && !getDisabled()) {
        try {
          rec.start();
          _setListening(true);
        } catch {
          wantListen = false;
        }
      }
    };

    rec.onerror = (e) => {
      if (e.error === "aborted") return;
      wantListen = false;
      _setListening(false);
      onStatus(_errorMessage(e.error));
    };

    return rec;
  }

  function stop() {
    wantListen = false;
    if (recognition) {
      try { recognition.stop(); } catch { /* already stopped */ }
    }
    _setListening(false);
    _applyTranscript();
  }

  function start() {
    if (!isSupported() || !promptEl || getDisabled()) return;

    if (typeof Voice !== "undefined") Voice.stopSpeaking();

    baseText = promptEl.value;
    sessionFinal = "";
    wantListen = true;

    if (!recognition) recognition = _createRecognition();

    try {
      recognition.start();
      _setListening(true);
      onStatus("listening…");
    } catch (err) {
      wantListen = false;
      if (err.name === "InvalidStateError") {
        try {
          recognition.stop();
          recognition.start();
          _setListening(true);
          onStatus("listening…");
        } catch {
          onStatus("could not start dictation");
        }
      } else {
        onStatus("could not start dictation");
      }
    }
  }

  function toggle() {
    if (listening || wantListen) stop();
    else start();
  }

  function syncDisabled() {
    if (!buttonEl) return;
    const disabled = getDisabled();
    buttonEl.disabled = disabled;
    if (disabled && (listening || wantListen)) stop();
  }

  function init(opts = {}) {
    promptEl = opts.promptEl || null;
    buttonEl = opts.buttonEl || null;
    getDisabled = opts.getDisabled || (() => false);
    onStatus = opts.onStatus || (() => {});

    if (!buttonEl) return;

    if (!isSupported()) {
      buttonEl.classList.add("unsupported");
      buttonEl.disabled = true;
      buttonEl.title = "Dictation not supported in this browser (try Chrome, Edge, or Safari)";
      return;
    }

    buttonEl.addEventListener("click", () => {
      if (!buttonEl.disabled) toggle();
    });
  }

  return {
    init,
    toggle,
    stop,
    isSupported,
    isListening,
    syncDisabled,
  };
})();

window.SpeechInput = SpeechInput;
