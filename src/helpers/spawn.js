const { spawn } = require("child_process");
const { addSystem } = require("../store/logStore");

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const spawnQoderCli = (prompt, model, flags = []) => {
  if (process.platform === "win32") {
    // On Windows, pass a cmd-safe prompt to avoid shell interpretation of
    // special characters (&, |, >, <, ^, ").
    const safePrompt = prompt
      .replace(/"/g, '\\"')
      .replace(/[&|<>^]/g, "^$&");
    const args = ["/c", "qodercli.cmd", "-p", safePrompt, "-f", "stream-json"];
    if (model) args.push("--model", model);
    if (flags.length) args.push(...flags);
    return spawn("cmd.exe", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
  } else {
    const args = ["-p", prompt, "-f", "stream-json"];
    if (model) args.push("--model", model);
    if (flags.length) args.push(...flags);
    return spawn("qodercli", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
  }
};

const parseStreamJsonLine = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Public: run a qodercli request
// ---------------------------------------------------------------------------

/**
 * Spawn qodercli and wire up all event handlers in one place.
 *
 * @param {object} opts
 * @param {string}   opts.prompt
 * @param {string}   opts.model
 * @param {string[]} opts.flags       - extra CLI flags (e.g. --max-tokens 512)
 * @param {number}   opts.timeoutMs   - kill + error after this many ms (0 = no limit)
 * @param {function} opts.onChunk     - called with raw qodercli `data` object for each assistant message
 * @param {function} opts.onDone      - called with (exitCode, stderrOutput) when process exits normally
 * @param {function} opts.onError     - called with an Error when spawn fails or timeout fires
 *
 * @returns {ChildProcess} - so callers can kill() on client disconnect
 */
const runQoderRequest = ({
  prompt,
  model,
  flags = [],
  timeoutMs = 120_000,
  onChunk,
  onDone,
  onError,
}) => {
  let buffer = "";
  let stderrOutput = "";
  let settled = false;
  let timeoutHandle;

  const settle = (fn) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutHandle);
    fn();
  };

  const child = spawnQoderCli(prompt, model, flags);

  child.on("error", (err) => {
    console.error("[qodercli error]", err.message);
  });

  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      child.kill();
      settle(() =>
        onError(
          Object.assign(new Error(`qodercli timed out after ${timeoutMs}ms`), {
            code: "TIMEOUT",
          }),
        ),
      );
    }, timeoutMs);
  }

  // ── KEY CHANGE: process stdout line-by-line as it arrives ──────────────────
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    // Keep the last incomplete line in the buffer
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const data = JSON.parse(trimmed);
        if (data.type === "assistant" && data.subtype === "message") {
          onChunk(data);
        }
      } catch {
        // Plain text line (not JSON) — wrap it into a fake message object
        if (trimmed && !trimmed.startsWith("{")) {
          onChunk({
            type: "assistant",
            subtype: "message",
            message: {
              content: [{ type: "text", text: trimmed }],
            },
          });
        }
      }
    }
  });

  // Flush any remaining buffer content when stdout closes
  child.stdout.on("end", () => {
    const trimmed = buffer.trim();
    if (!trimmed) return;

    try {
      const data = JSON.parse(trimmed);
      if (data.type === "assistant" && data.subtype === "message") {
        onChunk(data);
      }
    } catch {
      if (!trimmed.startsWith("{")) {
        onChunk({
          type: "assistant",
          subtype: "message",
          message: {
            content: [{ type: "text", text: trimmed }],
          },
        });
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    stderrOutput += text + "\n";
    addSystem(text, "error", "qodercli-stderr");
  });

  child.on("close", (code, signal) => {
    const finalCode = code == null && signal ? -1 : code;
    const finalStderr = signal
      ? `${stderrOutput.trim()}${stderrOutput.trim() ? "\n" : ""}Process terminated by signal: ${signal}`
      : stderrOutput.trim();
    settle(() => onDone(finalCode, finalStderr));
  });

  child.on("error", (err) => {
    addSystem(err.message, "error", "qodercli-spawn");
    settle(() => onError(err));
  });

  return child;
};

// ---------------------------------------------------------------------------
// Public: startup health check
// ---------------------------------------------------------------------------

/**
 * Check whether qodercli is available on PATH.
 * Resolves to the version string, or null if not found / timed out.
 */
const checkQoderCli = () =>
  new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (val) => {
      if (!done) {
        done = true;
        resolve(val);
      }
    };

    const child =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/c", "qodercli.cmd", "--version"], {
            stdio: ["ignore", "pipe", "pipe"],
          })
        : spawn("qodercli", ["--version"], {
            stdio: ["ignore", "pipe", "pipe"],
          });

    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => finish(code === 0 ? out.trim() : null));
    child.on("error", () => finish(null));

    // Hard timeout of 5 s so startup is never blocked
    setTimeout(() => {
      child.kill();
      finish(null);
    }, 5000);
  });

module.exports = { runQoderRequest, checkQoderCli };
