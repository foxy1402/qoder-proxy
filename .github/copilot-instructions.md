# Copilot Instructions - Qoder OpenAI Proxy

## Project Overview

This is an OpenAI-compatible API proxy for Qoder CLI (qodercli). It translates OpenAI-format API requests into qodercli commands, enabling any OpenAI-compatible tool (Cursor, LangChain, Open WebUI) to use Qoder models.

Key responsibilities:
- Accept /v1/chat/completions and /v1/completions requests in OpenAI format
- Spawn qodercli child processes with appropriate model/prompt arguments
- Stream responses back to clients via Server-Sent Events (SSE)
- Provide a web dashboard for testing and monitoring at /dashboard/

## Build, Test, and Run

Start server (development):
npm run dev       # Runs with --watch for auto-reload on file changes

Start server (production):
npm start         # Runs src/server.js directly

Docker:
docker build -t qoder-proxy .
docker run -p 3000:3000 -e QODER_PERSONAL_ACCESS_TOKEN="..." -e PROXY_API_KEY="..." qoder-proxy

No tests or linters are configured.

## Architecture

### Core Flow

Client → Express → Auth → Routes → spawn.js → qodercli (child process) → Parse stream-json output → SSE/JSON response

1. Routes (src/routes/) receive OpenAI-format requests
2. format.js translates OpenAI model names → Qoder tiers and converts messages[] → single prompt string
3. spawn.js spawns qodercli -p <prompt> -f stream-json --model <tier> as a child process
4. Stream parsing reads line-delimited JSON from stdout, extracts text, and sends SSE chunks
5. Logging (logStore.js) captures all requests/responses in RAM (circular buffer, max 500 entries)

### Key Components

| Component | Purpose |
|-----------|---------|
| src/server.js | Express app setup, route mounting, startup health checks |
| src/config.js | Central config from env vars (PORT, API keys, timeouts) |
| src/helpers/spawn.js | Spawns qodercli, handles stdout/stderr, implements timeout logic |
| src/helpers/format.js | Model mapping (OpenAI aliases → Qoder tiers), message→prompt conversion, response builders |
| src/store/logStore.js | In-memory circular log buffer for requests + system events |
| src/middleware/auth.js | Bearer token validation for /v1/* endpoints |
| src/middleware/dashboardAuth.js | Cookie-based HMAC auth for /dashboard/* |
| src/routes/chat.js | /v1/chat/completions endpoint (supports streaming + non-streaming) |
| src/routes/completions.js | /v1/completions (legacy text completion) |
| src/routes/dashboard.js | Dashboard UI + API endpoints for logs/playground |

## Key Conventions

### 1. Model Mapping Strategy

The proxy accepts OpenAI/Anthropic model names and maps them to Qoder tiers:

gpt-4, gpt-4o, claude-3.5-sonnet  → auto (paid)
o1, claude-3-opus                 → ultimate (paid)
o1-mini, claude-3-sonnet          → performance (paid)
claude-3.5-haiku, gemini-flash    → efficient (paid)
gpt-3.5-turbo, gpt-4o-mini        → lite (free)

- Direct Qoder tier names (auto, lite, etc.) pass through unchanged
- Unknown names pass through as-is (allows custom model IDs)
- Default model is lite if none specified
- Model mapping logic lives in src/helpers/format.js (ALIAS_MAP and getModelMapping)

### 2. Qodercli Integration

Critical details:
- Uses qodercli -p <prompt> -f stream-json --model <tier> for all requests
- Parses line-delimited JSON from stdout (format: {"type":"assistant","subtype":"message","message":{...}})
- Must handle both Windows (cmd.exe /c qodercli.cmd) and Unix (qodercli) spawn paths
- Implements timeout killing (default 120s) to prevent hung processes
- Cleans up child processes on client disconnect (req.on('close'))

Never:
- Buffer full response before sending (breaks streaming)
- Forget to kill child processes on errors or timeouts
- Parse non-JSON lines (some lines may be warnings/errors)

### 3. Message → Prompt Conversion

OpenAI messages array → single prompt string for qodercli (src/helpers/format.js — messagesToPrompt):

- system messages → System: <content>
- user messages → User: <content>
- assistant messages → Assistant: <content>
- Multi-part content [{type:'text', text:'...'}] → flattened to plain text
- Last system message wins if multiple provided

### 4. Response Building

Two response formats:

- Streaming: SSE chunks with delta.content, final chunk with finish_reason, then [DONE]
- Non-streaming: Full response with message.content

All responses follow OpenAI format (id, object, created, model, choices, usage).
Response builders live in src/helpers/format.js (buildStreamChunk, buildDoneChunk, buildFullChatResponse, etc.).

### 5. Logging Architecture

All logging goes through src/store/logStore.js:

- addRequest(entry) — logs API requests with payload, status, duration
- addSystem(message, level, source) — logs system events (startup, errors, auth)
- Circular buffers (max 500 entries each by default)
- Logs are RAM-only (cleared on restart)
- Payloads are truncated to LOG_BODY_MAX_BYTES (default 8KB)

Console output format: [timestamp] METHOD /path → status (duration) [stream]

### 6. Authentication Patterns

Two auth systems:

/v1/* endpoints:
- Bearer token auth (PROXY_API_KEY env var)
- Skips auth entirely if PROXY_API_KEY not set
- Middleware: src/middleware/auth.js

/dashboard/* routes:
- Cookie-based HMAC session tokens
- Login form at /dashboard/login (checks DASHBOARD_PASSWORD)
- Token = base64url(timestamp.random.hmac(timestamp.random))
- 7-day cookie expiry
- Middleware: src/middleware/dashboardAuth.js

### 7. Error Handling

- 400 for invalid requests (missing messages, empty prompt)
- 401 for auth failures
- 500 for qodercli spawn errors or non-zero exit codes
- 501 for unsupported endpoints (/v1/embeddings)
- 504 for timeouts

Return OpenAI-format errors:
{
  "error": {
    "message": "...",
    "type": "invalid_request_error|api_error|timeout_error|not_implemented_error",
    "code": "invalid_api_key|endpoint_not_supported|...",
    "details": "..." (optional, for debugging)
  }
}

### 8. Environment Configuration

All config lives in src/config.js, loaded from .env:

Required for production:
- QODER_PERSONAL_ACCESS_TOKEN — Qoder API credentials
- PROXY_API_KEY — Bearer token for /v1/* auth
- DASHBOARD_PASSWORD — Password for /dashboard/ access

Optional tuning:
- PORT (default 3000)
- QODER_TIMEOUT_MS (default 120000)
- LOG_MAX_ENTRIES (default 500)
- LOG_BODY_MAX_BYTES (default 8192)
- CORS_ORIGIN (default *)
- DASHBOARD_ENABLED (default true)
- DASHBOARD_SECRET (auto-generated if not set)

## Common Tasks

### Adding a New Model Alias

Edit src/helpers/format.js:

1. Add to ALIAS_MAP (maps OpenAI name → qodercli tier)
2. Add to OPENAI_ALIASES in src/routes/misc.js (for /v1/models endpoint)

### Adding a New Qoder Model

Edit src/helpers/format.js:

1. Add to QODER_MODELS array with {id, label, tier, description}

### Modifying Stream Parsing

Edit src/helpers/spawn.js — runQoderRequest():

- Look for data.type === 'assistant' && data.subtype === 'message'
- Extract content via extractTextContent(data.message)
- Handle stop_reason from data.message.stop_reason

### Changing Timeout Behavior

Edit QODER_TIMEOUT_MS in src/config.js or .env file.
Timeout logic lives in src/helpers/spawn.js (setTimeout → child.kill()).

## Important Notes

- **RAM-only design**: All logs/state are in-memory. Restart = data loss.
- **Process cleanup**: Always kill child processes on errors, timeouts, or client disconnects to avoid zombies.
- **SSE headers**: Must set X-Accel-Buffering: no for nginx compatibility.
- **Windows compatibility**: All child_process spawns check process.platform === 'win32' and use cmd.exe wrapper.
- **No token counting**: Qoder CLI doesn't provide token usage — all usage fields return null.
- **Embeddings not supported**: /v1/embeddings returns 501 with explanation.
