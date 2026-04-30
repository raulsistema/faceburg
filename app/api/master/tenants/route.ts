import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool, { query } from '@/lib/db';
import { requireMasterSession } from '@/lib/master-auth';
import { hashPassword } from '@/lib/password';

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  created_at: string;
  admin_name: string | null;
  admin_email: string | null;
};

export async function GET() {
  const session = await requireMasterSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await query<TenantRow>(
    `SELECT
       t.id,
       t.name,
       t.slug,
       t.plan,
       t.status,
       t.created_at,
       tu.name AS admin_name,
       tu.email AS admin_email
     FROM tenants t
     LEFT JOIN LATERAL (
       SELECT name, email
       FROM tenant_users
       WHERE tenant_id = t.id AND role = 'admin'
       ORDER BY created_at ASC
       LIMIT 1
     ) tu ON TRUE
     ORDER BY created_at DESC
     LIMIT 500`,
  );

  return NextResponse.json({ tenants: result.rows });
}

export async function POST(request: Request) {
  const session = await requireMasterSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const name = String(body.name || '').trim();
  const slug = String(body.slug || '').trim().toLowerCase();
  const plan = String(body.plan || 'starter').trim();
  const status = String(body.status || 'active').trim();
  const adminName = String(body.adminName || '').trim();
  const adminEmail = String(body.adminEmail || '').trim().toLowerCase();
  const adminPassword = String(body.adminPassword || '');

  if (!name || !slug || !adminName || !adminEmail || !adminPassword) {
    return NextResponse.json({ error: 'Nome, slug, login admin e senha sao obrigatorios.' }, { status: 400 });
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: 'Slug invalido. Use apenas letras minusculas, numeros e hifen.' }, { status: 400 });
  }
  if (adminPassword.length < 8) {
    return NextResponse.json({ error: 'A senha do admin deve ter no minimo 8 caracteres.' }, { status: 400 });
  }

  const safePlan = ['starter', 'pro', 'enterprise'].includes(plan) ? plan : 'starter';
  const safeStatus = ['active', 'inactive'].includes(status) ? status : 'active';
  const tenantId = randomUUID();
  const adminUserId = randomUUID();
  const passwordHash = hashPassword(adminPassword);

  try {
    const client = await pool.connect();
    let createdTenant: TenantRow | null = null;
    try {
      await client.query('BEGIN');
      const tenantResult = await client.query<TenantRow>(
        `INSERT INTO tenants (id, name, slug, plan, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, slug, plan, status, created_at, NULL::text AS admin_name, NULL::text AS admin_email`,
        [tenantId, name, slug, safePlan, safeStatus],
      );
      await client.query(
        `INSERT INTO tenant_users (id, tenant_id, name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, 'admin')`,
        [adminUserId, tenantId, adminName, adminEmail, passwordHash],
      );
      await client.query('COMMIT');
      createdTenant = {
        ...tenantResult.rows[0],
        admin_name: adminName,
        admin_email: adminEmail,
      };
    } catch (innerError) {
      await client.query('ROLLBACK');
      throw innerError;
    } finally {
      client.release();
    }

    return NextResponse.json({ tenant: createdTenant }, { status: 201 });
  } catch (error: unknown) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'Slug ou e-mail do admin ja cadastrado para essa empresa.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Falha ao criar empresa.' }, { status: 500 });
  }
}
