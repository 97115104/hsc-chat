# HSC Chat

OpenAI-compatible chat UI in Docker — a lightweight wrapper for your chat and voice API keys. The UI, CORS proxy, and **PostgreSQL chat history** run in Docker.

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

This starts **hsc-chat** (UI + API), **hsc-postgres** (chat history), and **hsc-searxng** (web search).

## Web search

When **web search** is enabled in the toolbar, HSC Chat queries the bundled **SearXNG** container (`GET /api/search?q=…`), injects the top results into the system prompt, and shows source links under the reply. Works with any chat provider — no special API support required.

## Features

- Dark terminal chat UI (429 Inference Network design)
- Token-by-token SSE streaming with blinking cursor
- Full API provider dropdown with browser-persisted settings
- Built-in CORS proxy for Custom Endpoint and Ollama (inside the container)
- Web search via **SearXNG** (Docker) — injects live results into the prompt for any provider
- **Voice**: separate voice API key — API clone when configured, otherwise browser system voice when speak is on
- Markdown rendering for assistant replies
- **Chat history** stored in PostgreSQL — **history** button to browse and resume past chats
- **New chat** button and **⌘N** / **Ctrl+N** shortcut
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
| **Voice API Key** + **Voice Base URL** | Voice clone (`/v1/voices`, `/v1/audio/speech`) |

| Mode | When |
|------|------|
| **API clone** | Voice API key + base URL set (includes `/v1`), and voice list endpoint responds |
| **System default** | No voice API key — when **Speak responses aloud** is on, uses browser `speechSynthesis` |

**Voice Clone API** (OpenAI-compatible, use `/v1` not `/api`):

| Action | Endpoint |
|--------|----------|
| List voices | `GET /v1/voices` or `GET /v1/models` |
| Stream speech | `POST /v1/audio/speech` with `{"model":"fry","input":"…","stream":true}` |
| Upload voice | `POST /v1/voices` |

Preset voices use the name as `model` (e.g. `fry`). Uploaded voices use their `id` (e.g. `voice-a1b2c3d4e5f6`).

1. Enter **Voice API Key** (`sk-voice-…`) and **Voice Base URL** (e.g. `https://…trycloudflare.com/v1`)
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
| `DATABASE_URL` | `postgres://hsc:hsc@postgres:5432/hsc_chat` | PostgreSQL connection string (set automatically in `docker-compose.yml`) |
| `SEARXNG_URL` | `http://searxng:8080` | SearXNG instance for web search (set automatically in `docker-compose.yml`) |
| `SEARCH_LIMIT` | `8` | Max search results injected per message |

Chat messages are stored in PostgreSQL (`hsc_pg_data` Docker volume). Use **new chat** or **⌘N** to start a fresh conversation.

## License

MIT — Copyright (c) 2026 Austin Harshberger. See [LICENSE](LICENSE).

## Attestation

Verify: [attest.97115104.com/s/hsc-chat](https://attest.97115104.com/s/hsc-chat)

Built with Cursor Auto (Composer 2.5).
