# Qoder OpenAI Proxy

An OpenAI-compatible API wrapper for `qodercli` with built-in dashboard, metrics, and Docker support. 
Use Qoder through any tool or library designed for OpenAI's API.

## Features

- **🔌 OpenAI-Compatible**: Drop-in API replacement for apps like Cursor, Cline, LangChain, and Open WebUI
- **💬 Full Chat Support**: Support for `/v1/chat/completions` (system messages, multi-turn history)
- **🛠 Tool Calling**: Automatic tool execution (file operations, shell commands, code editing) with OpenAI-compatible responses
- **⚡ Streaming**: Real-time SSE streaming responses without lag
- **🔄 Intelligent Tier Mapping**: Seamless translation between OpenAI aliases (gpt-4, claude-3.5) and Qoder tiers (auto, ultimate, lite)
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

## 🤖 Model Intelligence & Mapping

The proxy dynamically understands standard OpenAI names and routes them intelligently to your permitted Qoder tiers.

| OpenAI / Anthropic Alias | Routes To Qoder Tier |
|---|---|
| `gpt-4`, `gpt-4o`, `claude-3.5-sonnet` | `auto` |
| `o1`, `claude-3-opus` | `ultimate` |
| `o1-mini`, `o3-mini`, `claude-3-sonnet`| `performance` |
| `claude-3.5-haiku`, `gemini-flash` | `efficient` |
| `gpt-3.5-turbo`, `gpt-4o-mini`, `claude-3-haiku` | `lite` |
| *(New frontier models)* `qwen`, `kimi`, `glm`| Respective custom identifier (`qmodel`, `kmodel`, etc.) |

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

## 🛠 Tool Calling

The proxy supports **automatic tool calling** using qodercli's built-in tools. When the AI needs to perform actions like creating files, running commands, or searching code, it will automatically use the appropriate tools and return the results in OpenAI-compatible format.

### Supported Built-in Tools

- **Write**: Create/modify files
- **Read**: Read file contents  
- **Bash**: Execute shell commands
- **Edit**: Make targeted file edits
- **Grep**: Search text in files
- **Glob**: Find files by pattern
- **Task**: Delegate to specialized agents
- **WebFetch**: Fetch web content
- **ImageGen**: Generate images
- And more...

### Example Tool Call Response

```json
{
  "choices": [{
    "message": {
      "role": "assistant", 
      "content": "Created hello.py with the requested code.",
      "tool_calls": [{
        "id": "call_123",
        "type": "function",
        "function": {
          "name": "Write",
          "arguments": "{\"file_path\": \"hello.py\", \"content\": \"print('Hello!')\"}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

Tools are automatically invoked based on the user's request—no manual tool definitions required!

## ⚠️ Limitations
- **Embeddings**: Qoder does not support embeddings. Calling `/v1/embeddings` securely returns a `501 Not Implemented`.
- **Token usage limits**: Request token tracking / `usage` payload properties return `null`.
- **Custom Tools**: Only qodercli's built-in tools are supported (Write, Read, Bash, Edit, etc.). Custom OpenAI-style function definitions are not yet supported.

## License
MIT
