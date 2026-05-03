/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { Pool } = require('pg');
const { WebSocketServer } = require('ws');

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

const PORT = Number(process.env.REALTIME_GATEWAY_PORT || 3001);
const HOST = process.env.REALTIME_GATEWAY_HOST || '0.0.0.0';
const WS_PATH = process.env.REALTIME_WS_PATH || '/ws/agents';
const CHANNEL_NAME = process.env.REALTIME_NOTIFY_CHANNEL || 'agent_jobs';

const pool = new Pool({
  host: process.env.DB_HOST || 'faceburg.postgres.uhserver.com',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'faceburg',
  user: process.env.DB_USER || 'faceburg',
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const server = http.createServer((_req, res) => {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end('ok');
});

const wss = new WebSocketServer({
  noServer: true,
});

/**
 * @type {Map<import('ws'), {tenantId: string, kind: 'print' | 'whatsapp', connectedAt: number}>}
 */
const clients = new Map();
let listenerClient = null;
let listenerReconnectTimer = null;

function sendJson(ws, payload) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(payload));
}

async function resolveAgent(agentKey, kind) {
  if (!agentKey) return null;
  const table = kind === 'whatsapp' ? 'whatsapp_agents' : 'printer_agents';
  const result = await pool.query(
    `SELECT tenant_id, enabled
     FROM ${table}
     WHERE agent_key = $1
     LIMIT 1`,
    [agentKey],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  if (!row.enabled) return { disabled: true };
  return { tenantId: row.tenant_id };
}

async function handleUpgrade(request, socket, head) {
  try {
    const parsedUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (parsedUrl.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    const kindParam = String(parsedUrl.searchParams.get('kind') || '').toLowerCase();
    const kind = kindParam === 'whatsapp' ? 'whatsapp' : kindParam === 'print' ? 'print' : '';
    if (!kind) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const rawKey = request.headers['x-agent-key'];
    const agentKey = String(Array.isArray(rawKey) ? rawKey[0] : rawKey || '').trim();
    if (!agentKey) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const auth = await resolveAgent(agentKey, kind);
    if (!auth) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    if (auth.disabled) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      clients.set(ws, {
        tenantId: auth.tenantId,
        kind,
        connectedAt: Date.now(),
      });

      sendJson(ws, {
        type: 'connected',
        tenantId: auth.tenantId,
        kind,
        ts: Date.now(),
      });

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (raw) => {
        try {
          const payload = JSON.parse(String(raw || '{}'));
          if (payload?.type === 'ping') {
            sendJson(ws, { type: 'pong', ts: Date.now() });
          }
        } catch {
          // ignore malformed message
        }
      });

      ws.on('close', () => {
        clients.delete(ws);
      });

      ws.on('error', () => {
        clients.delete(ws);
      });
    });
  } catch {
    socket.destroy();
  }
}

function scheduleListenerReconnect() {
  if (listenerReconnectTimer) return;
  listenerReconnectTimer = setTimeout(() => {
    listenerReconnectTimer = null;
    void startDbListener().catch((error) => {
      const message = error instanceof Error ? error.message : String(error || 'erro desconhecido');
      console.error(`[realtime-gateway] Falha ao reconectar LISTEN: ${message}`);
      scheduleListenerReconnect();
    });
  }, 3000);
}

async function startDbListener() {
  if (listenerClient) return listenerClient;
  const client = await pool.connect();
  try {
    await client.query(`LISTEN ${CHANNEL_NAME}`);
    listenerClient = client;
    console.log(`[realtime-gateway] LISTEN conectado: ${CHANNEL_NAME}`);
  } catch (error) {
    try {
      client.release();
    } catch {
      // ignore
    }
    throw error;
  }

  client.on('notification', (message) => {
    if (!message.payload) return;

    let payload;
    try {
      payload = JSON.parse(message.payload);
    } catch {
      return;
    }

    const tenantId = String(payload.tenantId || '');
    const kind = payload.kind === 'whatsapp' ? 'whatsapp' : payload.kind === 'print' ? 'print' : '';
    if (!tenantId || !kind) return;

    for (const [ws, session] of clients.entries()) {
      if (ws.readyState !== 1) {
        clients.delete(ws);
        continue;
      }
      if (session.tenantId !== tenantId || session.kind !== kind) {
        continue;
      }
      sendJson(ws, {
        type: 'job_available',
        tenantId,
        kind,
        ts: Date.now(),
      });
    }
  });

  const handleListenerDrop = (error) => {
    const message = error instanceof Error ? error.message : 'erro desconhecido';
    console.error(`[realtime-gateway] Falha no LISTEN: ${message}`);
    try {
      client.removeAllListeners();
      client.release();
    } catch {
      // ignore
    }
    if (listenerClient === client) {
      listenerClient = null;
    }
    scheduleListenerReconnect();
  };

  client.on('error', handleListenerDrop);
  client.on('end', () => handleListenerDrop(new Error('listener encerrado')));

  return client;
}

function startHeartbeat() {
  setInterval(() => {
    for (const [ws] of clients.entries()) {
      if (ws.readyState !== 1) {
        clients.delete(ws);
        continue;
      }
      if (ws.isAlive === false) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
}

async function main() {
  await startDbListener();
  server.on('upgrade', (request, socket, head) => {
    void handleUpgrade(request, socket, head);
  });

  server.listen(PORT, HOST, () => {
    console.log(`[realtime-gateway] WS em ws://localhost:${PORT}${WS_PATH}`);
    console.log(`[realtime-gateway] Canal LISTEN: ${CHANNEL_NAME}`);
  });

  startHeartbeat();
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[realtime-gateway] Falha fatal: ${message}`);
  process.exit(1);
});
