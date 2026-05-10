import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { type DeliveryDriverStatus, hashDeliveryPin, verifyDeliveryPin } from '@/lib/delivery-auth';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

export const dynamic = 'force-dynamic';

type PinRow = {
  id: string;
  pin_hash: string | null;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeStatus(value: unknown): DeliveryDriverStatus | null {
  const status = text(value).toLowerCase();
  if (status === 'active' || status === 'inactive' || status === 'dismissed') return status;
  return null;
}

async function pinAlreadyInUse(tenantId: string, pin: string, exceptDriverId: string) {
  const result = await query<PinRow>(
    `SELECT id, pin_hash
     FROM delivery_drivers
     WHERE tenant_id = $1
       AND pin_hash IS NOT NULL
       AND status <> 'dismissed'`,
    [tenantId],
  );
  return result.rows.some((row) => row.id !== exceptDriverId && row.pin_hash && verifyDeliveryPin(pin, row.pin_hash));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    phone?: unknown;
    pin?: unknown;
    status?: unknown;
  };

  const existing = await query<{ id: string; status: string }>(
    `SELECT id, status
     FROM delivery_drivers
     WHERE tenant_id = $1
       AND id = $2
     LIMIT 1`,
    [session.tenantId, id],
  );
  if (!existing.rowCount) {
    return NextResponse.json({ error: 'Entregador nao encontrado.' }, { status: 404 });
  }

  const name = text(body.name);
  const phone = text(body.phone);
  const pin = text(body.pin);
  const status = body.status === undefined ? null : normalizeStatus(body.status);

  if (body.name !== undefined && name.length < 2) {
    return NextResponse.json({ error: 'Informe o nome do entregador.' }, { status: 400 });
  }
  if (body.status !== undefined && !status) {
    return NextResponse.json({ error: 'Status de entregador invalido.' }, { status: 400 });
  }
  if (existing.rows[0].status === 'dismissed' && status && status !== 'dismissed') {
    return NextResponse.json(
      { error: 'Entregador demitido nao pode ser reativado. Cadastre um novo acesso.' },
      { status: 409 },
    );
  }
  if (body.pin !== undefined) {
    if (pin.length < 4) {
      return NextResponse.json({ error: 'O PIN precisa ter pelo menos 4 digitos.' }, { status: 400 });
    }
    if (await pinAlreadyInUse(session.tenantId, pin, id)) {
      return NextResponse.json({ error: 'Ja existe entregador ativo ou desativado com esse PIN.' }, { status: 409 });
    }
  }

  await query(
    `UPDATE delivery_drivers
     SET name = COALESCE(NULLIF($3, ''), name),
         phone = CASE WHEN $4::boolean THEN NULLIF($5, '') ELSE phone END,
         pin_hash = CASE WHEN $6::boolean THEN $7 ELSE pin_hash END,
         status = COALESCE($8, status),
         active = CASE WHEN COALESCE($8, status) = 'active' THEN TRUE ELSE FALSE END,
         dismissed_at = CASE
           WHEN COALESCE($8, status) = 'dismissed' THEN COALESCE(dismissed_at, NOW())
           WHEN $8 IS NOT NULL AND $8 <> 'dismissed' THEN NULL
           ELSE dismissed_at
         END,
         updated_at = NOW()
     WHERE tenant_id = $1
       AND id = $2`,
    [
      session.tenantId,
      id,
      body.name === undefined ? '' : name,
      body.phone !== undefined,
      phone,
      body.pin !== undefined,
      body.pin !== undefined ? hashDeliveryPin(pin) : null,
      status,
    ],
  );

  return NextResponse.json({ ok: true });
}
