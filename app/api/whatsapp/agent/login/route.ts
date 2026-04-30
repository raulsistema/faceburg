import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyPassword } from '@/lib/password';

type LoginRow = {
  user_id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  user_name: string;
  email: string;
  role: 'admin' | 'staff' | 'kitchen';
  password_hash: string;
  tenant_status: string;
};

type AgentRow = {
  agent_key: string | null;
};

function buildAgentKey() {
  return `wa_${randomBytes(24).toString('hex')}`;
}

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const slug = String(body.slug || '').trim().toLowerCase();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!slug || !email || !password) {
      return NextResponse.json({ error: 'Informe empresa, e-mail e senha.' }, { status: 400 });
    }

    const result = await query<LoginRow>(
      `SELECT
         tu.id AS user_id,
         tu.tenant_id,
         t.name AS tenant_name,
         t.slug AS tenant_slug,
         t.status AS tenant_status,
         tu.name AS user_name,
         tu.email,
         tu.role,
         tu.password_hash
       FROM tenant_users tu
       JOIN tenants t ON t.id = tu.tenant_id
       WHERE t.slug = $1 AND tu.email = $2
       LIMIT 1`,
      [slug, email],
    );

    if (!result.rowCount) {
      return NextResponse.json({ error: 'Credenciais invalidas.' }, { status: 401 });
    }

    const user = result.rows[0];
    if (user.tenant_status !== 'active') {
      return NextResponse.json({ error: 'Empresa inativa.' }, { status: 403 });
    }

    const validPassword = verifyPassword(password, user.password_hash);
    if (!validPassword) {
      return NextResponse.json({ error: 'Credenciais invalidas.' }, { status: 401 });
    }

    const agentResult = await query<AgentRow>(
      `SELECT agent_key
       FROM whatsapp_agents
       WHERE tenant_id = $1
       LIMIT 1`,
      [user.tenant_id],
    );
    const nextKey = agentResult.rows[0]?.agent_key || buildAgentKey();

    await query(
      `INSERT INTO whatsapp_agents
        (tenant_id, enabled, agent_key, session_status, last_seen_at, updated_at)
       VALUES
        ($1, TRUE, $2, 'disconnected', NOW(), NOW())
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         enabled = TRUE,
         agent_key = COALESCE(whatsapp_agents.agent_key, EXCLUDED.agent_key),
         last_seen_at = NOW(),
         updated_at = NOW()`,
      [user.tenant_id, nextKey],
    );

    return NextResponse.json({
      ok: true,
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name,
        slug: user.tenant_slug,
      },
      user: {
        id: user.user_id,
        name: user.user_name,
        email: user.email,
        role: user.role,
      },
      agentKey: nextKey,
    });
  } catch {
    return NextResponse.json({ error: 'Falha no login do agente.' }, { status: 500 });
  }
}
