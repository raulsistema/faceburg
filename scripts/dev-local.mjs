import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const rootDir = process.cwd();
const nextBin = path.join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const gatewayEntry = path.join(rootDir, 'realtime-gateway.js');
const devServerUrl = process.env.DEV_SERVER_URL || 'http://localhost:3000';
const defaultWarmupRoutes = [
  '/login',
  '/cardapio/faceburguer',
];

/**
 * @type {Array<import('node:child_process').ChildProcess>}
 */
const children = [];
let shuttingDown = false;
const useTurbopack = process.env.NEXT_DISABLE_TURBOPACK !== '1';

function startProcess(label, args, options = {}) {
  const { critical = true, restart = false } = options;
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    const index = children.indexOf(child);
    if (index >= 0) {
      children.splice(index, 1);
    }
    if (shuttingDown) return;
    const reason = signal ? `sinal ${signal}` : `codigo ${code ?? 0}`;
    if (restart) {
      console.error(`[dev-local] ${label} encerrou (${reason}). Reiniciando em 2s...`);
      setTimeout(() => {
        if (!shuttingDown) startProcess(label, args, options);
      }, 2_000);
      return;
    }
    if (!critical) {
      console.error(`[dev-local] ${label} encerrou (${reason}).`);
      return;
    }
    shuttingDown = true;
    console.error(`[dev-local] ${label} encerrou (${reason}). Finalizando os demais processos...`);
    shutdown(code ?? 0);
  });

  child.on('error', (error) => {
    if (shuttingDown) return;
    console.error(`[dev-local] Falha ao iniciar ${label}: ${error instanceof Error ? error.message : String(error)}`);
    if (restart) {
      setTimeout(() => {
        if (!shuttingDown) startProcess(label, args, options);
      }, 2_000);
      return;
    }
    if (!critical) return;
    shuttingDown = true;
    shutdown(1);
  });

  children.push(child);
}

function shutdown(exitCode = 0) {
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignora erro ao encerrar processo filho
      }
    }
  }

  setTimeout(() => process.exit(exitCode), 250);
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        'user-agent': 'faceburg-dev-warmup',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function getWarmupRoutes() {
  if (process.env.DEV_WARMUP_ROUTES) {
    return process.env.DEV_WARMUP_ROUTES
      .split(',')
      .map((route) => route.trim())
      .filter(Boolean);
  }
  return defaultWarmupRoutes;
}

async function waitForNextReady() {
  const startedAt = Date.now();
  const timeoutMs = Number(process.env.DEV_WARMUP_READY_TIMEOUT_MS || 180_000);

  while (!shuttingDown && Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchWithTimeout(`${devServerUrl}/login?warmup=ready`, 8_000);
      if (response.status < 500) {
        return true;
      }
    } catch {
      // O Next ainda esta inicializando ou compilando a primeira rota.
    }
    await sleep(2_000);
  }

  return false;
}

async function warmupDevServer() {
  if (process.env.DEV_WARMUP === '0') return;

  console.log('[dev-local] Aquecimento: aguardando Next.js responder...');
  const ready = await waitForNextReady();
  if (!ready || shuttingDown) {
    console.warn('[dev-local] Aquecimento: Next.js nao respondeu dentro do limite.');
    return;
  }

  for (const route of getWarmupRoutes()) {
    if (shuttingDown) return;
    const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
    const url = `${devServerUrl}${normalizedRoute}`;
    const startedAt = Date.now();
    try {
      const response = await fetchWithTimeout(url, Number(process.env.DEV_WARMUP_ROUTE_TIMEOUT_MS || 240_000));
      console.log(`[dev-local] Aquecimento: ${normalizedRoute} -> ${response.status} em ${Date.now() - startedAt}ms`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[dev-local] Aquecimento: falha em ${normalizedRoute}: ${message}`);
    }
    await sleep(700);
  }
}

const busyPorts = [];
for (const port of [3000, 3001]) {
  if (!(await isPortAvailable(port))) {
    busyPorts.push(port);
  }
}

if (busyPorts.length) {
  console.error(`[dev-local] Porta(s) em uso: ${busyPorts.join(', ')}.`);
  console.error('[dev-local] Ja existe uma instancia do Faceburg rodando ou um processo antigo ficou aberto.');
  console.error(`[dev-local] Para localizar no PowerShell: Get-NetTCPConnection -LocalPort ${busyPorts.join(',')}`);
  process.exit(1);
}

process.on('SIGINT', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdown(0);
});

process.on('SIGTERM', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdown(0);
});

startProcess('Next.js', [nextBin, 'dev', ...(useTurbopack ? ['--turbopack'] : []), '-p', '3000']);
startProcess('Realtime Gateway', [gatewayEntry], { critical: false, restart: true });
void warmupDevServer();
