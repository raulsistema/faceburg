import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import pool from '@/lib/db';
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

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMasterSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const name = String(body.name || '').trim();
  const slug = String(body.slug || '').trim().toLowerCase();
  const plan = String(body.plan || '').trim();
  const status = String(body.status || '').trim();
  const adminName = String(body.adminName || '').trim();
  const adminEmail = String(body.adminEmail || '').trim().toLowerCase();
  const adminPassword = String(body.adminPassword || '');

  if (!name || !slug || !adminName || !adminEmail) {
    return NextResponse.json({ error: 'Nome, slug, nome do admin e e-mail do admin sao obrigatorios.' }, { status: 400 });
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: 'Slug invalido. Use apenas letras minusculas, numeros e hifen.' }, { status: 400 });
  }
  if (adminPassword && adminPassword.length < 8) {
    return NextResponse.json({ error: 'Nova senha do admin deve ter no minimo 8 caracteres.' }, { status: 400 });
  }

  const safePlan = ['starter', 'pro', 'enterprise'].includes(plan) ? plan : 'starter';
  const safeStatus = ['active', 'inactive'].includes(status) ? status : 'active';

  try {
    const client = await pool.connect();
    let updatedTenant: TenantRow | null = null;
    try {
      await client.query('BEGIN');
      const tenantResult = await client.query<TenantRow>(
        `UPDATE tenants
         SET name = $1, slug = $2, plan = $3, status = $4
         WHERE id = $5
         RETURNING id, name, slug, plan, status, created_at, NULL::text AS admin_name, NULL::text AS admin_email`,
        [name, slug, safePlan, safeStatus, id],
      );

      if (!tenantResult.rowCount) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Empresa nao encontrada.' }, { status: 404 });
      }

      const adminResult = await client.query<{ id: string }>(
        `SELECT id
         FROM tenant_users
         WHERE tenant_id = $1 AND role = 'admin'
         ORDER BY created_at ASC
         LIMIT 1`,
        [id],
      );

      if (adminResult.rowCount) {
        const adminId = adminResult.rows[0].id;
        if (adminPassword) {
          await client.query(
            `UPDATE tenant_users
             SET name = $1, email = $2, password_hash = $3
             WHERE id = $4`,
            [adminName, adminEmail, hashPassword(adminPassword), adminId],
          );
        } else {
          await client.query(
            `UPDATE tenant_users
             SET name = $1, email = $2
             WHERE id = $3`,
            [adminName, adminEmail, adminId],
          );
        }
      } else {
        await client.query(
          `INSERT INTO tenant_users (id, tenant_id, name, email, password_hash, role)
           VALUES ($1, $2, $3, $4, $5, 'admin')`,
          [randomUUID(), id, adminName, adminEmail, hashPassword(adminPassword || 'Admin@123456')],
        );
      }

      await client.query('COMMIT');
      updatedTenant = {
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

    return NextResponse.json({ tenant: updatedTenant });
  } catch (error: unknown) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'Slug ou e-mail do admin ja cadastrado para essa empresa.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Falha ao atualizar empresa.' }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMasterSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tenantCheck = await client.query<{ id: string }>('SELECT id FROM tenants WHERE id = $1 LIMIT 1', [id]);
    if (!tenantCheck.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Empresa nao encontrada.' }, { status: 404 });
    }

    // Remove everything linked to this tenant to avoid orphan references.
    await client.query(
      `DELETE FROM product_options
       WHERE tenant_id = $1`,
      [id],
    );
    await client.query(
      `DELETE FROM product_option_groups
       WHERE tenant_id = $1`,
      [id],
    );
    await client.query(
      `DELETE FROM order_items
       WHERE order_id IN (SELECT id FROM orders WHERE tenant_id = $1)`,
      [id],
    );
    await client.query(
      `DELETE FROM orders
       WHERE tenant_id = $1`,
      [id],
    );
    await client.query(
      `DELETE FROM products
       WHERE tenant_id = $1`,
      [id],
    );
    await client.query(
      `DELETE FROM categories
       WHERE tenant_id = $1`,
      [id],
    );
    await client.query(
      `DELETE FROM customers
       WHERE tenant_id = $1`,
      [id],
    );
    await client.query(
      `DELETE FROM tenant_users
       WHERE tenant_id = $1`,
      [id],
    );
    await client.query(
      `DELETE FROM tenants
       WHERE id = $1`,
      [id],
    );

    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
  } catch {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: 'Falha ao excluir empresa.' }, { status: 500 });
  } finally {
    client.release();
  }
}
