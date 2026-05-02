import { spawn } from 'node:child_process';
import path from 'node:path';

const rootDir = process.cwd();
const nextBin = path.join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const gatewayEntry = path.join(rootDir, 'realtime-gateway.js');

/**
 * @type {Array<import('node:child_process').ChildProcess>}
 */
const children = [];
let shuttingDown = false;

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

startProcess('Next.js', [nextBin, 'dev', '-p', '3000']);
startProcess('Realtime Gateway', [gatewayEntry]);
