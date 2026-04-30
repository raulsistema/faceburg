import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireMasterSession } from '@/lib/master-auth';
import { hashPassword } from '@/lib/password';

type CountRow = { total: string };

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMasterSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const role = String(body.role || '').trim();
  const password = String(body.password || '');

  if (!name || !email || !role) {
    return NextResponse.json({ error: 'Nome, e-mail e role são obrigatórios.' }, { status: 400 });
  }
  if (!['admin', 'staff', 'kitchen'].includes(role)) {
    return NextResponse.json({ error: 'Role inválida.' }, { status: 400 });
  }
  if (password && password.length < 8) {
    return NextResponse.json({ error: 'Nova senha deve ter no mínimo 8 caracteres.' }, { status: 400 });
  }

  try {
    if (password) {
      await query(
        `UPDATE tenant_users
         SET name = $1, email = $2, role = $3, password_hash = $4
         WHERE id = $5`,
        [name, email, role, hashPassword(password), id],
      );
    } else {
      await query(
        `UPDATE tenant_users
         SET name = $1, email = $2, role = $3
         WHERE id = $4`,
        [name, email, role, id],
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'E-mail já existe nessa empresa.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Falha ao atualizar usuário.' }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireMasterSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const userResult = await query<{ tenant_id: string; role: string }>(
    `SELECT tenant_id, role FROM tenant_users WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (!userResult.rowCount) {
    return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
  }

  const row = userResult.rows[0];
  if (row.role === 'admin') {
    const adminCount = await query<CountRow>(
      `SELECT COUNT(*)::text AS total
       FROM tenant_users
       WHERE tenant_id = $1 AND role = 'admin'`,
      [row.tenant_id],
    );
    if (Number(adminCount.rows[0]?.total || 0) <= 1) {
      return NextResponse.json({ error: 'Não é permitido excluir o último admin da empresa.' }, { status: 400 });
    }
  }

  await query(`DELETE FROM tenant_users WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}

