const { spawn } = require('child_process');
const { addSystem } = require('../store/logStore');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const spawnQoderCli = (prompt, model, flags = []) => {
  if (process.platform === 'win32') {
    const args = ['/c', 'qodercli.cmd', '-p', prompt, '-f', 'stream-json'];
    if (model) args.push('--model', model);
    if (flags.length) args.push(...flags);
    return spawn('cmd.exe', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
  } else {
    const args = ['-p', prompt, '-f', 'stream-json'];
    if (model) args.push('--model', model);
    if (flags.length) args.push(...flags);
    return spawn('qodercli', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
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
const runQoderRequest = ({ prompt, model, flags = [], timeoutMs = 120_000, onChunk, onDone, onError }) => {
  let buffer = '';
  let stderrOutput = '';
  let settled = false;
  let timeoutHandle;

  const settle = (fn) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutHandle);
    fn();
  };

  const child = spawnQoderCli(prompt, model, flags);
  
  child.on('error', (err) => {
    console.error('[qodercli error]', err.message);
  });

  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      child.kill();
      settle(() =>
        onError(
          Object.assign(new Error(`qodercli timed out after ${timeoutMs}ms`), { code: 'TIMEOUT' })
        )
      );
    }, timeoutMs);
  }

  let allData = '';
  
  child.stdout.on('data', (chunk) => {
    allData += chunk.toString();
  });

  child.stdout.on('end', () => {
    const lines = allData.trim().split('\n');
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const data = JSON.parse(line);
        
        if (data.type === 'assistant' && data.subtype === 'message') {
          onChunk(data);
        }
      } catch (e) {
        // Handle plain text response (happens with conversation history)
        const plainText = line.trim();
        if (plainText && !plainText.startsWith('{')) {
          // Create a fake message object for plain text responses
          const fakeMessage = {
            type: 'assistant',
            subtype: 'message',
            message: {
              content: [{ type: 'text', text: plainText }]
            }
          };
          onChunk(fakeMessage);
        }
        continue;
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    stderrOutput += text + '\n';
    addSystem(text, 'error', 'qodercli-stderr');
  });

  child.on('close', (code) => {
    settle(() => onDone(code, stderrOutput.trim()));
  });

  child.on('error', (err) => {
    addSystem(err.message, 'error', 'qodercli-spawn');
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
    let out = '';
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };

    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/c', 'qodercli.cmd', '--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
        : spawn('qodercli', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('close', (code) => finish(code === 0 ? out.trim() : null));
    child.on('error', () => finish(null));

    // Hard timeout of 5 s so startup is never blocked
    setTimeout(() => { child.kill(); finish(null); }, 5000);
  });

module.exports = { runQoderRequest, checkQoderCli };
