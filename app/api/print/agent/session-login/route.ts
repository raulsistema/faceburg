import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type TenantRow = {
  id: string;
  name: string;
  slug: string;
};

type AgentRow = {
  agent_key: string | null;
  printer_name: string | null;
};

function buildAgentKey() {
  return `pa_${randomBytes(24).toString('hex')}`;
}

export async function POST() {
  try {
    const currentSession = await getValidatedTenantSession();
    if (!currentSession) {
      return NextResponse.json({ error: 'Entre no sistema antes de ativar a impressao.' }, { status: 401 });
    }

    const tenantResult = await query<TenantRow>(
      `SELECT id, name, slug
       FROM tenants
       WHERE id = $1
       LIMIT 1`,
      [currentSession.tenantId],
    );

    if (!tenantResult.rowCount) {
      return NextResponse.json({ error: 'Empresa nao encontrada.' }, { status: 404 });
    }

    const tenant = tenantResult.rows[0];
    const agentResult = await query<AgentRow>(
      `SELECT agent_key, printer_name
       FROM printer_agents
       WHERE tenant_id = $1
       LIMIT 1`,
      [tenant.id],
    );

    const nextKey = agentResult.rows[0]?.agent_key || buildAgentKey();

    await query(
      `INSERT INTO printer_agents
        (tenant_id, enabled, agent_key, printer_name, updated_at)
       VALUES
        ($1, FALSE, $2, $3, NOW())
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         agent_key = COALESCE(printer_agents.agent_key, EXCLUDED.agent_key),
         printer_name = COALESCE(printer_agents.printer_name, EXCLUDED.printer_name),
         updated_at = NOW()`,
      [tenant.id, nextKey, agentResult.rows[0]?.printer_name || null],
    );

    return NextResponse.json({
      ok: true,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
      user: {
        id: currentSession.userId,
        name: currentSession.name,
        email: currentSession.email,
        role: currentSession.role,
      },
      printerName: agentResult.rows[0]?.printer_name || '',
      agentKey: nextKey,
    });
  } catch {
    return NextResponse.json({ error: 'Falha ao ativar o agente de impressao.' }, { status: 500 });
  }
}
