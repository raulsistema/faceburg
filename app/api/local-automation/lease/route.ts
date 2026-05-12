import { NextResponse } from 'next/server';
import {
  claimLocalAutomationLease,
  releaseLocalAutomationLease,
  type LocalAutomationCapabilities,
} from '@/lib/local-automation';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value: unknown, maxLength = 160) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeCapabilities(value: unknown): LocalAutomationCapabilities {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return {
    print: Boolean(source.print),
    whatsapp: Boolean(source.whatsapp),
  };
}

export async function POST(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const ownerId = text(body.ownerId, 120);
  if (!ownerId) {
    return NextResponse.json({ error: 'Identificador da aba local ausente.' }, { status: 400 });
  }

  const lease = await claimLocalAutomationLease({
    tenantId: session.tenantId,
    ownerId,
    ownerLabel: text(body.ownerLabel, 120),
    capabilities: normalizeCapabilities(body.capabilities),
    leaseSeconds: Number(body.leaseSeconds || 20),
  });

  return NextResponse.json({
    ok: true,
    lease,
  });
}

export async function DELETE(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const ownerId = text(body.ownerId, 120);
  if (ownerId) {
    await releaseLocalAutomationLease({
      tenantId: session.tenantId,
      ownerId,
    });
  }

  return NextResponse.json({ ok: true });
}
