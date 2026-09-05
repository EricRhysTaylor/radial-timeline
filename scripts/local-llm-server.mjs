#!/usr/bin/env node
// Local MLX LLM worker control — Mac Studio only.
//
//   npm run server          start mlx_lm.server detached, wait until it answers, warm the model
//   npm run server:stop     stop the process listening on the endpoint port
//   npm run server:status   report endpoint, model id, pid, and GPU wired limit
//
// The runtime is a hand-maintained script outside the repo (see the
// 2026-07-11 "Local LLM server setup" run report in Command Center). Nothing
// restarts it after a reboot, so this command is the one place to bring it up.
// Missing prerequisites fail loudly — no fallbacks.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MLX_DIR = join(homedir(), '.local', 'share', 'mlx-lm');
const START_SCRIPT = join(MLX_DIR, 'start-server.sh');
const LOG_FILE = join(MLX_DIR, 'server.log');
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
    console.log(yellow(`  The com.radialtimeline.wiredlimit LaunchDaemon should set this at boot. Manual fix:`));
    console.log(yellow(`  sudo sysctl iogpu.wired_limit_mb=${REQUIRED_WIRED_LIMIT_MB}`));
  } else {
    console.log(`  GPU wired limit: ${limit} MB`);
  }
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
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      max_tokens: 5,
    }),
    signal: AbortSignal.timeout(WARMUP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`warm-up request returned HTTP ${res.status}`);
  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content ?? '';
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
  if (!existsSync(START_SCRIPT)) fail(`Start script not found: ${START_SCRIPT}\n  This command only works on the Mac Studio with the mlx-lm venv installed.`);

  checkWiredLimit();
  console.log(`  Launching ${START_SCRIPT}`);
  console.log(`  Log → ${LOG_FILE}`);

  const logFd = openSync(LOG_FILE, 'w');
  const child = spawn(START_SCRIPT, [], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();

  const models = await waitUntil(() => fetchModels(), READY_TIMEOUT_MS);
  if (!models) fail(`Server did not answer ${BASE_URL}/models within ${READY_TIMEOUT_MS / 1000}s. Check ${LOG_FILE}.`);
  console.log(green(`✔ Endpoint up`) + ` (pid ${child.pid}) — model: ${models.join(', ')}`);

  console.log(`  Warming model (first request loads the weights; ~20–30 s for the 80B)…`);
  try {
    const { seconds, text } = await warmModel(models[0]);
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
const modes = { start, stop, status };
if (!modes[mode]) fail(`Unknown mode "${mode}". Use start | stop | status.`);
await modes[mode]();
