# Qoder OpenAI Proxy

An OpenAI-compatible API wrapper for `qodercli` with built-in dashboard, metrics, and Docker support. 
Use Qoder through any tool or library designed for OpenAI's API.

## Features

- ✅ **🔌 OpenAI-Compatible**: Drop-in API replacement for apps like LangChain and Open WebUI
- **💬 Full Chat Support**: Support for `/v1/chat/completions` (system messages, multi-turn history)
- **🛠 OpenAI Tool Calling**: Full support for OpenAI-style function calling with custom tool definitions—works with any IDE or library that uses tools/functions
- **⚡ Streaming**: Real-time SSE streaming responses without lag
- **🔄 Smart Model Mapping**: Accepts any AI model name (gpt-4, claude-3.5, custom names) with intelligent heuristic fallback—gracefully handles unknown models instead of crashing
- **📊 Admin Dashboard**: Built-in dark-themed web dashboard for testing, viewing live logs, and monitoring proxy health
- **🐳 Docker Native**: Zero-persistence RAM-only architecture designed for easy deployment to cloud services via our public GHCR image

---

## 🚀 Quick Start (Docker / Cloud Deployment)

The proxy is containerized and available on the GitHub Container Registry. It runs completely statelessly—no volumes or persistent storage needed. All configuration is done via environment variables.

### Deploying via Docker Run

We expose port `3000` via TCP. Configure your personal tokens securely using environment variables:

```bash
docker run -d \
  --name qoder-proxy \
  -p 3000:3000 \
  -e QODER_PERSONAL_ACCESS_TOKEN="your-qoder-pat" \
  -e PROXY_API_KEY="your-secret-custom-key" \
  -e DASHBOARD_PASSWORD="secure-dashboard-password" \
  ghcr.io/foxy1402/qoder-proxy:latest
```

### Environment Variables

| Variable | Description | Required | Profile/Type |
|---|---|---|---|
| `QODER_PERSONAL_ACCESS_TOKEN` | Your Personal Access Token from [Qoder Integrations](https://qoder.com/account/integrations) | **Yes** | Secret |
| `PROXY_API_KEY` | The secret key *you* choose to protect the `/v1` API from outside internet requests | **Yes*** | Secret (Bearer Token) |
| `DASHBOARD_PASSWORD` | Password to access the web UI at `/dashboard/` | **Yes*** | Secret |
| `PORT` | Container internal TCP port | No | Defaults to `3000` |
| `DASHBOARD_ENABLED`| Set to `false` to disable the web UI | No | Defaults to `true` |
| `CORS_ORIGIN` | Allowed domains for web clients calling the API | No | Defaults to `*` |
| `QODER_TIMEOUT_MS`| Maximum request timeout | No | Defaults to `120000` (2 min) |

*\* Highly recommended when running on the public internet.*

---

## 🌐 The Admin Dashboard

The built-in web dashboard provides full observability into what your proxy is doing. Access it at `http://your-server-ip:3000/dashboard/`.

1. **Endpoints**: Get quick copy-paste snippets for integrating tools.
2. **Playground**: Test the API live in your browser and swap between available models. 
3. **Request Logs**: Inspect live incoming requests, view request payloads, duration, HTTP status, and assembled response text.
4. **System Logs**: View background system errors from `qodercli`.

*Note: All logs are stored securely in RAM and are completely erased whenever the Docker container restarts.*

---

## 🤖 Smart Model Name Mapping

The proxy intelligently maps model names to Qoder CLI tiers using a multi-tier resolution strategy:

1. **Exact match**: Direct Qoder tier names (`auto`, `lite`, `ultimate`) pass through unchanged
2. **Known aliases**: Common names like `gpt-4`, `claude-3.5-sonnet` map to specific tiers
3. **Heuristic matching**: Unknown model names are analyzed (e.g., `claude-sonnet-4-5` → `auto`)
4. **Graceful fallback**: Unrecognized names default to `lite` tier with logging

**All responses come from Qoder's models** - this mapping just makes it easier to integrate with existing OpenAI-compatible tools.

| Common Model Names | Maps To Qoder Tier | 
|---|---|
| `gpt-4`, `gpt-4o`, `claude-3.5-sonnet` | `auto` |
| `o1`, `claude-3-opus` | `ultimate` |
| `o1-mini`, `o3-mini`, `claude-3-sonnet`| `performance` |
| `claude-3.5-haiku`, `gemini-flash` | `efficient` |
| `gpt-3.5-turbo`, `gpt-4o-mini`, `claude-3-haiku` | `lite` |
| *(Qoder native)* `qwen`, `qwen36plus` | `qmodel` (Qwen3.6-Plus) |
| *(Qoder native)* `deepseek`, `deepseek-v4` | `dmodel` (DeepSeek-V4-Pro) |
| *(Qoder native)* `deepseek-v4-flash` | `dfmodel` (DeepSeek-V4-Flash) |
| *(Qoder native)* `kimi` | `kmodel` (Kimi-K2.6) |
| *(Qoder native)* `minimax` | `mmodel` (MiniMax-M2.7) |
| *(Qoder native)* `glm`, `glm51` | `gm51model` (GLM-5.1) |

**Note**: You're getting responses from Qoder's AI models, not OpenAI or Anthropic. The name mapping is purely for compatibility with tools that expect standard model names.

---

## 🛠 Usage Examples

Once deployed, copy your host URL (e.g. `http://localhost:3000/v1` or `https://my-proxy.com/v1`) into any app that takes OpenAI-style endpoints, and set the API Key to whatever you defined as `PROXY_API_KEY`.

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="your-secret-custom-key" 
)

stream = client.chat.completions.create(
    model="gpt-4o",  # The proxy will map this to the 'auto' tier
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

### Direct HTTP (cURL)

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-custom-key" \
  -d '{
    "model": "claude-3.5-sonnet",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    "stream": false
  }'
```

## 🛠 OpenAI-Compatible Tool Calling

The proxy now supports **full OpenAI-style function calling** with custom tool definitions. Define your tools in the request and the AI will intelligently decide when to call them, returning structured `tool_calls` in the response.

### Defining Custom Tools

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="your-secret-custom-key"
)

response = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "What's the weather in Tokyo?"}],
    tools=[{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a city",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "City name"}
                },
                "required": ["city"]
            }
        }
    }]
)
```

### Tool Call Response Format

When the AI decides to use a tool, you'll receive:

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"city\": \"Tokyo\"}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

### How It Works

The proxy converts your OpenAI tool definitions into natural language instructions for Qoder's AI, then parses the model's response back into OpenAI's `tool_calls` format. This works with:

- ✅ **LangChain** - Agent tool chains
- ✅ **Any OpenAI SDK** - Standard function calling
- ⚠️ **Cursor IDE / Continue.dev / Zed** - See known limitations below

Both streaming and non-streaming modes are fully supported!

## ⚠️ Limitations

- **Embeddings**: Qoder does not support embeddings. Calling `/v1/embeddings` returns a `501 Not Implemented`.
- **Token usage**: Token counting is not available—`usage` fields in responses return `null`.
- **Tool execution**: The proxy returns tool call requests in OpenAI format, but doesn't automatically execute them. Your application must handle tool execution and send results back (standard OpenAI tool calling flow).

### ❌ Known Limitation — Coding IDEs Not Yet Supported

The following tools have been tested and are **not currently compatible** with this proxy:

| Tool | Status | Reason |
|---|---|---|
| **Cursor IDE** | ❌ Not working | IDE-specific handshake / protocol extensions not supported |
| **Zed Editor** | ❌ Not working | IDE-specific handshake / protocol extensions not supported |
| **Continue.dev** | ❌ Not working | IDE-specific handshake / protocol extensions not supported |

This is a known, unresolved limitation. A patch has not been implemented yet. If you need AI assistance inside your editor, use Qoder's native extensions where available.

## ✅ Verified Compatible

The proxy has been tested and works with:

- ✅ **OpenAI Python SDK** - All standard features
- ✅ **LangChain** - Agent chains and tool calling
- ✅ **Open WebUI** - Chat interface integration
- ❌ **Cursor IDE** - Not working (see known limitations above)
- ❌ **Zed Editor** - Not working (see known limitations above)
- ❌ **Continue.dev** - Not working (see known limitations above)

## License
MIT
