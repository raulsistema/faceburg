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
const DIRECT_PROTOCOL = 'direct-v1';

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
 * @type {Map<import('ws'), {tenantId: string, kind: 'print' | 'whatsapp', agentKey: string, direct: boolean, connectedAt: number, pendingJobIds: Set<string>, draining: boolean}>}
 */
const clients = new Map();
let listenerClient = null;
let listenerReconnectTimer = null;

function sendJson(ws, payload) {
  if (ws.readyState !== 1) return false;
  ws.send(JSON.stringify(payload));
  return true;
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
  return { tenantId: row.tenant_id, agentKey };
}

function getString(value) {
  return String(value || '').trim();
}

function tableForKind(kind) {
  return kind === 'whatsapp' ? 'whatsapp_jobs' : 'print_jobs';
}

function successStatusForKind(kind) {
  return kind === 'whatsapp' ? 'sent' : 'printed';
}

function retryDelaySqlForKind(kind) {
  return kind === 'whatsapp' ? "NOW() + INTERVAL '30 seconds'" : "NOW() + INTERVAL '20 seconds'";
}

function defaultErrorForKind(kind) {
  return kind === 'whatsapp' ? 'Falha ao enviar whatsapp' : 'Falha de impressao';
}

function normalizeJobRow(kind, row) {
  const base = {
    id: row.id,
    orderId: row.order_id,
    eventType: row.event_type,
    payloadText: row.payload_text,
    attemptCount: row.attempt_count,
  };
  if (kind === 'whatsapp') {
    base.targetPhone = row.target_phone;
  } else {
    const printerName = getString(row.printer_name);
    if (printerName) base.printerName = printerName;
    if (row.receipt_width !== null && row.receipt_width !== undefined) base.columns = Number(row.receipt_width);
    if (row.print_text_size !== null && row.print_text_size !== undefined) base.printTextSize = String(row.print_text_size);
  }
  return base;
}

async function claimNextJob(tenantId, kind) {
  const table = tableForKind(kind);
  const returning = kind === 'whatsapp'
    ? 'wj.id, wj.tenant_id, wj.order_id, wj.target_phone, wj.event_type, wj.payload_text, wj.attempt_count'
    : `pj.id,
       pj.tenant_id,
       pj.order_id,
       pj.event_type,
       pj.payload_text,
       pj.attempt_count,
       (SELECT pa.printer_name FROM printer_agents pa WHERE pa.tenant_id = pj.tenant_id LIMIT 1) AS printer_name,
       (SELECT pa.receipt_width FROM printer_agents pa WHERE pa.tenant_id = pj.tenant_id LIMIT 1) AS receipt_width,
       (SELECT pa.print_text_size FROM printer_agents pa WHERE pa.tenant_id = pj.tenant_id LIMIT 1) AS print_text_size`;
  const alias = kind === 'whatsapp' ? 'wj' : 'pj';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE ${table}
       SET status = 'queued',
           lease_until = NULL,
           updated_at = NOW()
       WHERE tenant_id = $1
         AND status = 'processing'
         AND lease_until IS NOT NULL
         AND lease_until < NOW()`,
      [tenantId],
    );

    const result = await client.query(
      `WITH next_job AS (
         SELECT id
         FROM ${table}
         WHERE tenant_id = $1
           AND status = 'queued'
           AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE ${table} ${alias}
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           lease_until = NOW() + INTERVAL '90 seconds',
           updated_at = NOW()
       FROM next_job
       WHERE ${alias}.id = next_job.id
       RETURNING ${returning}`,
      [tenantId],
    );
    await client.query('COMMIT');
    if (!result.rowCount) return null;
    return normalizeJobRow(kind, result.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function ackJob(tenantId, kind, jobId, success, errorMessage) {
  const table = tableForKind(kind);
  if (success) {
    await pool.query(
      `UPDATE ${table}
       SET status = $3,
           lease_until = NULL,
           last_error = NULL,
           updated_at = NOW()
       WHERE id = $1
         AND tenant_id = $2`,
      [jobId, tenantId, successStatusForKind(kind)],
    );
    return;
  }

  await pool.query(
    `UPDATE ${table}
     SET status = CASE WHEN attempt_count >= 5 THEN 'failed' ELSE 'queued' END,
         lease_until = NULL,
         last_error = NULLIF($3, ''),
         next_retry_at = CASE WHEN attempt_count >= 5 THEN NULL ELSE ${retryDelaySqlForKind(kind)} END,
         updated_at = NOW()
     WHERE id = $1
       AND tenant_id = $2`,
    [jobId, tenantId, errorMessage || defaultErrorForKind(kind)],
  );
}

async function requeuePendingJobs(session) {
  const ids = Array.from(session.pendingJobIds || []);
  if (!ids.length) return;
  session.pendingJobIds.clear();
  await pool.query(
    `UPDATE ${tableForKind(session.kind)}
     SET status = 'queued',
         lease_until = NULL,
         updated_at = NOW()
     WHERE tenant_id = $1
       AND id = ANY($2::uuid[])
       AND status = 'processing'`,
    [session.tenantId, ids],
  ).catch(() => {});
}

function selectDirectClient(tenantId, kind) {
  let selected = null;
  for (const [ws, session] of clients.entries()) {
    if (ws.readyState !== 1) {
      clients.delete(ws);
      continue;
    }
    if (session.tenantId !== tenantId || session.kind !== kind || !session.direct) continue;
    if (!selected || session.pendingJobIds.size < selected.session.pendingJobIds.size) {
      selected = { ws, session };
    }
  }
  return selected;
}

async function drainDirectJobs(tenantId, kind, reason) {
  const selected = selectDirectClient(tenantId, kind);
  if (!selected) return;
  const { ws, session } = selected;
  if (session.draining || session.pendingJobIds.size > 0) return;

  session.draining = true;
  let claimedJob = null;
  try {
    claimedJob = await claimNextJob(tenantId, kind);
    if (!claimedJob) return;
    session.pendingJobIds.add(claimedJob.id);
    const sent = sendJson(ws, {
      type: 'job',
      protocol: DIRECT_PROTOCOL,
      tenantId,
      kind,
      reason,
      job: claimedJob,
      ts: Date.now(),
    });
    if (!sent) {
      session.pendingJobIds.delete(claimedJob.id);
      await ackJob(tenantId, kind, claimedJob.id, false, 'Agente desconectado antes de receber o job.');
    }
  } catch (error) {
    if (claimedJob) {
      session.pendingJobIds.delete(claimedJob.id);
      await ackJob(tenantId, kind, claimedJob.id, false, error instanceof Error ? error.message : 'Falha no envio direto.').catch(() => {});
    }
    const message = error instanceof Error ? error.message : String(error || 'erro desconhecido');
    console.error(`[realtime-gateway] Falha ao drenar job direto (${kind}/${tenantId}): ${message}`);
  } finally {
    session.draining = false;
  }
}

async function updateAgentState(session, state) {
  if (session.kind === 'print') {
    const connectionStatus = ['disconnected', 'connecting', 'ready', 'error'].includes(getString(state.connectionStatus).toLowerCase())
      ? getString(state.connectionStatus).toLowerCase()
      : 'disconnected';
    await pool.query(
      `UPDATE printer_agents
       SET connection_status = $2,
           device_name = NULLIF($3, ''),
           app_version = NULLIF($4, ''),
           last_error = CASE WHEN $2 = 'error' THEN NULLIF($5, '') ELSE NULL END,
           last_seen_at = NOW(),
           updated_at = NOW()
       WHERE agent_key = $1`,
      [
        session.agentKey,
        connectionStatus,
        getString(state.deviceName),
        getString(state.appVersion),
        getString(state.lastError),
      ],
    );
    if (connectionStatus === 'ready') {
      void drainDirectJobs(session.tenantId, session.kind, 'state-ready');
    }
    return;
  }

  const sessionStatus = ['disconnected', 'qr', 'ready', 'auth_failure', 'connecting'].includes(getString(state.sessionStatus).toLowerCase())
    ? getString(state.sessionStatus).toLowerCase()
    : 'disconnected';
  await pool.query(
    `UPDATE whatsapp_agents
     SET session_status = $2,
         qr_code = CASE WHEN $2 = 'qr' THEN NULLIF($3, '') ELSE NULL END,
         phone_number = NULLIF($4, ''),
         device_name = NULLIF($5, ''),
         app_version = NULLIF($6, ''),
         last_error = CASE WHEN $2 IN ('auth_failure', 'disconnected') THEN NULLIF($7, '') ELSE NULL END,
         last_seen_at = NOW(),
         updated_at = NOW()
     WHERE agent_key = $1`,
    [
      session.agentKey,
      sessionStatus,
      getString(state.qrCode),
      getString(state.phoneNumber),
      getString(state.deviceName),
      getString(state.appVersion),
      getString(state.lastError),
    ],
  );
  if (sessionStatus === 'ready') {
    void drainDirectJobs(session.tenantId, session.kind, 'state-ready');
  }
}

async function handleClientMessage(ws, raw) {
  const session = clients.get(ws);
  if (!session) return;

  let payload;
  try {
    payload = JSON.parse(String(raw || '{}'));
  } catch {
    return;
  }

  if (payload?.type === 'ping') {
    sendJson(ws, { type: 'pong', ts: Date.now() });
    return;
  }

  if (payload?.type === 'agent_state' && session.direct) {
    await updateAgentState(session, payload.state || {}).catch((error) => {
      const message = error instanceof Error ? error.message : String(error || 'erro desconhecido');
      console.error(`[realtime-gateway] Falha ao atualizar estado direto: ${message}`);
    });
    return;
  }

  if (payload?.type === 'job_ack' && session.direct) {
    const jobId = getString(payload.jobId);
    if (!jobId) return;
    session.pendingJobIds.delete(jobId);
    await ackJob(session.tenantId, session.kind, jobId, Boolean(payload.success), getString(payload.error)).catch((error) => {
      const message = error instanceof Error ? error.message : String(error || 'erro desconhecido');
      console.error(`[realtime-gateway] Falha ao confirmar job ${jobId}: ${message}`);
    });
    void drainDirectJobs(session.tenantId, session.kind, 'ack');
  }
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

    const headerProtocol = String(request.headers['x-agent-protocol'] || '').trim().toLowerCase();
    const queryProtocol = String(parsedUrl.searchParams.get('protocol') || '').trim().toLowerCase();
    const direct = headerProtocol === DIRECT_PROTOCOL || queryProtocol === DIRECT_PROTOCOL;

    wss.handleUpgrade(request, socket, head, (ws) => {
      clients.set(ws, {
        tenantId: auth.tenantId,
        kind,
        agentKey: auth.agentKey,
        direct,
        connectedAt: Date.now(),
        pendingJobIds: new Set(),
        draining: false,
      });

      sendJson(ws, {
        type: 'connected',
        tenantId: auth.tenantId,
        kind,
        protocol: direct ? DIRECT_PROTOCOL : 'legacy',
        ts: Date.now(),
      });

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (raw) => {
        void handleClientMessage(ws, raw);
      });

      ws.on('close', () => {
        const session = clients.get(ws);
        clients.delete(ws);
        if (session) void requeuePendingJobs(session);
      });

      ws.on('error', () => {
        const session = clients.get(ws);
        clients.delete(ws);
        if (session) void requeuePendingJobs(session);
      });

      if (direct) {
        void drainDirectJobs(auth.tenantId, kind, 'connect');
      }
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
      if (session.direct) {
        continue;
      }
      sendJson(ws, {
        type: 'job_available',
        tenantId,
        kind,
        ts: Date.now(),
      });
    }
    void drainDirectJobs(tenantId, kind, 'notify');
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
