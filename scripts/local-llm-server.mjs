#!/usr/bin/env node
// Local MLX LLM worker control — Mac Studio only.
//
//   npm run server          start mlx_lm.server detached, wait until it answers, warm the model
//   npm run server:stop     stop the process listening on the endpoint port
//   npm run server:status   report endpoint, model id, pid, and GPU wired limit
//   node scripts/local-llm-server.mjs restart --configure-memory
//                          restore the model's wired limit, restart, and warm
//
// This file is the single source of truth for which model and flags the server
// runs. The runtime is mlx-lm installed as a uv tool (`uv tool install mlx-lm
// --python 3.12`), weights in the Hugging Face cache — see the Command Center
// "Mac migration runbook". Nothing restarts the server after a reboot, so this
// command is the one place to bring it up. Missing prerequisites fail loudly —
// no fallbacks.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MLX_SERVER = join(homedir(), '.local', 'bin', 'mlx_lm.server');
const MODEL_REPO = 'mlx-community/Qwen3-Next-80B-A3B-Instruct-4bit';
const MODEL_SNAPSHOTS = join(homedir(), '.cache', 'huggingface', 'hub', `models--${MODEL_REPO.replace('/', '--')}`, 'snapshots');
const LOG_DIR = join(homedir(), '.local', 'share', 'mlx-lm');
const LOG_FILE = join(LOG_DIR, 'server.log');
const PORT = 8080;
const BASE_URL = `http://localhost:${PORT}/v1`;
const REQUIRED_WIRED_LIMIT_MB = 57344;
const READY_TIMEOUT_MS = 90_000;
const WARMUP_TIMEOUT_MS = 180_000;

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

function fail(message) {
  console.error(red(`✖ ${message}`));
  process.exit(1);
}

async function fetchModels(timeoutMs = 2000) {
  try {
    const res = await fetch(`${BASE_URL}/models`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = await res.json();
    return Array.isArray(body?.data) ? body.data.map((m) => m.id) : [];
  } catch {
    return null;
  }
}

function listenerPid() {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? Number(out.split('\n')[0]) : null;
  } catch {
    return null;
  }
}

function processCommand(pid) {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function wiredLimitMb() {
  try {
    return Number(execFileSync('sysctl', ['-n', 'iogpu.wired_limit_mb'], { encoding: 'utf8' }).trim());
  } catch {
    return null;
  }
}

function checkWiredLimit() {
  const limit = wiredLimitMb();
  if (limit === null) {
    console.log(yellow(`⚠ Could not read iogpu.wired_limit_mb (not macOS?).`));
    return;
  }
  if (limit < REQUIRED_WIRED_LIMIT_MB) {
    console.log(yellow(`⚠ iogpu.wired_limit_mb is ${limit}; the 80B model expects ${REQUIRED_WIRED_LIMIT_MB}.`));
    console.log(yellow(`  The setting resets on every reboot. Re-apply it with:`));
    console.log(yellow(`  sudo sysctl iogpu.wired_limit_mb=${REQUIRED_WIRED_LIMIT_MB}`));
  } else {
    console.log(`  GPU wired limit: ${limit} MB`);
  }
}

function configureWiredLimit() {
  if (wiredLimitMb() === REQUIRED_WIRED_LIMIT_MB) return;
  try {
    const memoryBytes = Number(execFileSync('sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8' }).trim());
    if (!Number.isFinite(memoryBytes) || REQUIRED_WIRED_LIMIT_MB * 1024 * 1024 >= memoryBytes) {
      fail('The configured GPU wired limit must be smaller than this Mac\'s total RAM.');
    }
    console.log(`Restoring ${REQUIRED_WIRED_LIMIT_MB} MB (56 GiB) of GPU wired-memory capacity.`);
    console.log('macOS may ask for your administrator password; typed characters will not appear.');
    execFileSync('sudo', ['/usr/sbin/sysctl', `iogpu.wired_limit_mb=${REQUIRED_WIRED_LIMIT_MB}`], { stdio: 'inherit' });
  } catch {
    fail('Could not restore the GPU wired limit. Server startup was not attempted.');
  }
  if (wiredLimitMb() !== REQUIRED_WIRED_LIMIT_MB) fail('GPU wired limit did not reach the configured value. Server startup was not attempted.');
}

async function waitUntil(fn, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

async function warmModel(modelId) {
  const started = Date.now();
  // Load and prefill a representative search-sized input, not just a tiny
  // greeting. This is synthetic local text; no manuscript is used for warm-up.
  const warmupText = 'A local warm-up passage contains only synthetic text.\n'.repeat(160)
    + '\nReply with exactly: OK';
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: warmupText }],
      max_tokens: 5,
    }),
    signal: AbortSignal.timeout(WARMUP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`warm-up request returned HTTP ${res.status}`);
  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('warm-up returned no generated text');
  return { seconds: ((Date.now() - started) / 1000).toFixed(1), text };
}

async function status() {
  const models = await fetchModels();
  const pid = listenerPid();
  if (models === null) {
    console.log(red(`● Local LLM server is DOWN`) + `  (${BASE_URL})`);
    if (pid) console.log(yellow(`  Something else holds port ${PORT}: pid ${pid} — ${processCommand(pid)}`));
    checkWiredLimit();
    console.log(`  Start it with: ${green('npm run server')}`);
    return false;
  }
  console.log(green(`● Local LLM server is UP`) + `  (${BASE_URL})`);
  console.log(`  Model: ${models.join(', ') || '(none reported)'}`);
  if (pid) console.log(`  PID: ${pid}`);
  console.log(`  Log: ${LOG_FILE}`);
  checkWiredLimit();
  return true;
}

async function start() {
  const already = await fetchModels();
  if (already !== null) {
    console.log(green(`● Local LLM server already running`) + `  (${BASE_URL})`);
    console.log(`  Model: ${already.join(', ')}`);
    return;
  }

  const holder = listenerPid();
  if (holder) fail(`Port ${PORT} is held by pid ${holder} (${processCommand(holder)}) but it is not answering /v1/models. Stop it first.`);
  if (!existsSync(MLX_SERVER)) fail(`mlx_lm.server not found: ${MLX_SERVER}\n  Install it with: uv tool install mlx-lm --python 3.12`);
  if (!existsSync(MODEL_SNAPSHOTS)) fail(`Model weights not found: ${MODEL_SNAPSHOTS}\n  Download ${MODEL_REPO} into the Hugging Face cache first.`);

  checkWiredLimit();
  console.log(`  Launching ${MLX_SERVER} --model ${MODEL_REPO}`);
  console.log(`  Log → ${LOG_FILE}`);

  mkdirSync(LOG_DIR, { recursive: true });
  const logFd = openSync(LOG_FILE, 'w');
  // Offline: the weights are already cached; never reach the network at load.
  const child = spawn(MLX_SERVER, ['--model', MODEL_REPO, '--host', '127.0.0.1', '--port', String(PORT)], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, HF_HUB_OFFLINE: '1' },
  });
  child.unref();

  const models = await waitUntil(() => fetchModels(), READY_TIMEOUT_MS);
  if (!models) fail(`Server did not answer ${BASE_URL}/models within ${READY_TIMEOUT_MS / 1000}s. Check ${LOG_FILE}.`);
  if (!models.includes(MODEL_REPO)) fail(`Configured model ${MODEL_REPO} was not reported by the server. Check ${LOG_FILE}.`);
  console.log(green(`✔ Endpoint up`) + ` (pid ${child.pid}) — model: ${models.join(', ')}`);

  console.log(`  Warming ${MODEL_REPO} (first request loads its weights)…`);
  try {
    const { seconds, text } = await warmModel(MODEL_REPO);
    console.log(green(`✔ Model ready`) + ` in ${seconds}s — replied "${text.trim()}"`);
  } catch (err) {
    fail(`Warm-up failed: ${err instanceof Error ? err.message : String(err)}. Check ${LOG_FILE}.`);
  }
  console.log(`\n  Stop with ${green('npm run server:stop')} · check with ${green('npm run server:status')}`);
}

async function stop() {
  const pid = listenerPid();
  if (!pid) {
    console.log(`● Nothing listening on port ${PORT}; server already stopped.`);
    return;
  }
  const cmd = processCommand(pid);
  if (!cmd.includes('mlx_lm')) fail(`Port ${PORT} is held by pid ${pid} (${cmd}); refusing to kill a non-mlx_lm process.`);
  process.kill(pid, 'SIGTERM');
  const gone = await waitUntil(async () => (listenerPid() === null ? true : null), 15_000, 500);
  if (!gone) {
    process.kill(pid, 'SIGKILL');
    console.log(yellow(`⚠ SIGTERM ignored; sent SIGKILL to pid ${pid}.`));
  }
  console.log(green(`✔ Stopped mlx_lm.server`) + ` (pid ${pid})`);
}

const mode = process.argv[2] ?? 'start';
const modes = { start, stop, status, restart: async () => { await stop(); await start(); } };
if (!modes[mode]) fail(`Unknown mode "${mode}". Use start | stop | status | restart.`);
const flags = process.argv.slice(3);
if (flags.some(flag => flag !== '--configure-memory')) fail('Unknown option. Use --configure-memory to restore the model\'s GPU wired limit.');
if (flags.includes('--configure-memory')) {
  if (mode !== 'start' && mode !== 'restart') fail('--configure-memory is only supported with start or restart.');
  configureWiredLimit();
}
await modes[mode]();
