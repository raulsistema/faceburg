import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const rootDir = process.cwd();
const nextBin = path.join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const gatewayEntry = path.join(rootDir, 'realtime-gateway.js');

/**
 * @type {Array<import('node:child_process').ChildProcess>}
 */
const children = [];
let shuttingDown = false;
const useTurbopack =
  process.env.NEXT_FORCE_TURBOPACK === '1' &&
  process.env.NEXT_DISABLE_TURBOPACK !== '1' &&
  process.platform !== 'win32';

function startProcess(label, args) {
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const reason = signal ? `sinal ${signal}` : `codigo ${code ?? 0}`;
    console.error(`[dev-local] ${label} encerrou (${reason}). Finalizando os demais processos...`);
    shutdown(code ?? 0);
  });

  child.on('error', (error) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`[dev-local] Falha ao iniciar ${label}: ${error instanceof Error ? error.message : String(error)}`);
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
startProcess('Realtime Gateway', [gatewayEntry]);
