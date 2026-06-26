# HSC Chat

OpenAI-compatible chat UI in Docker — a lightweight wrapper for your chat and voice API keys. The entire app (UI + CORS proxy) runs in one container.

```bash
git clone https://github.com/97115104/chat-openai-compatible.git
cd chat-openai-compatible
bash deploy-locally.sh
```

Opens **http://localhost:8080**. Verbose build/start output is printed so you can see each Docker step.

Or manually:

```bash
docker compose up --build
```

## Features

- Dark terminal chat UI (429 Inference Network design)
- Token-by-token SSE streaming with blinking cursor
- Full API provider dropdown with browser-persisted settings
- Built-in CORS proxy for Custom Endpoint and Ollama (inside the container)
- Web search toggle (for APIs that support it, e.g. 429 Inference)
- **Voice**: separate voice API key — API clone when configured, otherwise browser system voice when speak is on
- Upload/record voice samples to your API (`POST /v1/tts/voices`)
- Source reference display, stop generation, clear conversation

## Custom Endpoint (vLLM, Cloudflare tunnel, etc.)

1. Set **API Provider** → **Custom Endpoint**
2. Enter your **Chat API Key** (e.g. `sk-studio-...` from Inference Studio)
3. Set **Base URL** to your OpenAI-compatible root, including `/v1`:

   ```
   https://your-tunnel.trycloudflare.com/v1
   ```

4. Set **Model** to `default` (or your deployment name)
5. Check **Remember settings in this browser** and send a message

HSC Chat proxies requests through the same origin (`/proxy/*`), so browser CORS is not an issue.

## Voice

Chat and voice use **separate credentials** in API Settings:

| Field | Purpose |
|-------|---------|
| **Chat API Key** + **Base URL** | Chat completions (`/v1/chat/completions`) |
| **Voice API Key** + **Voice Base URL** | Voice clone TTS (`/v1/tts/*`) |

| Mode | When |
|------|------|
| **API clone** | Voice API key + base URL set, and `GET /v1/tts/health` succeeds |
| **System default** | No voice API key — when **Speak responses aloud** is on, uses browser `speechSynthesis` |

1. Enter **Voice API Key** and **Voice Base URL** for cloned voices (optional)
2. Check **Speak responses aloud** or use the toolbar **speak** toggle
3. With voice API: click **choose voice…** to browse, upload, or record
4. Without voice API key: speak uses your computer's built-in voice automatically

## Other providers

| Provider | Notes |
|----------|-------|
| **Puter GPT-OSS** | Free, no API key. Requires internet. |
| **OpenRouter** | CORS-friendly. Get a key at [openrouter.ai/keys](https://openrouter.ai/keys). |
| **OpenAI / Anthropic / Gemini** | Direct browser calls; may hit CORS on some networks. |
| **Ollama** | Proxied via HSC Chat container. Run `OLLAMA_ORIGINS=* ollama serve` on the host. |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `WEB_PORT` | `8080` | Host port mapped to the container (`deploy-locally.sh`, `docker compose`) |
| `PORT` | `8080` | Port inside the container |
| `PUBLIC_DIR` | `/app/public` | Static files directory inside the container |

## License

MIT — Copyright (c) 2026 Austin Harshberger. See [LICENSE](LICENSE).

## Attestation

Verify: [attest.97115104.com/s/hsc-chat](https://attest.97115104.com/s/hsc-chat)

Built with Cursor Auto (Composer 2.5).
