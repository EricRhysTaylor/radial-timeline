#!/usr/bin/env node
// Control the CPU-only, loopback semantic-index encoder. Startup is offline;
// only the explicit setup command installs packages/downloads the pinned model.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const scripts = dirname(fileURLToPath(import.meta.url));
const runtime = join(homedir(), '.local', 'share', 'radial-timeline-search');
const python = join(runtime, 'venv', 'bin', 'python');
const endpoint = 'http://127.0.0.1:8081/v1/index-model';
const worker = join(scripts, 'local-search-embeddings.py');
const mode = process.argv[2] ?? 'start';
function fail(message) { console.error(message); process.exit(1); }
async function model() {
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    const data = await response.json();
    return data.schemaVersion === 1 && data.model === 'BAAI/bge-small-en-v1.5' ? data : null;
  } catch { return null; }
}
function pid() {
  try { return Number(execFileSync('lsof', ['-nP', '-iTCP:8081', '-sTCP:LISTEN', '-t'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0]) || null; }
  catch { return null; }
}
async function stop() {
  const processId = pid();
  if (!processId) return;
  const command = execFileSync('ps', ['-o', 'command=', '-p', String(processId)], { encoding: 'utf8' });
  if (!command.includes(worker)) fail('Port 8081 belongs to another process; refusing to stop it.');
  process.kill(processId, 'SIGTERM');
  for (let i = 0; i < 30; i++) {
    if (!pid()) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  fail('The embedding worker did not stop. Startup was not attempted.');
}
async function start() {
  if (await model()) { console.log('Local semantic-index encoder already ready.'); return; }
  if (pid()) fail('Port 8081 is occupied but the index encoder is not responding.');
  if (!existsSync(python)) fail('Index runtime is missing. Run npm run search:index:setup first.');
  mkdirSync(runtime, { recursive: true });
  const log = openSync(join(runtime, 'server.log'), 'a');
  const child = spawn(python, [worker], { detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', TOKENIZERS_PARALLELISM: 'false' } });
  child.unref();
  for (let i = 0; i < 60; i++) {
    const ready = await model();
    if (ready) { console.log(`Local semantic-index encoder ready: ${ready.model} (pid ${child.pid}).`); return; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  fail(`Index encoder did not start. See ${join(runtime, 'server.log')}.`);
}
if (mode === 'setup') {
  mkdirSync(runtime, { recursive: true });
  execFileSync('uv', ['venv', '--python', '3.12', join(runtime, 'venv')], { stdio: 'inherit' });
  execFileSync('uv', ['pip', 'install', '--python', python, '-r', join(scripts, 'local-search-requirements.txt')], { stdio: 'inherit' });
  execFileSync(python, [worker, '--download'], { stdio: 'inherit', env: { ...process.env, HF_HUB_DISABLE_TELEMETRY: '1' } });
} else if (mode === 'start') await start();
else if (mode === 'stop') await stop();
else if (mode === 'restart') { await stop(); await start(); }
else if (mode === 'status') { const ready = await model(); console.log(ready ? `Index encoder UP: ${ready.model}` : 'Index encoder DOWN'); }
else fail('Use setup | start | stop | restart | status.');
